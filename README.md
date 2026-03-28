# Stamp Perforation Editor

An interactive browser-based editor for visualizing and editing stamp perforation data overlaid on stamp images.

## Features

- **Image Upload** – Drag-and-drop or click to upload stamp images (JPG, PNG, TIFF)
- **Blue Design Box** – Displays the design corner boundaries as a blue rectangle
- **Green Perforation Line** – Dashed green path connecting all 8 perforation corners
- **Teeth Visualization** – Calculated perforation teeth markers based on gauge (perforations per 20mm) and px/mm scale
- **Interactive Handles** – Drag any corner point to reposition it; sidebar values update in real-time
- **Blue Box Constraint** – Teeth are clipped to not exceed the design corner boundaries
- **Pan & Zoom** – Scroll to zoom, click-drag empty area to pan
- **Live Coordinates** – Mouse position shown in both image-space and canvas-space coordinates
- **Editable Sidebar** – All numeric values can be edited directly in the sidebar
- **JSON Export** – Export the current data as a JSON file

## Usage

Open `index.html` in any modern browser. No build step or server required.

1. Upload a stamp image
2. The default perforation data loads automatically
3. Drag corner handles to adjust positions
4. Edit gauge values or px/mm in the sidebar to update teeth counts
5. Export the final JSON when done
