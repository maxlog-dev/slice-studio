# Slice Studio — project notes for Claude

Papercraft cake-slice designer: decorate 5 faces in 2D (Fabric.js), live 3D preview
(Three.js), export a one-page A4 PDF fold template (jsPDF). UI follows the Claude
Design handoff in `design/handoff/` (dark theme, ~90% authoritative per user).
No backend; autosaves to localStorage key `cake-slice-doc-v1`.

## State (as of 2026-07-05)

- Git: `main`, `f5f54d7` (initial) → `b05be8c` (straight folds, slice selector,
  neighbor shadows, brush S/M/L, corner-anchored shapes, 3-decimal dims) →
  `4033e26` (ghost shadows = true 3D neighbors unfolded per edge, ghost z-6) →
  `ff4b660` (bottom controls bar wraps on narrow screens instead of scrolling;
  crop-adjust drag follows the mouse — clip delta sign was inverted).
- All requested features implemented and verified; `npx tsc -b` and
  `npm run build` pass. Dev server via `.claude/launch.json` ("dev", port 5173).

## Architecture (src/)

- `geometry.ts` — single source of truth. `buildGeometry(slices)` returns a
  `Geometry` for 6/8/10/12 slices (60/45/36/30° wedge). Flat-back wedge (chord,
  not arc) so ALL fold lines are straight. Faces: side1 (Side A), side2 (Side B),
  outer (Back = chord×55), top/bottom (triangles). Each `FaceDef` has `poly` +
  `edges: ('cut'|'fold'|'tab')[]` (edge i = poly[i]→poly[i+1]), svg `outline`/
  `cutPath`/`foldPath`, and a `sheet {x,y,rot}` placement. Net bbox (incl. tabs
  via `tabPts`, centroid-outward) is computed and centered on A4 at build time.
  RADIUS per slices = {6:69, 8:82, 10:93, 12:100} mm — largest that fits A4 with
  6mm margins; SIDE_H=55; PX_PER_MM=6; FLAP=8.
- `editor.ts` — `EditorManager` owns `geo` + five Fabric canvases. Tools:
  select/brush/rect/ellipse/line/tri (drag-to-draw, press point = corner).
  Edit-all sync via `syncId` + `qrDecompose(calcTransformMatrix())` (relative
  center position, `faceScale` min-ratio). Crop = centered clipPath; crop-adjust
  mode intercepts object:moving/scaling to move/resize the clipPath while
  pinning the object (clip window follows the mouse: `clipLeft + lx`, clamped
  to the image). Undo history = `DocState {slices, faces: string[]}` (60
  deep); slices changes resize canvases via `setDimensions`. Images stored as
  ≤1200px data URLs (survive reload). `mirrorTo(dst)` = clear dst + flipX clones.
- `Preview3D.tsx` — meshes built from `mgr.geo`, keyed on `slices` prop;
  CanvasTexture from `lowerCanvasEl`, dirty-flagged via `addRenderListener`.
- `pdf.ts` — `composeSheet` (300dpi offscreen canvas: artwork clipped to poly,
  solid cuts / dashed folds / blank tabs, footer caption) → jsPDF A4.
- `App.tsx` — Slice Studio UI (top bar, 56px tool rail, face pills, bottom
  context bar, 400px 3D panel, toasts). `GhostLayer` = neighbor shadows: for
  each edge of the active face, draws the face touching it IN 3D via
  `unfoldNeighbor(geo, f, i)` (geometry.ts: matches shared `FaceDef.verts` ids —
  At/Ab apex, Pt/Pb/Qt/Qb outer corners — and returns the proper rigid
  rot/x/y laying the neighbor flat across that edge; NOT the net position),
  clipped to `Path2D(n.outline)`, alpha 0.42, z-index 6 (ABOVE canvas+overlay,
  else neighbors inside a triangle face's bbox are hidden; convex faces never
  intrude past the shared edge); ALWAYS mounted (see invariant below),
  visibility via prop. Keyboard: V/B/R/O/L/T, Ctrl+Z/Y/D/A, Del, Esc.

## Critical invariants (do not break)

- Every face's intrinsic frame is (u right, v down, viewed from OUTSIDE the box)
  satisfying u×v = −outside-normal; net placements are PROPER rotations of that
  frame (`sheet.rot`), which guarantees print-outside-up folding with no
  mirroring. Editor canvas, 3D UVs, ghost layer, and PDF all share this frame.
- Fabric re-parents its `<canvas>` into `.canvas-container`: never render
  conditional React siblings BEFORE that canvas inside `.canvas-holder`
  (insertBefore crashes the whole tree). GhostLayer stays always-mounted.
- Fabric v7 positions objects by CENTER (left/top = center). Always place via
  `setPositionByOrigin(pt, 'center', 'center')`; never trust left/top as corner.
- New Fabric canvases render nothing until the first `renderAll()` (3D textures
  sample `lowerCanvasEl`).
- No React StrictMode (double-mount breaks Fabric).

## Testing workflow (preview MCP)

- Dev hooks (DEV only): `window.__mgr` (EditorManager), `window.__sheet()`
  (mounts `#sheet-debug` canvas with the composed A4; remove after use).
- Fabric listens for MOUSE events (enablePointerEvents=false): synthetic input =
  `new MouseEvent('mousedown', {clientX, clientY, button:0, buttons:1, bubbles:true,
  cancelable:true, view:window})` on `upperCanvasEl`, moves/up on `document`.
- Dispatch move sequences SYNCHRONOUSLY (no setTimeout between steps): background
  tab timer throttling makes awaited loops exceed the 30s preview_eval timeout.
- After `mgr.setActive(face)`, await two rAFs before dispatching events — hidden
  (display:none) canvases give wrong getScenePoint coords (test artifact only).
- Verify ghost/print alignment by probing canvas pixels (getImageData), not by
  eyeballing scaled screenshots.
- Clear `localStorage['cake-slice-doc-v1']` + reload to leave the app fresh
  after tests.

## Known limitations / possible next steps

- Objects don't rescale when switching slice counts (canvases resize, content
  keeps px coords; user adjusts). Sync ("edit all") only links objects created
  while it's ON.
- Ideas not yet requested: text tool, save/load design files, per-face
  export, adjustable slice height, scaling content on slice-count change.
