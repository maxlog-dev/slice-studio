import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { EditorManager, type Tool } from './editor';
import {
  DEG,
  PX_PER_MM,
  SLICE_OPTIONS,
  wedgeDeg,
  type FaceId,
  type SliceCount,
} from './geometry';
import { composeSheet, exportPDF } from './pdf';
import Preview3D from './Preview3D';

const GHOST_MARGIN_MM = 32;
const BRUSH_PRESETS: [string, number][] = [
  ['S', 1.5],
  ['M', 4],
  ['L', 8],
];

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  b: 'brush',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  t: 'tri',
};

const fmt = (n: number) => String(+n.toFixed(3));

function ToolIcon({ tool }: { tool: Tool }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
  } as const;
  switch (tool) {
    case 'select':
      return (
        <svg {...common} strokeLinejoin="round">
          <path d="M5 3 L12 20 L14.2 13.2 L21 11 Z" />
        </svg>
      );
    case 'brush':
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M4 20 C4 15 7 16 9 13 C13 7 17 4 19 5 C21 7 17 11 11 15 C8 17 9 20 4 20 Z" />
        </svg>
      );
    case 'rect':
      return (
        <svg {...common}>
          <rect x="4" y="6" width="16" height="12" rx="1" />
        </svg>
      );
    case 'ellipse':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="12" rx="8" ry="6.5" />
        </svg>
      );
    case 'line':
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M5 19 L19 5" />
        </svg>
      );
    default:
      return (
        <svg {...common} strokeLinejoin="round">
          <path d="M12 5 L20 19 L4 19 Z" />
        </svg>
      );
  }
}

const TOOLS: [Tool, string][] = [
  ['select', 'Select / move / resize / rotate (V) — shift-click or drag a box to select several'],
  ['brush', 'Brush (B)'],
  ['rect', 'Rectangle (R)'],
  ['ellipse', 'Ellipse (O)'],
  ['line', 'Line (L)'],
  ['tri', 'Triangle (T)'],
];

/** Translucent "unfolded neighbors" around the active face, for pattern matching.
 * Always mounted (Fabric re-parents the sibling <canvas>, so conditional React
 * children before it would corrupt reconciliation); visibility gated via props. */
