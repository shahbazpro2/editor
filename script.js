const defaultConfig = {
  design_corners: {
    "bottom-left": [203, 1237],
    "bottom-right": [1862, 1236],
    "top-left": [197, 190],
    "top-right": [1840, 172],
  },
  perforation_corners: {
    "bottom-left": [181, 1247],
    "bottom-right": [1848, 1239],
    "left-bottom": [122, 1220],
    "left-top": [122, 160],
    "right-bottom": [1914, 1246],
    "right-top": [1906, 214],
    "top-left": [180, 123],
    "top-right": [1839, 113],
  },
  perforations: {
    bottom: 13.14,
    left: 12.92,
    right: 13.27,
    top: 13.21,
  },
  processed_id: "20530d42-d6fb-42c0-b4fb-71ead5609939",
  px_per_mm: 45.642,
  success: true,
};

const elements = {
  imageUpload: document.getElementById("imageUpload"),
  configInput: document.getElementById("configInput"),
  applyConfigBtn: document.getElementById("applyConfigBtn"),
  resetConfigBtn: document.getElementById("resetConfigBtn"),
  sideSelect: document.getElementById("sideSelect"),
  offsetRange: document.getElementById("offsetRange"),
  offsetValue: document.getElementById("offsetValue"),
  lengthRange: document.getElementById("lengthRange"),
  lengthValue: document.getElementById("lengthValue"),
  mouseXY: document.getElementById("mouseXY"),
  statusText: document.getElementById("statusText"),
  teethStats: document.getElementById("teethStats"),
  canvas: document.getElementById("editorCanvas"),
};

const ctx = elements.canvas.getContext("2d");
const image = new Image();

const state = {
  config: structuredClone(defaultConfig),
  imageLoaded: false,
  scale: 1,
  pointer: { x: null, y: null, inside: false },
  draggingHandle: null,
  greenLine: {
    side: "top",
    offset: 0,
    lengthPx: 300,
  },
};

function round2(num) {
  return Math.round(num * 100) / 100;
}

function setStatus(text, isError = false) {
  elements.statusText.textContent = text;
  elements.statusText.style.color = isError ? "#b42318" : "#344054";
}

function loadConfigToTextarea(configObj) {
  elements.configInput.value = JSON.stringify(configObj, null, 2);
}

function parseConfigFromTextarea() {
  const parsed = JSON.parse(elements.configInput.value);
  if (!parsed.design_corners || !parsed.perforation_corners || !parsed.px_per_mm) {
    throw new Error("Missing required keys (design_corners, perforation_corners, px_per_mm)");
  }
  return parsed;
}

