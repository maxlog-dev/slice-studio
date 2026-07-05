import { jsPDF } from 'jspdf';
import {
  A4,
  ARC_L,
  DEG,
  FACE,
  FACES,
  FLAP,
  PX_PER_MM,
  R,
  SIDE_H,
  THETA,
  TOP_H,
  toSheet,
  type FaceDef,
  type FaceId,
} from './geometry';
import type { EditorManager } from './editor';

const K = 300 / 25.4; // sheet px per mm (300 dpi)
const COS = Math.cos(THETA);
const SIN = Math.sin(THETA);
const THETA_DEG = THETA / DEG;

type P = [number, number];
type Seg = [FaceId, P, P];

// Fold (score) lines: face-shared edges + tab folds.
const SCORES: Seg[] = [
  ['side1', [0, 0], [R, 0]], // side1 / top
  ['side1', [0, SIDE_H], [R, SIDE_H]], // side1 / bottom
  ['side1', [R, 0], [R, SIDE_H]], // side1 / outer
  ['top', [0, TOP_H], [R * COS, 0]], // top / side2
  ['bottom', [0, 0], [R * COS, TOP_H]], // bottom edge B (tab fold)
  ['outer', [ARC_L, 0], [ARC_L, SIDE_H]], // outer tab fold
  ['side2', [R, 0], [R, SIDE_H]], // side2 apex tab fold
];

// Plain cut edges (tab outlines are drawn separately).
const CUTS: Seg[] = [
  ['side1', [0, 0], [0, SIDE_H]],
  ['side2', [0, 0], [0, SIDE_H]],
  ['side2', [0, SIDE_H], [R, SIDE_H]],
  ['outer', [0, 0], [ARC_L, 0]],
  ['outer', [0, SIDE_H], [ARC_L, SIDE_H]],
];

// Straight glue tabs: [face, base start, base end, outward normal (local)].
const FLAPS: [FaceId, P, P, P][] = [
  ['bottom', [0, 0], [R * COS, TOP_H], [-SIN, COS]],
  ['side2', [R, 0], [R, SIDE_H], [1, 0]],
  ['outer', [ARC_L, 0], [ARC_L, SIDE_H], [1, 0]],
];

function pt(f: FaceDef, u: number, v: number): P {
  const [x, y] = toSheet(f, u, v);
  return [x * K, y * K];
}

function traceFace(ctx: CanvasRenderingContext2D, f: FaceDef) {
  ctx.beginPath();
  if (f.id === 'top') {
    const apex = pt(f, 0, TOP_H);
    ctx.moveTo(...apex);
    ctx.lineTo(...pt(f, R, TOP_H));
    ctx.arc(apex[0], apex[1], R * K, 0, -THETA, true);
    ctx.closePath();
  } else if (f.id === 'bottom') {
    const apex = pt(f, 0, 0);
    ctx.moveTo(...apex);
    ctx.lineTo(...pt(f, R, 0));
    ctx.arc(apex[0], apex[1], R * K, 0, THETA, false);
    ctx.closePath();
  } else {
    ctx.moveTo(...pt(f, 0, 0));
    ctx.lineTo(...pt(f, f.wMM, 0));
    ctx.lineTo(...pt(f, f.wMM, f.hMM));
    ctx.lineTo(...pt(f, 0, f.hMM));
    ctx.closePath();
  }
}

function setCut(ctx: CanvasRenderingContext2D) {
  ctx.setLineDash([]);
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 0.4 * K;
}

function setScore(ctx: CanvasRenderingContext2D) {
  ctx.setLineDash([2.2 * K, 1.8 * K]);
  ctx.strokeStyle = '#777777';
  ctx.lineWidth = 0.3 * K;
}

