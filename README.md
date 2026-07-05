# 🍰 Slice Studio

Design a papercraft cake slice: decorate each face in a 2D editor, watch a live 3D
preview, then download a print-ready A4 PDF fold template (cut / fold lines and
glue tabs included). Print at 100% scale, cut, fold, glue.

UI follows the Claude Design handoff in `design/` (dark "Slice Studio" theme:
top action bar, icon tool rail with drag-to-draw shapes, face pill tabs, bottom
context bar, 400px 3D panel, toasts, autosave to localStorage).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Features

- **5 editable faces** — Side A / Side B, Back (flat, so every fold line is
  straight), Top and Bottom (triangles). Pick 6 / 8 / 10 / 12 slices per cake
  (60° / 45° / 36° / 30° wedge); the radius auto-fits the largest slice that
  still prints on one A4 page. All faces are 55 mm tall.
- **Neighbor shadows** — while editing a face, every edge shows the face that
  will touch it on the folded slice (not just net neighbors — e.g. Side A shows
  Side B across the apex edge), unfolded flat and translucent, so patterns can
  be lined up across every fold and glued seam. Toggle in the bottom bar.
- **Images** — "＋ Add image" (active face) or "＋ Image on all faces" (linked);
  move, resize, rotate, clone (Ctrl+D), delete; square/circle crop with an
  "Adjust crop" mode (drag repositions the window, corner handles resize it).
- **Drawing** — brush (S / M / L presets + mm slider) plus drag-to-draw
  rect / ellipse / line / triangle (the press point anchors a corner); one color
  control, "Fill shapes" toggle, per-face background color.
- **Edit separately or simultaneously** — "⛓ Edit all faces" adds new objects to
  every face and propagates move/scale/rotate/delete/color to their twins.
- **Mirror** the active face onto any other face (target dropdown + ⇄ Copy).
- **Undo / Redo** — Ctrl+Z / Ctrl+Y (or Shift+Ctrl+Z); Delete removes, Esc deselects,
  Ctrl+A selects all; V/B/R/O/L/T switch tools.
- **Autosave** — the design persists in localStorage across reloads (images are
  stored as downscaled data URLs).
- **Live 3D preview** — the editor canvases are mapped as textures onto the wedge
  with the same intrinsic coordinates used by the printed net, so what you see is
  what folds.
- **PDF export** — single A4 page at 300 dpi: artwork clipped to each cut shape,
  solid cut lines, dashed fold lines, blank glue tabs.

## Stack

Vite + React + TypeScript, [Fabric.js](http://fabricjs.com) for the 2D editors,
[Three.js](https://threejs.org) for the 3D preview, [jsPDF](https://github.com/parallax/jsPDF)
for the export. No backend — everything runs in the browser.

## Code map

| File | Responsibility |
| --- | --- |
| `src/geometry.ts` | Slice dimensions, face definitions, net layout on A4 (placement transforms, cut shapes) |
| `src/editor.ts` | `EditorManager`: five Fabric canvases, tools, sync propagation, mirror/copy, undo history |
| `src/Preview3D.tsx` | Three.js wedge; per-face meshes with `CanvasTexture` fed live from the Fabric canvases |
| `src/pdf.ts` | Composes the 300 dpi A4 sheet (artwork + cut/score/flap lines) and wraps it in a PDF |
| `src/App.tsx` | UI: toolbar, face tabs, canvas stage with cut-shape overlay, keyboard shortcuts |

The net is constructed as a mathematical unfolding of the 3D faces (each face placed
by a proper rotation of its outside-view coordinate frame), which guarantees the
printed artwork is never mirrored and folds correctly with the print on the outside.