function getDesignBounds() {
  const corners = state.config.design_corners;
  const tl = corners["top-left"];
  const tr = corners["top-right"];
  const bl = corners["bottom-left"];
  const br = corners["bottom-right"];

  const xs = [tl[0], tr[0], bl[0], br[0]];
  const ys = [tl[1], tr[1], bl[1], br[1]];

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function getPerforationEndpoints(side) {
  const c = state.config.perforation_corners;
  if (side === "top") return { start: c["top-left"], end: c["top-right"] };
  if (side === "bottom") return { start: c["bottom-left"], end: c["bottom-right"] };
  if (side === "left") return { start: c["left-top"], end: c["left-bottom"] };
  return { start: c["right-top"], end: c["right-bottom"] };
}

function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function clampGreenLineToDesign() {
  const bounds = getDesignBounds();
  const side = state.greenLine.side;

  if (side === "top" || side === "bottom") {
    const maxLen = Math.max(20, bounds.width);
    state.greenLine.lengthPx = Math.min(state.greenLine.lengthPx, maxLen);
    const maxOffset = Math.max(0, bounds.width - state.greenLine.lengthPx);
    state.greenLine.offset = Math.min(state.greenLine.offset, maxOffset);
  } else {
    const maxLen = Math.max(20, bounds.height);
    state.greenLine.lengthPx = Math.min(state.greenLine.lengthPx, maxLen);
    const maxOffset = Math.max(0, bounds.height - state.greenLine.lengthPx);
    state.greenLine.offset = Math.min(state.greenLine.offset, maxOffset);
  }
}

function updateRangeLimits() {
  const bounds = getDesignBounds();
  const side = state.greenLine.side;
  const maxLength = side === "top" || side === "bottom" ? bounds.width : bounds.height;

  const safeMaxLength = Math.max(20, Math.floor(maxLength));
  elements.lengthRange.max = String(safeMaxLength);
  elements.lengthRange.min = "20";

  if (state.greenLine.lengthPx > safeMaxLength) {
    state.greenLine.lengthPx = safeMaxLength;
  }

  const maxOffset = Math.max(0, safeMaxLength - Math.floor(state.greenLine.lengthPx));
  elements.offsetRange.max = String(maxOffset);
  if (state.greenLine.offset > maxOffset) {
    state.greenLine.offset = maxOffset;
  }

  elements.lengthRange.value = String(Math.round(state.greenLine.lengthPx));
  elements.offsetRange.value = String(Math.round(state.greenLine.offset));
  elements.lengthValue.textContent = `${Math.round(state.greenLine.lengthPx)} px`;
  elements.offsetValue.textContent = `${Math.round(state.greenLine.offset)} px`;
}

function lineEquationPoints(start, end, spacingPx) {
  const points = [];
  const len = distance(start, end);
  if (len === 0) return points;

  const count = Math.floor(len / spacingPx);
  const stepX = (end[0] - start[0]) / len;
  const stepY = (end[1] - start[1]) / len;

  points.push(start);
  for (let i = 1; i < count; i += 1) {
    points.push([start[0] + stepX * spacingPx * i, start[1] + stepY * spacingPx * i]);
  }
  points.push(end);
  return points;
}

function drawMarker(x, y, color = "#00d4ff", size = 5) {
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

function drawCross(x, y, color = "#22c55e", size = 7) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
}

function getGreenLineGeometry() {
  const bounds = getDesignBounds();
  const side = state.greenLine.side;
  let startX = 0;
  let startY = 0;
  let endX = 0;
  let endY = 0;

  if (side === "top") {
    startX = bounds.left + state.greenLine.offset;
    startY = bounds.top;
    endX = startX + state.greenLine.lengthPx;
    endY = bounds.top;
  } else if (side === "bottom") {
    startX = bounds.left + state.greenLine.offset;
    startY = bounds.bottom;
    endX = startX + state.greenLine.lengthPx;
    endY = bounds.bottom;
  } else if (side === "left") {
    startX = bounds.left;
    startY = bounds.top + state.greenLine.offset;
    endX = bounds.left;
    endY = startY + state.greenLine.lengthPx;
  } else {
    startX = bounds.right;
    startY = bounds.top + state.greenLine.offset;
    endX = bounds.right;
    endY = startY + state.greenLine.lengthPx;
  }

  return {
    start: [startX, startY],
    end: [endX, endY],
  };
}

function drawGreenLineWithTeeth() {
  const { start, end } = getGreenLineGeometry();
  const pxPerMm = state.config.px_per_mm;
  const spacingPx = pxPerMm;
  const teeth = lineEquationPoints(start, end, spacingPx);

  ctx.save();
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.lineTo(end[0], end[1]);
  ctx.stroke();
  ctx.restore();

  teeth.forEach((point, idx) => {
    const color = idx === 0 || idx === teeth.length - 1 ? "#f59e0b" : "#22c55e";
    drawCross(point[0], point[1], color, 6);
  });

  drawMarker(start[0], start[1], "#16a34a", 6);
  drawMarker(end[0], end[1], "#16a34a", 6);

  return teeth.length;
}

function drawDesignBox() {
  const corners = state.config.design_corners;
  const tl = corners["top-left"];
  const tr = corners["top-right"];
  const br = corners["bottom-right"];
  const bl = corners["bottom-left"];

  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(tl[0], tl[1]);
  ctx.lineTo(tr[0], tr[1]);
  ctx.lineTo(br[0], br[1]);
  ctx.lineTo(bl[0], bl[1]);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  [tl, tr, br, bl].forEach((pt) => drawMarker(pt[0], pt[1], "#2563eb", 5.5));
}

function drawPerforationGuides() {
  const sides = ["top", "right", "bottom", "left"];
  const listHTML = [];

  sides.forEach((side) => {
    const { start, end } = getPerforationEndpoints(side);
    const spacingMm = state.config.perforations?.[side] ?? 13;
    const spacingPx = spacingMm * state.config.px_per_mm;
    const points = lineEquationPoints(start, end, spacingPx);

    ctx.save();
    ctx.strokeStyle = "rgba(6, 182, 212, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
    ctx.restore();

    points.forEach((p, idx) => {
      const isEdge = idx === 0 || idx === points.length - 1;
      drawMarker(p[0], p[1], isEdge ? "#f97316" : "#0ea5e9", isEdge ? 5 : 3.5);
    });

    listHTML.push(
      `<li><strong>${side}</strong>: ${points.length} points (gap: ${round2(spacingPx)} px)</li>`
    );
  });

  elements.teethStats.innerHTML = listHTML.join("");
}

function drawPointerInfo() {
  if (!state.pointer.inside) return;
  const x = Math.round(state.pointer.x);
  const y = Math.round(state.pointer.y);
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(x + 8, y + 8, 92, 24);
  ctx.fillStyle = "#fff";
  ctx.font = "12px Arial";
  ctx.fillText(`x: ${x}, y: ${y}`, x + 14, y + 24);
}

function drawScene() {
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  if (state.imageLoaded) {
    ctx.drawImage(image, 0, 0);
  } else {
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  }

  drawDesignBox();
  drawPerforationGuides();
  const greenTeethCount = drawGreenLineWithTeeth();
  drawPointerInfo();

  const current = elements.teethStats.innerHTML;
  elements.teethStats.innerHTML =
    `${current}<li><strong>green line</strong>: ${greenTeethCount} points (1mm: ${round2(
      state.config.px_per_mm
    )} px)</li>`;
}

function canvasPointFromMouse(evt) {
  const rect = elements.canvas.getBoundingClientRect();
  const x = ((evt.clientX - rect.left) / rect.width) * elements.canvas.width;
  const y = ((evt.clientY - rect.top) / rect.height) * elements.canvas.height;
  return [x, y];
}

function pointNear(a, b, radius = 10) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= radius;
}

