// Cake slice = wedge of a cylinder with a FLAT back (chord instead of arc), so
// every fold line on the printable net is straight. Five printable faces.
// The fold-out net on an A4 sheet (mm, y-down):
//
//                 [side2]  (rotated 180°-θ)
//                    \
//                  [top triangle]      <- apex bottom-left
//                  [side1]  [back]
//                  [bottom triangle]   <- apex top-left
//
// Every face is placed by a proper rotation of its intrinsic (u right, v down,
// viewed from OUTSIDE the box) frame, so printed artwork folds correctly.

export type FaceId = 'top' | 'bottom' | 'side1' | 'side2' | 'outer';
export type EdgeKind = 'cut' | 'fold' | 'tab';

export const DEG = Math.PI / 180;
export const SIDE_H = 55; // slice height (mm)
export const PX_PER_MM = 6; // editor canvas resolution
export const FLAP = 8; // glue tab depth (mm)
export const A4 = { w: 210, h: 297 };
export const MARGIN = 6; // min print margin (mm)

export const SLICE_OPTIONS = [6, 8, 10, 12] as const;
export type SliceCount = (typeof SLICE_OPTIONS)[number];

// Largest radius whose net (with tabs) fits A4 portrait at MARGIN.
const RADIUS: Record<SliceCount, number> = { 6: 69, 8: 82, 10: 93, 12: 100 };

type P = [number, number];

export interface FaceDef {
  id: FaceId;
  label: string;
  wMM: number;
  hMM: number;
  wPX: number;
  hPX: number;
  poly: P[]; // cut shape, local mm coords
  edges: EdgeKind[]; // edge i runs poly[i] -> poly[i+1]
  outline: string; // svg path of poly
  cutPath: string; // cut edges (editor overlay)
  foldPath: string; // fold + tab-fold edges (editor overlay)
  sheet: { x: number; y: number; rot: number }; // placement of local (0,0), deg
}

export interface Geometry {
  slices: SliceCount;
  R: number;
  theta: number; // wedge angle, rad
  chord: number; // back-panel width
  topH: number; // top/bottom triangle height
  faces: FaceDef[];
  face: Record<FaceId, FaceDef>;
}

const f3 = (n: number) => +n.toFixed(3);

export function toSheet(f: FaceDef, u: number, v: number): P {
  const a = f.sheet.rot * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [f.sheet.x + u * c - v * s, f.sheet.y + u * s + v * c];
}

function sheetCentroid(f: FaceDef): P {
  let cx = 0;
  let cy = 0;
  for (const p of f.poly) {
    const q = toSheet(f, p[0], p[1]);
    cx += q[0];
    cy += q[1];
  }
  return [cx / f.poly.length, cy / f.poly.length];
}

/** Glue-tab outline (4 sheet-mm points) for edge i of a face, extending outward. */
export function tabPts(f: FaceDef, i: number, depth = FLAP): [P, P, P, P] {
  const a = f.poly[i];
  const b = f.poly[(i + 1) % f.poly.length];
  const A = toSheet(f, a[0], a[1]);
  const B = toSheet(f, b[0], b[1]);
  const [cx, cy] = sheetCentroid(f);
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const ux = (B[0] - A[0]) / len;
  const uy = (B[1] - A[1]) / len;
  let nx = -uy;
  let ny = ux;
  const mx = (A[0] + B[0]) / 2;
  const my = (A[1] + B[1]) / 2;
  if (nx * (cx - mx) + ny * (cy - my) > 0) {
    nx = -nx;
    ny = -ny;
  }
  const k = Math.min(depth, len * 0.3);
  return [
    A,
    [A[0] + nx * depth + ux * k, A[1] + ny * depth + uy * k],
    [B[0] + nx * depth - ux * k, B[1] + ny * depth - uy * k],
    B,
  ];
}

function paths(poly: P[], edges: EdgeKind[]) {
  const seg = (kinds: EdgeKind[]) =>
    edges
      .map((kind, i) => ({ kind, i }))
      .filter(({ kind }) => kinds.includes(kind))
      .map(({ i }) => {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        return `M ${f3(a[0])} ${f3(a[1])} L ${f3(b[0])} ${f3(b[1])}`;
      })
      .join(' ');
  const outline =
    poly.map((p, i) => `${i ? 'L' : 'M'} ${f3(p[0])} ${f3(p[1])}`).join(' ') + ' Z';
  return { outline, cutPath: seg(['cut']), foldPath: seg(['fold', 'tab']) };
}

export function buildGeometry(slices: SliceCount): Geometry {
  const theta = (2 * Math.PI) / slices;
  const R = RADIUS[slices];
  const H = SIDE_H;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const chord = 2 * R * Math.sin(theta / 2);
  const topH = R * sin;

  const rect = (w: number): P[] => [[0, 0], [w, 0], [w, H], [0, H]];

  const mk = (
    id: FaceId,
    label: string,
    poly: P[],
    edges: EdgeKind[],
    sheet: { x: number; y: number; rot: number },
  ): FaceDef => {
    const wMM = Math.max(...poly.map((p) => p[0]));
    const hMM = Math.max(...poly.map((p) => p[1]));
    return {
      id,
      label,
      wMM,
      hMM,
      wPX: Math.round(wMM * PX_PER_MM),
      hPX: Math.round(hMM * PX_PER_MM),
      poly,
      edges,
      ...paths(poly, edges),
      sheet,
    };
  };

  // placements are relative to side1's origin; centered on the sheet below
  const faces: FaceDef[] = [
    mk('side1', 'Side A', rect(R), ['fold', 'fold', 'fold', 'cut'], { x: 0, y: 0, rot: 0 }),
    mk('side2', 'Side B', rect(R), ['fold', 'tab', 'cut', 'cut'], {
      x: f3(R * cos),
      y: f3(-R * sin),
      rot: 180 - slicesToDeg(slices),
    }),
    mk('outer', 'Back', rect(f3(chord)), ['cut', 'tab', 'cut', 'fold'], { x: R, y: 0, rot: 0 }),
    mk('top', 'Top', [[0, f3(topH)], [R, f3(topH)], [f3(R * cos), 0]], ['fold', 'tab', 'fold'], {
      x: 0,
      y: f3(-topH),
      rot: 0,
    }),
    mk('bottom', 'Bottom', [[0, 0], [R, 0], [f3(R * cos), f3(topH)]], ['fold', 'tab', 'tab'], {
      x: 0,
      y: H,
      rot: 0,
    }),
  ];
  const face = Object.fromEntries(faces.map((f) => [f.id, f])) as Record<FaceId, FaceDef>;

  // center the whole net (including tabs) on the printable area
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  const acc = (p: P) => {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  };
  for (const f of faces) {
    f.poly.forEach((p) => acc(toSheet(f, p[0], p[1])));
    f.edges.forEach((kind, i) => {
      if (kind === 'tab') tabPts(f, i).forEach(acc);
    });
  }
  const usableH = A4.h - 10; // keep the footer caption clear
  const dx = f3((A4.w - (x1 - x0)) / 2 - x0);
  const dy = f3((usableH - (y1 - y0)) / 2 - y0);
  for (const f of faces) {
    f.sheet.x = f3(f.sheet.x + dx);
    f.sheet.y = f3(f.sheet.y + dy);
  }

  return { slices, R, theta, chord, topH, faces, face };
}

function slicesToDeg(slices: SliceCount) {
  return 360 / slices;
}

/** Wedge angle in degrees for the UI. */
export function wedgeDeg(slices: SliceCount) {
  return 360 / slices;
}
