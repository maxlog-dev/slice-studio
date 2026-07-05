import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { EditorManager, type Tool } from './editor';
import { FACE, FACES, type FaceId } from './geometry';
import { composeSheet, exportPDF } from './pdf';
import Preview3D from './Preview3D';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  b: 'brush',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  t: 'tri',
};

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

export default function App() {
  const mgr = useMemo(() => new EditorManager(), []);
  const [, force] = useReducer((x: number) => x + 1, 0);
  mgr.onUpdate = force;
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');
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

  const active = FACE[mgr.active];
  const sel = ready ? mgr.selection() : [];
  const selImage = ready ? mgr.selectedImage() : null;
  const cropShape = ready ? mgr.cropShape() : 'none';
  const bg = ready ? String(mgr.canvas().backgroundColor ?? '#ffffff') : '#ffffff';
  const mirrorChoices = FACES.filter((f) => f.id !== mgr.active);
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
        <button
          className={`btn ${mgr.editAll ? 'active' : ''}`}
          title="When on: new images and drawings are added to every face, and moving/resizing a linked object updates it on all faces"
          onClick={() => mgr.setEditAll(!mgr.editAll)}
        >
          ⛓ Edit all faces
        </button>
        <div className="mirror-group">
          <span className="muted">Mirror {active.label} →</span>
          <select
            value={mirrorDst}
            onChange={(e) => setMirrorTarget(e.target.value as FaceId)}
          >
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
        <button className="btn export" disabled={!ready} onClick={() => {
          exportPDF(mgr);
          showToast('PDF downloaded — print at 100% scale on A4');
        }}>
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
            {FACES.map((f) => (
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
              {active.label} · {Math.round(active.wMM * 10) / 10} × {active.hMM} mm
            </span>
          </nav>

          <div className="stage">
            {FACES.map((f) => (
              <div
                key={f.id}
                className="face-wrap"
                style={{ display: mgr.active === f.id ? 'flex' : 'none' }}
              >
                <div className="canvas-holder" style={{ width: f.wPX, height: f.hPX }}>
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
              <input
                type="color"
                value={mgr.color}
                onChange={(e) => mgr.setColor(e.target.value)}
              />
            </div>
            <div className="ctl">
              <span className="muted">Size</span>
              <input
                type="range"
                min={0.5}
                max={12}
                step={0.5}
                value={mgr.sizeMm}
                onChange={(e) => mgr.setSize(+e.target.value)}
              />
              <span className="dim">{mgr.sizeMm} mm</span>
            </div>
            <label className="ctl muted check">
              <input
                type="checkbox"
                checked={mgr.fillShapes}
                onChange={(e) => mgr.setFillShapes(e.target.checked)}
              />{' '}
              Fill shapes
            </label>
            <div className="ctl">
              <span className="muted">Face background</span>
              <input type="color" value={bg} onChange={(e) => mgr.setBackground(e.target.value)} />
            </div>
            {sel.length > 0 && (
              <div className="sel-group">
                <span className="dim">
                  {sel.length > 1 ? `${sel.length} selected` : '1 selected'}
                </span>
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
                <button
                  className="btn"
                  title="Clone (Ctrl+D)"
                  onClick={() => void mgr.cloneSelection()}
                >
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
          <div className="preview-body">{ready && <Preview3D mgr={mgr} />}</div>
          <div className="preview-foot">
            Prints on one A4 page · slice 100 × 55 mm · solid lines cut, dashed lines fold, blank
            tabs glue.
          </div>
        </section>
      </div>
    </div>
  );
}