function updateMouseLabel(x, y, inside = true) {
  if (!inside) {
    elements.mouseXY.textContent = "x: -, y: -";
    return;
  }
  elements.mouseXY.textContent = `x: ${Math.round(x)}, y: ${Math.round(y)}`;
}

function handleImageUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    image.onload = () => {
      elements.canvas.width = image.width;
      elements.canvas.height = image.height;
      state.imageLoaded = true;
      state.greenLine.lengthPx = Math.min(300, getDesignBounds().width);
      clampGreenLineToDesign();
      updateRangeLimits();
      drawScene();
      setStatus(`Image loaded: ${file.name} (${image.width} x ${image.height})`);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function setDefaultConfig() {
  state.config = structuredClone(defaultConfig);
  loadConfigToTextarea(state.config);
  clampGreenLineToDesign();
  updateRangeLimits();
  drawScene();
  setStatus("Default config loaded.");
}

function applyConfig() {
  try {
    state.config = parseConfigFromTextarea();
    clampGreenLineToDesign();
    updateRangeLimits();
    drawScene();
    setStatus("Config applied successfully.");
  } catch (error) {
    setStatus(`Invalid config: ${error.message}`, true);
  }
}

function startHandleDrag(evt) {
  const [x, y] = canvasPointFromMouse(evt);
  const { start, end } = getGreenLineGeometry();
  if (pointNear([x, y], start, 10)) {
    state.draggingHandle = "start";
  } else if (pointNear([x, y], end, 10)) {
    state.draggingHandle = "end";
  } else {
    state.draggingHandle = null;
  }
}

function dragHandle(evt) {
  if (!state.draggingHandle) return;
  const [x, y] = canvasPointFromMouse(evt);
  const bounds = getDesignBounds();
  const side = state.greenLine.side;

  if (side === "top" || side === "bottom") {
    const minX = bounds.left;
    const maxX = bounds.right;
    if (state.draggingHandle === "start") {
      const endX = minX + state.greenLine.offset + state.greenLine.lengthPx;
      const newStartX = Math.min(Math.max(x, minX), endX - 20);
      state.greenLine.offset = newStartX - minX;
      state.greenLine.lengthPx = endX - newStartX;
    } else {
      const startX = minX + state.greenLine.offset;
      const newEndX = Math.max(Math.min(x, maxX), startX + 20);
      state.greenLine.lengthPx = newEndX - startX;
    }
  } else {
    const minY = bounds.top;
    const maxY = bounds.bottom;
    if (state.draggingHandle === "start") {
      const endY = minY + state.greenLine.offset + state.greenLine.lengthPx;
      const newStartY = Math.min(Math.max(y, minY), endY - 20);
      state.greenLine.offset = newStartY - minY;
      state.greenLine.lengthPx = endY - newStartY;
    } else {
      const startY = minY + state.greenLine.offset;
      const newEndY = Math.max(Math.min(y, maxY), startY + 20);
      state.greenLine.lengthPx = newEndY - startY;
    }
  }

  clampGreenLineToDesign();
  updateRangeLimits();
  drawScene();
}

function stopHandleDrag() {
  state.draggingHandle = null;
}

function wireEvents() {
  elements.imageUpload.addEventListener("change", (evt) => {
    const file = evt.target.files?.[0];
    handleImageUpload(file);
  });

  elements.applyConfigBtn.addEventListener("click", applyConfig);
  elements.resetConfigBtn.addEventListener("click", setDefaultConfig);

  elements.sideSelect.addEventListener("change", () => {
    state.greenLine.side = elements.sideSelect.value;
    clampGreenLineToDesign();
    updateRangeLimits();
    drawScene();
  });

  elements.offsetRange.addEventListener("input", () => {
    state.greenLine.offset = Number(elements.offsetRange.value);
    elements.offsetValue.textContent = `${Math.round(state.greenLine.offset)} px`;
    drawScene();
  });

  elements.lengthRange.addEventListener("input", () => {
    state.greenLine.lengthPx = Number(elements.lengthRange.value);
    clampGreenLineToDesign();
    updateRangeLimits();
    drawScene();
  });

  elements.canvas.addEventListener("mousemove", (evt) => {
    const [x, y] = canvasPointFromMouse(evt);
    state.pointer = { x, y, inside: true };
    updateMouseLabel(x, y, true);
    dragHandle(evt);
    if (!state.draggingHandle) drawScene();
  });

  elements.canvas.addEventListener("mouseleave", () => {
    state.pointer.inside = false;
    updateMouseLabel(0, 0, false);
    drawScene();
  });

  elements.canvas.addEventListener("mousedown", startHandleDrag);
  window.addEventListener("mouseup", stopHandleDrag);
}

function init() {
  loadConfigToTextarea(state.config);
  wireEvents();
  updateRangeLimits();
  drawScene();
}

init();
