import { jsPDF } from 'jspdf';
import { A4, DEG, PX_PER_MM, tabPts, toSheet, type FaceDef } from './geometry';
import type { EditorManager } from './editor';

const K = 300 / 25.4; // sheet px per mm (300 dpi)

function tracePoly(ctx: CanvasRenderingContext2D, f: FaceDef) {
  ctx.beginPath();
  f.poly.forEach(([u, v], i) => {
    const [x, y] = toSheet(f, u, v);
    if (i) ctx.lineTo(x * K, y * K);
    else ctx.moveTo(x * K, y * K);
  });
  ctx.closePath();
}

function setCut(ctx: CanvasRenderingContext2D) {
  ctx.setLineDash([]);
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 0.4 * K;
}

function setFold(ctx: CanvasRenderingContext2D) {
  ctx.setLineDash([2.2 * K, 1.8 * K]);
  ctx.strokeStyle = '#777777';
  ctx.lineWidth = 0.3 * K;
}

/** Compose the full A4 sheet (artwork + cut/fold lines) at 300 dpi. */
export function composeSheet(mgr: EditorManager): HTMLCanvasElement {
  const geo = mgr.geo;
  const sheet = document.createElement('canvas');
  sheet.width = Math.round(A4.w * K);
  sheet.height = Math.round(A4.h * K);
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  // face artwork, clipped to the cut shape
  for (const f of geo.faces) {
    const src = mgr.toCanvasElement(f.id, K / PX_PER_MM); // -> K px per mm
    ctx.save();
    tracePoly(ctx, f);
    ctx.clip();
    ctx.translate(f.sheet.x * K, f.sheet.y * K);
    ctx.rotate(f.sheet.rot * DEG);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }

  // edges: solid cuts, dashed folds, tabs = cut outline + dashed fold base
  for (const f of geo.faces) {
    f.edges.forEach((kind, i) => {
      const [au, av] = f.poly[i];
      const [bu, bv] = f.poly[(i + 1) % f.poly.length];
      const [ax, ay] = toSheet(f, au, av);
      const [bx, by] = toSheet(f, bu, bv);
      if (kind === 'tab') {
        const tp = tabPts(f, i);
        setCut(ctx);
        ctx.beginPath();
        ctx.moveTo(tp[0][0] * K, tp[0][1] * K);
        for (let j = 1; j < 4; j++) ctx.lineTo(tp[j][0] * K, tp[j][1] * K);
        ctx.stroke();
        setFold(ctx);
        ctx.beginPath();
        ctx.moveTo(ax * K, ay * K);
        ctx.lineTo(bx * K, by * K);
        ctx.stroke();
      } else {
        if (kind === 'fold') setFold(ctx);
        else setCut(ctx);
        ctx.beginPath();
        ctx.moveTo(ax * K, ay * K);
        ctx.lineTo(bx * K, by * K);
        ctx.stroke();
      }
    });
  }

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
