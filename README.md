# ComfyUI-WorkflowDropZone

A persistent drop zone in the lower-left corner of the ComfyUI canvas for loading
workflows from images (PNG/WebP/etc.) or `.json` files. It's a reliable alternative
to ComfyUI's built-in drag-and-drop, which can occasionally break.

## Features

- Always-visible drop target in the lower-left corner (fades to low opacity when idle).
- **Drag & drop** an image or `.json` workflow onto the zone.
- **Click** the zone to open a file picker.
- Drop a remote **image URL** and it will be fetched and loaded.
- Visual feedback: hover highlight, green check on success, red cross on failure.
- Highlights itself whenever a file is dragged anywhere over the window.

## How it works

This is a **frontend-only** extension — there are no Python nodes. `__init__.py`
simply exposes the `web/` directory via `WEB_DIRECTORY`, and `web/dropzone.js`
registers a ComfyUI extension that:

- Parses `.json` files as raw or API-format workflows and calls `app.loadGraphData()`.
- Delegates image files to ComfyUI's built-in `app.handleFile()`, which extracts
  embedded workflow metadata from PNG/WebP.

## Installation

Clone or copy this folder into your ComfyUI `custom_nodes` directory:

```
ComfyUI/custom_nodes/ComfyUI-WorkflowDropZone
```

Then restart ComfyUI and hard-refresh the browser.