function drawStraightFlap(ctx: CanvasRenderingContext2D, seg: [FaceId, P, P, P]) {
  const [fid, p1, p2, n] = seg;
  const f = FACE[fid];
  const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const d: P = [(p2[0] - p1[0]) / len, (p2[1] - p1[1]) / len];
  const t = Math.min(FLAP, len * 0.3); // taper (mm)
  const q1: P = [p1[0] + d[0] * t + n[0] * FLAP, p1[1] + d[1] * t + n[1] * FLAP];
  const q2: P = [p2[0] - d[0] * t + n[0] * FLAP, p2[1] - d[1] * t + n[1] * FLAP];
  setCut(ctx);
  ctx.beginPath();
  ctx.moveTo(...pt(f, ...p1));
  ctx.lineTo(...pt(f, ...q1));
  ctx.lineTo(...pt(f, ...q2));
  ctx.lineTo(...pt(f, ...p2));
  ctx.stroke();
}

/** Curved glue tab outside a sector arc. sign: -1 for top face, +1 for bottom. */
function drawArcFlap(ctx: CanvasRenderingContext2D, fid: FaceId, apexLocal: P, sign: 1 | -1) {
  const f = FACE[fid];
  const apex = pt(f, ...apexLocal);
  const ang = (deg: number) => sign * deg * DEG;
  const at = (r: number, deg: number): P => [
    apex[0] + r * K * Math.cos(ang(deg)),
    apex[1] + r * K * Math.sin(ang(deg)),
  ];
  const t = 5; // angular taper (deg)
  setCut(ctx);
  ctx.beginPath();
  ctx.moveTo(...at(R, 0));
  ctx.lineTo(...at(R + FLAP, t));
  ctx.arc(apex[0], apex[1], (R + FLAP) * K, ang(t), ang(THETA_DEG - t), sign < 0);
  ctx.lineTo(...at(R, THETA_DEG));
  ctx.stroke();
  // fold line along the arc itself
  setScore(ctx);
  ctx.beginPath();
  ctx.arc(apex[0], apex[1], R * K, ang(0), ang(THETA_DEG), sign < 0);
  ctx.stroke();
}

/** Compose the full A4 sheet (artwork + cut/fold lines) at 300 dpi. */
export function composeSheet(mgr: EditorManager): HTMLCanvasElement {
  const sheet = document.createElement('canvas');
  sheet.width = Math.round(A4.w * K);
  sheet.height = Math.round(A4.h * K);
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  // face artwork, clipped to the cut shape
  for (const f of FACES) {
    const src = mgr.toCanvasElement(f.id, K / PX_PER_MM); // -> K px per mm
    ctx.save();
    traceFace(ctx, f);
    ctx.clip();
    ctx.translate(f.sheet.x * K, f.sheet.y * K);
    ctx.rotate(f.sheet.rot * DEG);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }

  // lines
  setScore(ctx);
  for (const [fid, p1, p2] of SCORES) {
    const f = FACE[fid];
    ctx.beginPath();
    ctx.moveTo(...pt(f, ...p1));
    ctx.lineTo(...pt(f, ...p2));
    ctx.stroke();
  }
  setCut(ctx);
  for (const [fid, p1, p2] of CUTS) {
    const f = FACE[fid];
    ctx.beginPath();
    ctx.moveTo(...pt(f, ...p1));
    ctx.lineTo(...pt(f, ...p2));
    ctx.stroke();
  }
  for (const flap of FLAPS) drawStraightFlap(ctx, flap);
  drawArcFlap(ctx, 'top', [0, TOP_H], -1);
  drawArcFlap(ctx, 'bottom', [0, 0], 1);

  ctx.setLineDash([]);
  ctx.fillStyle = '#8a8a8a';
  ctx.font = `${3.4 * K}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    'Cake slice box — cut along solid lines, fold along dashed lines, glue the blank tabs inside.',
    105 * K,
    291 * K,
  );

  return sheet;
}

export function exportPDF(mgr: EditorManager) {
  const sheet = composeSheet(mgr);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  pdf.addImage(sheet.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, A4.w, A4.h);
  pdf.save('cake-slice-box.pdf');
}
