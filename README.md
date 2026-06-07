# ComfyUI-WorkflowDropZone

A persistent drop zone in the lower-left corner of the ComfyUI canvas for loading
workflows from images (PNG/WebP/etc.) or `.json` files. It's a reliable alternative
to ComfyUI's built-in drag-and-drop, which can occasionally break.

## Controls

| Action | What it does |
| --- | --- |
| **Drop** image / `.json` / URL | Load the workflow (replaces the canvas) |
| **Click** | Open a file picker |
| **Shift / Alt + drop** | Append the workflow into the current canvas |
| **Ctrl / Cmd + V** | Load a clipboard image-with-metadata or workflow JSON |
| **Right-click** | Open the menu (Favorites · Recent · Restore) |
| **Click-hold + drag** | Move the zone (position is remembered) |
| **☆ / ★** in menu | Pin / unpin a workflow as a favorite |

## Features

- Always-visible drop target (fades to low opacity when idle).
- **Drag & drop** an image or `.json` workflow onto the zone.
- **Click** the zone to open a file picker.
- Drop a remote **image URL** and it will be fetched and loaded.
- **Drag to move** the zone anywhere; its position is remembered across reloads.
- **Paste (Ctrl/Cmd+V)** an image with embedded workflow metadata, or workflow JSON text.
- **Shift/Alt + drop** to *append* a workflow into the current canvas instead of replacing it.
- **Right-click** opens a popover with:
  - **Favorites** — pinned workflows (star any Recent entry to pin it).
  - **Recent** — the last 10 workflows you loaded, click to reload.
  - **Restore** — automatic crash-recovery snapshots of your canvas (per workflow).
- Visual feedback: hover highlight, green check on success, red cross on failure.
- Highlights itself whenever a file is dragged anywhere over the window.

### Auto-snapshots (crash recovery)

The canvas is snapshotted to `localStorage` as you work — only when it actually
changes, never an empty canvas. Snapshots are time-coalesced (the newest entry
tracks current work; a fresh history point starts at most every ~2 minutes), giving
roughly a 14-minute rolling recovery window across 8 slots. Right-click → **Restore**
to roll back. Restoring snapshots the current canvas first, so it's undoable.

Snapshots are kept **per workflow**, keyed off ComfyUI's active workflow
(`app.extensionManager.workflow.activeWorkflow`), so each workflow tab has its own
history and a Restore always lands in the right place. On older frontends without
that store, it gracefully falls back to a single shared history.

### Multiple tabs

- **ComfyUI workflow tabs:** one zone serves the whole page and acts on the active
  workflow; snapshots are tracked separately per workflow.
- **Browser tabs/windows:** snapshots live under a per-workflow key, so different
  workflows never clobber each other. Recent/Favorites are shared across tabs and an
  open menu live-refreshes via the `storage` event. Editing the *same* workflow in two
  browser tabs at once is an inherent last-writer-wins race for that one history.

### Storage

All state lives in the browser's `localStorage` (per-browser, no server writes):

| Key | Contents |
| --- | --- |
| `workflow-dropzone-pos` | saved zone position |
| `workflow-dropzone-snap:<workflow>` | rolling auto-snapshot history, one key per workflow |
| `workflow-dropzone-recent` | recently loaded workflows (shared) |
| `workflow-dropzone-favorites` | pinned workflows (shared) |

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
