(function () {
    'use strict';

    // ── Default data ──
    const DEFAULT_DATA = {
        design_corners: {
            'bottom-left': [203, 1237],
            'bottom-right': [1862, 1236],
            'top-left': [197, 190],
            'top-right': [1840, 172],
        },
        perforation_corners: {
            'bottom-left': [181, 1247],
            'bottom-right': [1848, 1239],
            'left-bottom': [122, 1220],
            'left-top': [122, 160],
            'right-bottom': [1914, 1246],
            'right-top': [1906, 214],
            'top-left': [180, 123],
            'top-right': [1839, 113],
        },
        perforations: {
            bottom: 13.14,
            left: 12.92,
            right: 13.27,
            top: 13.21,
        },
        processed_id: '20530d42-d6fb-42c0-b4fb-71ead5609939',
        px_per_mm: 45.642,
        success: true,
    };

    // Deep clone helper
    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // ── State ──
    const state = {
        data: deepClone(DEFAULT_DATA),
        image: null,
        imageW: 0,
        imageH: 0,
        // Canvas transform (pan/zoom)
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        // Interaction
        dragging: null,       // { type, key, startX, startY, origVal }
        isPanning: false,
        panStart: { x: 0, y: 0, ox: 0, oy: 0 },
        hoveredHandle: null,
    };

    // ── DOM refs ──
    const canvas = document.getElementById('editor-canvas');
    const ctx = canvas.getContext('2d');
    const wrapper = document.getElementById('canvas-wrapper');
    const overlay = document.getElementById('upload-overlay');
    const fileInput = document.getElementById('file-input');
    const uploadBtn = document.getElementById('upload-btn');
    const imgCoordsEl = document.getElementById('img-coords');
    const canvasCoordsEl = document.getElementById('canvas-coords');
    const imgSizeEl = document.getElementById('img-size');
    const imgScaleEl = document.getElementById('img-scale');
    const imageInfoEl = document.getElementById('image-info');

    // ── Constants ──
    const HANDLE_RADIUS = 6;
    const HANDLE_HIT = 10;
    const TOOTH_RADIUS_PX = 4;
    const BLUE_LINE_WIDTH = 2;
    const GREEN_LINE_WIDTH = 2;

    // ── Coordinate transforms ──
    function imgToCanvas(ix, iy) {
        return [ix * state.scale + state.offsetX, iy * state.scale + state.offsetY];
    }

    function canvasToImg(cx, cy) {
        return [(cx - state.offsetX) / state.scale, (cy - state.offsetY) / state.scale];
    }

    // ── Teeth computation ──
    // gauge = perforations per 20mm → spacing = 20mm / gauge
    // spacing in px = (20 / gauge) * px_per_mm
    // From first perforation corner to last, compute how many teeth fit.
    function computeTeethForSide(side) {
        const d = state.data;
        const pxMm = d.px_per_mm;
        const dc = d.design_corners;
        let p1, p2, gauge;

        if (side === 'top') {
            p1 = d.perforation_corners['top-left'];
            p2 = d.perforation_corners['top-right'];
            gauge = d.perforations.top;
        } else if (side === 'bottom') {
            p1 = d.perforation_corners['bottom-left'];
            p2 = d.perforation_corners['bottom-right'];
            gauge = d.perforations.bottom;
        } else if (side === 'left') {
            p1 = d.perforation_corners['left-top'];
            p2 = d.perforation_corners['left-bottom'];
            gauge = d.perforations.left;
        } else {
            p1 = d.perforation_corners['right-top'];
            p2 = d.perforation_corners['right-bottom'];
            gauge = d.perforations.right;
        }

        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const edgeLen = Math.sqrt(dx * dx + dy * dy);
        const spacingPx = (20 / gauge) * pxMm;

        // Blue box boundaries for constraint
        const blueMinX = Math.min(dc['top-left'][0], dc['bottom-left'][0]);
        const blueMaxX = Math.max(dc['top-right'][0], dc['bottom-right'][0]);
        const blueMinY = Math.min(dc['top-left'][1], dc['top-right'][1]);
        const blueMaxY = Math.max(dc['bottom-left'][1], dc['bottom-right'][1]);

        const count = Math.floor(edgeLen / spacingPx) + 1;
        const ux = count > 1 ? dx / (count - 1) : 0;
        const uy = count > 1 ? dy / (count - 1) : 0;

        const teeth = [];
        for (let i = 0; i < count; i++) {
            const tx = p1[0] + ux * i;
            const ty = p1[1] + uy * i;
            if (tx >= blueMinX - 1 && tx <= blueMaxX + 1 && ty >= blueMinY - 1 && ty <= blueMaxY + 1) {
                teeth.push([tx, ty]);
            }
        }

        return { teeth, p1, p2, spacingPx, count };
    }

    // ── Handles (draggable points) ──
    function getAllHandles() {
        const handles = [];
        const d = state.data;

        // Design corners
        for (const [key, val] of Object.entries(d.design_corners)) {
            handles.push({ type: 'design', key, x: val[0], y: val[1], color: '#4a90d9' });
        }

        // Perforation corners
        for (const [key, val] of Object.entries(d.perforation_corners)) {
            handles.push({ type: 'perforation', key, x: val[0], y: val[1], color: '#3ec97a' });
        }

        return handles;
    }

    function findHandleAt(imgX, imgY) {
        const handles = getAllHandles();
        const hitR = HANDLE_HIT / state.scale;
        for (let i = handles.length - 1; i >= 0; i--) {
            const h = handles[i];
            const dx = h.x - imgX;
            const dy = h.y - imgY;
            if (dx * dx + dy * dy <= hitR * hitR) return h;
        }
        return null;
    }

    // ── Rendering ──
    function render() {
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        if (!state.image) return;

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw image
        const [ix, iy] = imgToCanvas(0, 0);
        ctx.drawImage(state.image, ix, iy, state.imageW * state.scale, state.imageH * state.scale);

        // ── Blue design box ──
        const dc = state.data.design_corners;
        const blueCorners = [dc['top-left'], dc['top-right'], dc['bottom-right'], dc['bottom-left']];

        ctx.beginPath();
        let [cx, cy] = imgToCanvas(blueCorners[0][0], blueCorners[0][1]);
        ctx.moveTo(cx, cy);
        for (let i = 1; i < blueCorners.length; i++) {
            [cx, cy] = imgToCanvas(blueCorners[i][0], blueCorners[i][1]);
            ctx.lineTo(cx, cy);
        }
        ctx.closePath();
        ctx.strokeStyle = '#4a90d9';
        ctx.lineWidth = BLUE_LINE_WIDTH;
        ctx.setLineDash([]);
        ctx.stroke();

        // Semi-transparent fill
        ctx.fillStyle = 'rgba(74, 144, 217, 0.06)';
        ctx.fill();

        // ── Green perforation path + teeth ──
        const pc = state.data.perforation_corners;

        // The green path goes: top-left → top-right → right-top → right-bottom → bottom-right → bottom-left → left-bottom → left-top → top-left
        const greenOrder = ['top-left', 'top-right', 'right-top', 'right-bottom', 'bottom-right', 'bottom-left', 'left-bottom', 'left-top'];
        const greenPoints = greenOrder.map(k => pc[k]);

        // Draw green closed path
        ctx.beginPath();
        [cx, cy] = imgToCanvas(greenPoints[0][0], greenPoints[0][1]);
        ctx.moveTo(cx, cy);
        for (let i = 1; i < greenPoints.length; i++) {
            [cx, cy] = imgToCanvas(greenPoints[i][0], greenPoints[i][1]);
            ctx.lineTo(cx, cy);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(62, 201, 122, 0.5)';
        ctx.lineWidth = GREEN_LINE_WIDTH;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw teeth for each side
        const sides = ['top', 'right', 'bottom', 'left'];
        for (const side of sides) {
            const { teeth } = computeTeethForSide(side);
            for (const [tx, ty] of teeth) {
                const [scx, scy] = imgToCanvas(tx, ty);
                ctx.beginPath();
                ctx.arc(scx, scy, TOOTH_RADIUS_PX, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(62, 201, 122, 0.85)';
                ctx.fill();
                ctx.strokeStyle = '#2aa662';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // Also draw the green connecting line through the teeth
        for (const side of sides) {
            const { teeth } = computeTeethForSide(side);
            if (teeth.length < 2) continue;
            ctx.beginPath();
            let [sx, sy] = imgToCanvas(teeth[0][0], teeth[0][1]);
            ctx.moveTo(sx, sy);
            for (let i = 1; i < teeth.length; i++) {
                [sx, sy] = imgToCanvas(teeth[i][0], teeth[i][1]);
                ctx.lineTo(sx, sy);
            }
            ctx.strokeStyle = 'rgba(62, 201, 122, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // ── Draw handles ──
        const handles = getAllHandles();
        for (const h of handles) {
            const [hx, hy] = imgToCanvas(h.x, h.y);
            const isHovered = state.hoveredHandle && state.hoveredHandle.type === h.type && state.hoveredHandle.key === h.key;
            const isDragging = state.dragging && state.dragging.type === h.type && state.dragging.key === h.key;
            const r = (isHovered || isDragging) ? HANDLE_RADIUS + 2 : HANDLE_RADIUS;

            ctx.beginPath();
            ctx.arc(hx, hy, r, 0, Math.PI * 2);
            ctx.fillStyle = isDragging ? '#fff' : h.color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            if (isHovered || isDragging) {
                ctx.beginPath();
                ctx.arc(hx, hy, r + 4, 0, Math.PI * 2);
                ctx.strokeStyle = h.color + '66';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        ctx.restore();

        // Update teeth info
        updateTeethInfo();
    }

    function updateTeethInfo() {
        for (const side of ['top', 'right', 'bottom', 'left']) {
            const { teeth } = computeTeethForSide(side);
            document.getElementById('teeth-' + side).textContent = teeth.length;
        }
        const total = ['top', 'right', 'bottom', 'left'].reduce((s, side) => s + computeTeethForSide(side).teeth.length, 0);
        document.getElementById('teeth-total').textContent = total;
    }

    // ── Resize canvas ──
    function resizeCanvas() {
        const rect = wrapper.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        render();
    }

    // ── Fit image to canvas ──
    function fitImage() {
        if (!state.image) return;
        const padding = 40;
        const cw = canvas.width - padding * 2;
        const ch = canvas.height - padding * 2;
        const scaleX = cw / state.imageW;
        const scaleY = ch / state.imageH;
        state.scale = Math.min(scaleX, scaleY, 1);
        state.offsetX = (canvas.width - state.imageW * state.scale) / 2;
        state.offsetY = (canvas.height - state.imageH * state.scale) / 2;
        imgScaleEl.textContent = (state.scale * 100).toFixed(1) + '%';
    }

    // ── Load image ──
    function loadImage(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                state.image = img;
                state.imageW = img.naturalWidth;
                state.imageH = img.naturalHeight;
                imgSizeEl.textContent = img.naturalWidth + ' × ' + img.naturalHeight;
                imageInfoEl.classList.remove('hidden');
                overlay.classList.add('hidden');
                fitImage();
                render();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ── Sync sidebar inputs from state ──
    function syncInputsFromState() {
        const d = state.data;

        document.getElementById('dc-tl-x').value = d.design_corners['top-left'][0];
        document.getElementById('dc-tl-y').value = d.design_corners['top-left'][1];
        document.getElementById('dc-tr-x').value = d.design_corners['top-right'][0];
        document.getElementById('dc-tr-y').value = d.design_corners['top-right'][1];
        document.getElementById('dc-bl-x').value = d.design_corners['bottom-left'][0];
        document.getElementById('dc-bl-y').value = d.design_corners['bottom-left'][1];
        document.getElementById('dc-br-x').value = d.design_corners['bottom-right'][0];
        document.getElementById('dc-br-y').value = d.design_corners['bottom-right'][1];

        document.getElementById('pc-tl-x').value = d.perforation_corners['top-left'][0];
        document.getElementById('pc-tl-y').value = d.perforation_corners['top-left'][1];
        document.getElementById('pc-tr-x').value = d.perforation_corners['top-right'][0];
        document.getElementById('pc-tr-y').value = d.perforation_corners['top-right'][1];
        document.getElementById('pc-rt-x').value = d.perforation_corners['right-top'][0];
        document.getElementById('pc-rt-y').value = d.perforation_corners['right-top'][1];
        document.getElementById('pc-rb-x').value = d.perforation_corners['right-bottom'][0];
        document.getElementById('pc-rb-y').value = d.perforation_corners['right-bottom'][1];
        document.getElementById('pc-br-x').value = d.perforation_corners['bottom-right'][0];
        document.getElementById('pc-br-y').value = d.perforation_corners['bottom-right'][1];
        document.getElementById('pc-bl-x').value = d.perforation_corners['bottom-left'][0];
        document.getElementById('pc-bl-y').value = d.perforation_corners['bottom-left'][1];
        document.getElementById('pc-lb-x').value = d.perforation_corners['left-bottom'][0];
        document.getElementById('pc-lb-y').value = d.perforation_corners['left-bottom'][1];
        document.getElementById('pc-lt-x').value = d.perforation_corners['left-top'][0];
        document.getElementById('pc-lt-y').value = d.perforation_corners['left-top'][1];

        document.getElementById('gauge-top').value = d.perforations.top;
        document.getElementById('gauge-right').value = d.perforations.right;
        document.getElementById('gauge-bottom').value = d.perforations.bottom;
        document.getElementById('gauge-left').value = d.perforations.left;
        document.getElementById('px-per-mm').value = d.px_per_mm;
    }

    // ── Parse a data-key path and set value in state.data ──
    function setByPath(path, value) {
        const parts = path.split('.');
        let obj = state.data;
        for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
        }
        const lastKey = parts[parts.length - 1];
        const idx = parseInt(lastKey, 10);
        if (!isNaN(idx)) {
            const parentKey = parts[parts.length - 2];
            const grandParent = parts.length > 2 ? parts.slice(0, -2).reduce((o, k) => o[k], state.data) : state.data;
            grandParent[parentKey][idx] = value;
        } else {
            obj[lastKey] = value;
        }
    }

    // ── Events: File ──
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) loadImage(e.target.files[0]);
    });

    uploadBtn.addEventListener('click', () => fileInput.click());

    overlay.addEventListener('dragover', (e) => {
        e.preventDefault();
        overlay.classList.add('dragover');
    });

    overlay.addEventListener('dragleave', () => {
        overlay.classList.remove('dragover');
    });

    overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.classList.remove('dragover');
        if (e.dataTransfer.files.length) loadImage(e.dataTransfer.files[0]);
    });

    // ── Events: Canvas mouse ──
    canvas.addEventListener('mousedown', (e) => {
        if (!state.image) return;

        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const [imgX, imgY] = canvasToImg(mx, my);

        const handle = findHandleAt(imgX, imgY);
        if (handle) {
            const arr = handle.type === 'design'
                ? state.data.design_corners[handle.key]
                : state.data.perforation_corners[handle.key];
            state.dragging = {
                type: handle.type,
                key: handle.key,
                origVal: [arr[0], arr[1]],
                startImgX: imgX,
                startImgY: imgY,
            };
            e.preventDefault();
            return;
        }

        // Start panning with middle button or space+click
        state.isPanning = true;
        state.panStart = { x: mx, y: my, ox: state.offsetX, oy: state.offsetY };
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const [imgX, imgY] = canvasToImg(mx, my);

        // Update coordinates display
        canvasCoordsEl.textContent = `x: ${Math.round(mx)}  y: ${Math.round(my)}`;
        if (state.image && imgX >= 0 && imgX <= state.imageW && imgY >= 0 && imgY <= state.imageH) {
            imgCoordsEl.textContent = `x: ${Math.round(imgX)}  y: ${Math.round(imgY)}`;
        } else {
            imgCoordsEl.textContent = 'x: —  y: —';
        }

        if (state.dragging) {
            const d = state.dragging;
            const dx = imgX - d.startImgX;
            const dy = imgY - d.startImgY;
            const newX = Math.round(d.origVal[0] + dx);
            const newY = Math.round(d.origVal[1] + dy);

            if (d.type === 'design') {
                state.data.design_corners[d.key][0] = newX;
                state.data.design_corners[d.key][1] = newY;
            } else {
                state.data.perforation_corners[d.key][0] = newX;
                state.data.perforation_corners[d.key][1] = newY;
            }

            syncInputsFromState();
            render();
            return;
        }

        if (state.isPanning) {
            state.offsetX = state.panStart.ox + (mx - state.panStart.x);
            state.offsetY = state.panStart.oy + (my - state.panStart.y);
            imgScaleEl.textContent = (state.scale * 100).toFixed(1) + '%';
            render();
            return;
        }

        // Hover detection
        const handle = findHandleAt(imgX, imgY);
        if (handle !== state.hoveredHandle) {
            state.hoveredHandle = handle;
            canvas.style.cursor = handle ? 'grab' : 'crosshair';
            render();
        }
    });

    canvas.addEventListener('mouseup', () => {
        state.dragging = null;
        state.isPanning = false;
    });

    canvas.addEventListener('mouseleave', () => {
        state.dragging = null;
        state.isPanning = false;
        state.hoveredHandle = null;
        imgCoordsEl.textContent = 'x: —  y: —';
        canvasCoordsEl.textContent = 'x: —  y: —';
        render();
    });

    // ── Zoom ──
    canvas.addEventListener('wheel', (e) => {
        if (!state.image) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newScale = Math.max(0.05, Math.min(20, state.scale * zoomFactor));

        // Zoom centered on mouse
        state.offsetX = mx - (mx - state.offsetX) * (newScale / state.scale);
        state.offsetY = my - (my - state.offsetY) * (newScale / state.scale);
        state.scale = newScale;

        imgScaleEl.textContent = (state.scale * 100).toFixed(1) + '%';
        render();
    }, { passive: false });

    // ── Sidebar inputs ──
    document.querySelectorAll('#sidebar input[data-key]').forEach(input => {
        input.addEventListener('input', () => {
            const key = input.getAttribute('data-key');
            const val = parseFloat(input.value);
            if (isNaN(val)) return;
            setByPath(key, val);
            render();
        });
    });

    // ── Panel toggle ──
    document.querySelectorAll('.panel-header[data-toggle]').forEach(header => {
        header.addEventListener('click', () => {
            const targetId = header.getAttribute('data-toggle');
            const body = document.getElementById(targetId);
            header.classList.toggle('collapsed');
            body.classList.toggle('collapsed');
        });
    });

    // ── Export JSON ──
    document.getElementById('export-json-btn').addEventListener('click', () => {
        const json = JSON.stringify(state.data, null, 4);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'perforation-data.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    // ── Init ──
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    syncInputsFromState();
})();