function GhostLayer({
  mgr,
  active,
  slices,
  visible,
}: {
  mgr: EditorManager;
  active: FaceId;
  slices: number;
  visible: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !visible) return;
    const geo = mgr.geo;
    const A = geo.face[active];
    const M = GHOST_MARGIN_MM;
    const draw = () => {
      const w = Math.round((A.wMM + 2 * M) * PX_PER_MM);
      const h = Math.round((A.hMM + 2 * M) * PX_PER_MM);
      if (cv.width !== w) cv.width = w;
      if (cv.height !== h) cv.height = h;
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // map sheet-mm space into the active face's local frame
      ctx.scale(PX_PER_MM, PX_PER_MM);
      ctx.translate(M, M);
      ctx.rotate(-A.sheet.rot * DEG);
      ctx.translate(-A.sheet.x, -A.sheet.y);
      ctx.globalAlpha = 0.42;
      for (const N of geo.faces) {
        if (N.id === active) continue;
        const el = mgr.canvas(N.id).lowerCanvasEl;
        ctx.save();
        ctx.translate(N.sheet.x, N.sheet.y);
        ctx.rotate(N.sheet.rot * DEG);
        ctx.clip(new Path2D(N.outline));
        ctx.drawImage(el, 0, 0, el.width, el.height, 0, 0, N.wMM, N.hMM);
        ctx.restore();
      }
    };
    draw();
    let raf = 0;
    const unsubscribe = mgr.addRenderListener((id) => {
      if (id === active) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [mgr, active, slices, visible]);

  const px = GHOST_MARGIN_MM * PX_PER_MM;
  return (
    <canvas
      ref={ref}
      className="ghost"
      style={{ left: -px, top: -px, display: visible ? 'block' : 'none' }}
    />
  );
}

export default function App() {
  const mgr = useMemo(() => new EditorManager(), []);
  const [, force] = useReducer((x: number) => x + 1, 0);
  mgr.onUpdate = force;
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');
  const [ghosts, setGhosts] = useState(true);
  const [mirrorTarget, setMirrorTarget] = useState<FaceId>('side2');
  const fileInput = useRef<HTMLInputElement>(null);
  const fileAll = useRef(false);
  const toastTimer = useRef<number>(undefined);
  const mounted = useRef(new Set<FaceId>());

  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  };
  mgr.onToast = showToast;

  useEffect(() => {
    if (mgr.ready) setReady(true);
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__mgr = mgr;
      w.__sheet = () => {
        const c = composeSheet(mgr);
        c.style.cssText =
          'position:fixed;top:0;left:0;height:100vh;width:auto;z-index:999;border:1px solid #999;background:#fff';
        c.id = 'sheet-debug';
        document.getElementById('sheet-debug')?.remove();
        document.body.appendChild(c);
        return 'ok';
      };
    }
  }, [mgr]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        void (e.shiftKey ? mgr.redo() : mgr.undo());
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        void mgr.redo();
      } else if ((e.ctrlKey || e.metaKey) && k === 'd') {
        e.preventDefault();
        void mgr.cloneSelection();
      } else if ((e.ctrlKey || e.metaKey) && k === 'a') {
        e.preventDefault();
        mgr.selectAll();
      } else if (k === 'delete' || k === 'backspace') {
        if (mgr.selection().length) {
          e.preventDefault();
          mgr.deleteSelection();
        }
      } else if (k === 'escape') {
        mgr.deselect();
      } else if (TOOL_KEYS[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        mgr.setTool(TOOL_KEYS[k]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mgr]);

  const geo = mgr.geo;
  const active = geo.face[mgr.active];
  const sel = ready ? mgr.selection() : [];
  const selImage = ready ? mgr.selectedImage() : null;
  const cropShape = ready ? mgr.cropShape() : 'none';
  const bg = ready ? String(mgr.canvas().backgroundColor ?? '#ffffff') : '#ffffff';
  const mirrorChoices = geo.faces.filter((f) => f.id !== mgr.active);
  const mirrorDst = mirrorTarget === mgr.active ? mirrorChoices[0].id : mirrorTarget;

  const pickFile = (all: boolean) => {
    fileAll.current = all;
    fileInput.current?.click();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M3 19 L12 4 L21 19 Z" fill="#e0567a" opacity="0.9" />
            <path d="M6.5 19 L12 9.5 L17.5 19 Z" fill="#fff" opacity="0.35" />
          </svg>
          <span>Slice Studio</span>
        </div>
        <div className="vsep" />
        <button
          className="btn"
          title="Undo (Ctrl+Z)"
          disabled={!mgr.canUndo}
          onClick={() => void mgr.undo()}
        >
          ↩ Undo
        </button>
        <button
          className="btn"
          title="Redo (Ctrl+Y)"
          disabled={!mgr.canRedo}
          onClick={() => void mgr.redo()}
        >
          ↪ Redo
        </button>
        <div className="vsep" />
        <div className="mirror-group" title="How many slices the whole cake is cut into — sets the wedge angle">
          <span className="muted">Slices</span>
          <select
            value={geo.slices}
            onChange={(e) => mgr.setSlices(+e.target.value as SliceCount)}
          >
            {SLICE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} · {fmt(wedgeDeg(n))}°
              </option>
            ))}
          </select>
        </div>
        <button
          className={`btn ${mgr.editAll ? 'active' : ''}`}
          title="When on: new images and drawings are added to every face, and moving/resizing a linked object updates it on all faces"
          onClick={() => mgr.setEditAll(!mgr.editAll)}
        >
          ⛓ Edit all faces
        </button>
        <div className="mirror-group">
          <span className="muted">Mirror {active.label} →</span>
          <select value={mirrorDst} onChange={(e) => setMirrorTarget(e.target.value as FaceId)}>
            {mirrorChoices.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <button
            className="btn"
            title="Copy this face's design onto the target face, mirrored"
            onClick={() => void mgr.mirrorTo(mirrorDst)}
          >
            ⇄ Copy
          </button>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => pickFile(false)}>
          ＋ Add image
        </button>
        <button
          className="btn"
          title="Add the image to all 5 faces at once (linked)"
          onClick={() => pickFile(true)}
        >
          ＋ Image on all faces
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void mgr.addImage(file, fileAll.current);
            e.target.value = '';
          }}
        />
        <button
          className="btn export"
          disabled={!ready}
          onClick={() => {
            exportPDF(mgr);
            showToast('PDF downloaded — print at 100% scale on A4');
          }}
        >
          ⬇ Download A4 PDF
        </button>
      </header>

      <div className="main">
        <aside className="rail">
          {TOOLS.map(([tool, tip]) => (
            <button
              key={tool}
              className={`tbtn ${mgr.tool === tool ? 'active' : ''}`}
              title={tip}
              onClick={() => mgr.setTool(tool)}
            >
              <ToolIcon tool={tool} />
            </button>
          ))}
        </aside>

        <main className="editor-col">
          <nav className="tabs">
            {geo.faces.map((f) => (
              <button
                key={f.id}
                className={`tab ${mgr.active === f.id ? 'active' : ''}`}
                onClick={() => mgr.setActive(f.id)}
              >
                {f.label}
              </button>
            ))}
            <div className="spacer" />
            <span className="muted">
              {active.label} · {fmt(active.wMM)} × {fmt(active.hMM)} mm
            </span>
          </nav>

          <div className="stage">
            {geo.faces.map((f) => (
              <div
                key={f.id}
                className="face-wrap"
                style={{ display: mgr.active === f.id ? 'flex' : 'none' }}
              >
                <div className="canvas-holder" style={{ width: f.wPX, height: f.hPX }}>
                  <GhostLayer
                    mgr={mgr}
                    active={f.id}
                    slices={geo.slices}
                    visible={ready && ghosts && mgr.active === f.id}
                  />
                  <canvas
                    ref={(el) => {
                      if (el && !mounted.current.has(f.id)) {
                        mounted.current.add(f.id);
                        mgr.mount(f.id, el);
                        if (mgr.ready) setReady(true);
                      }
                    }}
                  />
                  <svg
                    className="overlay"
                    viewBox={`0 0 ${f.wMM} ${f.hMM}`}
                    width={f.wPX}
                    height={f.hPX}
                    preserveAspectRatio="none"
                  >
                    <path
                      d={`M 0 0 L ${f.wMM} 0 L ${f.wMM} ${f.hMM} L 0 ${f.hMM} Z ${f.outline}`}
                      fillRule="evenodd"
                      fill="rgba(19,20,24,0.88)"
                    />
                    {f.cutPath && (
                      <path d={f.cutPath} fill="none" stroke="#454a57" strokeWidth={0.28} />
                    )}
                    <path
                      d={f.foldPath}
                      fill="none"
                      stroke="#5b6070"
                      strokeWidth={0.28}
                      strokeDasharray="1.5 1.25"
                    />
                  </svg>
                </div>
              </div>
            ))}
            {toast && <div className="toast">{toast}</div>}
          </div>

          <div className="controls">
            <div className="ctl">
              <span className="muted">Color</span>
              <input type="color" value={mgr.color} onChange={(e) => mgr.setColor(e.target.value)} />
            </div>
            <div className="ctl">
              <span className="muted">Size</span>
              {BRUSH_PRESETS.map(([label, mm]) => (
                <button
                  key={label}
                  className={`btn sm ${mgr.sizeMm === mm ? 'active' : ''}`}
                  title={`${label} · ${mm} mm`}
                  onClick={() => mgr.setSize(mm)}
                >
                  {label}
                </button>
              ))}
              <input
                type="range"
                min={0.5}
                max={12}
                step={0.5}
                value={mgr.sizeMm}
                onChange={(e) => mgr.setSize(+e.target.value)}
              />
              <span className="dim">{fmt(mgr.sizeMm)} mm</span>
            </div>
            <label className="ctl muted check">
              <input
                type="checkbox"
                checked={mgr.fillShapes}
                onChange={(e) => mgr.setFillShapes(e.target.checked)}
              />{' '}
              Fill shapes
            </label>
            <label
              className="ctl muted check"
              title="Show the neighboring faces, unfolded flat around this one, to line patterns up across edges"
            >
              <input type="checkbox" checked={ghosts} onChange={(e) => setGhosts(e.target.checked)} />{' '}
              Neighbor shadows
            </label>
            <div className="ctl">
              <span className="muted">Face background</span>
              <input type="color" value={bg} onChange={(e) => mgr.setBackground(e.target.value)} />
            </div>
            {sel.length > 0 && (
              <div className="sel-group">
                <span className="dim">{sel.length > 1 ? `${sel.length} selected` : '1 selected'}</span>
                {selImage && (
                  <div className="ctl">
                    <span className="muted">Crop</span>
                    <button
                      className={`btn sm ${cropShape === 'none' ? 'active' : ''}`}
                      onClick={() => mgr.crop('none')}
                    >
                      Off
                    </button>
                    <button
                      className={`btn sm ${cropShape === 'square' ? 'active' : ''}`}
                      onClick={() => mgr.crop('square')}
                    >
                      ▢
                    </button>
                    <button
                      className={`btn sm ${cropShape === 'circle' ? 'active' : ''}`}
                      onClick={() => mgr.crop('circle')}
                    >
                      ◯
                    </button>
                    {cropShape !== 'none' && (
                      <button
                        className={`btn sm ${mgr.cropAdjust ? 'active' : ''}`}
                        title="When on, drag the image to choose which part sits inside the crop"
                        onClick={() => mgr.setCropAdjust(!mgr.cropAdjust)}
                      >
                        ⊹ Adjust crop
                      </button>
                    )}
                  </div>
                )}
                <button className="btn" title="Clone (Ctrl+D)" onClick={() => void mgr.cloneSelection()}>
                  ⧉ Clone
                </button>
                <button className="btn danger" title="Delete (Del)" onClick={() => mgr.deleteSelection()}>
                  ✕ Delete
                </button>
              </div>
            )}
          </div>
        </main>

        <section className="preview-col">
          <div className="preview-head">
            <span>3D preview</span>
            <span className="dim">drag to orbit · scroll to zoom</span>
          </div>
          <div className="preview-body">{ready && <Preview3D mgr={mgr} slices={geo.slices} />}</div>
          <div className="preview-foot">
            Prints on one A4 page · slice {fmt(geo.R)} × {fmt(55)} mm ·{' '}
            {fmt(wedgeDeg(geo.slices))}° wedge · solid lines cut, dashed lines fold, blank tabs
            glue.
          </div>
        </section>
      </div>
    </div>
  );
}
