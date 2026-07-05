// Cake slice = sector of a cylinder: radius R, wedge angle THETA, height SIDE_H.
// Five printable faces. The fold-out net is placed on an A4 sheet (mm, y-down):
//
//                 [side2]  (rotated 150°)
//                    \
//                  [top sector]        <- apex bottom-left, arc up
//                  [side1]  [outer]    <- crust unrolled to a rectangle
//                  [bottom sector]     <- apex top-left, arc down
//
// Every face is placed by a proper rotation of its intrinsic (u right, v down,
// viewed from OUTSIDE the box) frame, so printed artwork folds correctly.

export type FaceId = 'top' | 'bottom' | 'side1' | 'side2' | 'outer';

export const DEG = Math.PI / 180;
export const R = 100; // radius (mm)
export const THETA = 30 * DEG; // wedge angle
export const SIDE_H = 55; // slice height (mm)
export const ARC_L = R * THETA; // crust width when unrolled ≈ 52.36
export const TOP_H = R * Math.sin(THETA); // sector bounding-box height = 50
export const PX_PER_MM = 6; // editor canvas resolution
export const FLAP = 8; // glue tab depth (mm)
export const A4 = { w: 210, h: 297 };

const COS = Math.cos(THETA);
const SIN = Math.sin(THETA);
const X0 = 41; // sheet x of side1 origin
const Y1 = 138; // sheet y of side1 origin

export interface FaceDef {
  id: FaceId;
  label: string;
  wMM: number;
  hMM: number;
  wPX: number;
  hPX: number;
  outline: string; // SVG path of the cut shape, local mm coords
  cutPath: string; // edges cut with scissors (editor overlay)
  foldPath: string; // edges folded / attached to a glue tab (editor overlay)
  sheet: { x: number; y: number; rot: number }; // placement of local (0,0), deg
}

const f2 = (n: number) => +n.toFixed(2);
const RC = f2(R * COS); // 86.6
const TH = f2(TOP_H);
const AL = f2(ARC_L);

function def(
  id: FaceId,
  label: string,
  wMM: number,
  hMM: number,
  sheet: { x: number; y: number; rot: number },
  outline: string,
  cutPath: string,
  foldPath: string,
): FaceDef {
  return {
    id,
    label,
    wMM,
    hMM,
    wPX: Math.round(wMM * PX_PER_MM),
    hPX: Math.round(hMM * PX_PER_MM),
    outline,
    cutPath,
    foldPath,
    sheet,
  };
}

export const FACES: FaceDef[] = [
  def('side1', 'Side A', R, SIDE_H, { x: X0, y: Y1, rot: 0 },
    `M 0 0 L ${R} 0 L ${R} ${SIDE_H} L 0 ${SIDE_H} Z`,
    `M 0 0 L 0 ${SIDE_H}`,
    `M 0 0 L ${R} 0 M 0 ${SIDE_H} L ${R} ${SIDE_H} M ${R} 0 L ${R} ${SIDE_H}`),
  def('side2', 'Side B', R, SIDE_H, { x: f2(X0 + R * COS), y: f2(Y1 - R * SIN), rot: 150 },
    `M 0 0 L ${R} 0 L ${R} ${SIDE_H} L 0 ${SIDE_H} Z`,
    `M 0 0 L 0 ${SIDE_H} M 0 ${SIDE_H} L ${R} ${SIDE_H}`,
    `M 0 0 L ${R} 0 M ${R} 0 L ${R} ${SIDE_H}`),
  def('outer', 'Back', AL, SIDE_H, { x: X0 + R, y: Y1, rot: 0 },
    `M 0 0 L ${AL} 0 L ${AL} ${SIDE_H} L 0 ${SIDE_H} Z`,
    `M 0 0 L ${AL} 0 M 0 ${SIDE_H} L ${AL} ${SIDE_H}`,
    `M 0 0 L 0 ${SIDE_H} M ${AL} 0 L ${AL} ${SIDE_H}`),
  def('top', 'Top', R, TOP_H, { x: X0, y: f2(Y1 - TOP_H), rot: 0 },
    `M 0 ${TH} L ${R} ${TH} A ${R} ${R} 0 0 0 ${RC} 0 Z`,
    '',
    `M 0 ${TH} L ${R} ${TH} M 0 ${TH} L ${RC} 0 M ${R} ${TH} A ${R} ${R} 0 0 0 ${RC} 0`),
  def('bottom', 'Bottom', R, TOP_H, { x: X0, y: Y1 + SIDE_H, rot: 0 },
    `M 0 0 L ${R} 0 A ${R} ${R} 0 0 1 ${RC} ${TH} Z`,
    '',
    `M 0 0 L ${R} 0 M 0 0 L ${RC} ${TH} M ${R} 0 A ${R} ${R} 0 0 1 ${RC} ${TH}`),
];

export const FACE = Object.fromEntries(FACES.map((f) => [f.id, f])) as Record<FaceId, FaceDef>;

/** Local face coords (mm) -> A4 sheet coords (mm, y-down). */
export function toSheet(f: FaceDef, u: number, v: number): [number, number] {
  const a = f.sheet.rot * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [f.sheet.x + u * c - v * s, f.sheet.y + u * s + v * c];
}
