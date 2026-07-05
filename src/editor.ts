import {
  ActiveSelection,
  Canvas,
  Circle,
  Ellipse,
  FabricImage,
  FabricObject,
  Line,
  PencilBrush,
  Point,
  Rect,
  Triangle,
  util,
} from 'fabric';
import { FACE, FACES, PX_PER_MM, type FaceId } from './geometry';

declare module 'fabric' {
  interface FabricObject {
    syncId?: string;
  }
}

const PROPS = ['syncId'];
const STORAGE_KEY = 'cake-slice-doc-v1';
const uid = () => Math.random().toString(36).slice(2, 10);

export type Tool = 'select' | 'brush' | 'rect' | 'ellipse' | 'line' | 'tri';
export type CropShape = 'square' | 'circle' | 'none';

interface CreateDrag {
  face: FaceId;
  start: Point;
  obj: FabricObject;
}

interface CropRef {
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  clipLeft: number;
  clipTop: number;
  clipSize: number;
}

export class EditorManager {
  private canvases = new Map<FaceId, Canvas>();
  private history: string[][] = [];
  private hIndex = -1;
  private suppress = 0;
  private snapTimer: number | undefined;
  private saveTimer: number | undefined;
  private renderListeners = new Set<(id: FaceId) => void>();
  private creating: CreateDrag | null = null;
  private cropRef: CropRef | null = null;

  active: FaceId = 'side1';
  tool: Tool = 'select';
  editAll = false;
  color = '#e0567a';
  sizeMm = 4; // brush / outline width, mm
  fillShapes = true;
  cropAdjust = false;
  onUpdate: (() => void) | null = null;
  onToast: ((msg: string) => void) | null = null;

  get ready() {
    return this.canvases.size === FACES.length;
  }

  canvas(id: FaceId = this.active): Canvas {
    return this.canvases.get(id)!;
  }

  get canUndo() {
    return this.hIndex > 0;
  }

  get canRedo() {
    return this.hIndex < this.history.length - 1;
  }

  addRenderListener(cb: (id: FaceId) => void) {
    this.renderListeners.add(cb);
    return () => this.renderListeners.delete(cb);
  }

  mount(id: FaceId, el: HTMLCanvasElement) {
    if (this.canvases.has(id)) return;
    const f = FACE[id];
    const c = new Canvas(el, {
      width: f.wPX,
      height: f.hPX,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
    });
    const brush = new PencilBrush(c);
    brush.color = this.color;
    brush.width = this.sizeMm * PX_PER_MM;
    c.freeDrawingBrush = brush;

    c.on('after:render', () => this.renderListeners.forEach((cb) => cb(id)));
    c.on('object:modified', (e) => {
      if (this.suppress) return;
      if (this.editAll && e.target) this.propagateTransform(id, e.target);
      this.scheduleSnapshot();
    });
    c.on('object:added', () => {
      if (!this.suppress) this.scheduleSnapshot();
    });
    c.on('object:removed', () => {
      if (!this.suppress) this.scheduleSnapshot();
    });
    c.on('path:created', (e) => {
      if (this.suppress) return;
      const path = (e as { path: FabricObject }).path;
      if (this.editAll && path) {
        path.syncId = uid();
        void this.cloneToOtherFaces(id, path, path.syncId);
      }
      this.scheduleSnapshot();
    });
    const notify = () => {
      this.cropAdjust = false;
      this.onUpdate?.();
    };
    c.on('selection:created', notify);
    c.on('selection:updated', notify);
    c.on('selection:cleared', notify);

    // drag-to-draw shape tools
    c.on('mouse:down', (e) => {
      if (!this.isShapeTool() || this.creating) return;
      const p = e.scenePoint;
      this.creating = { face: id, start: p, obj: this.makeShape(p) };
      this.suppress++;
      c.add(this.creating.obj);
      this.suppress--;
    });
    c.on('mouse:move', (e) => {
      if (this.creating?.face === id) this.updateShape(this.creating, e.scenePoint);
    });
    c.on('mouse:up', () => {
      if (this.creating?.face === id) this.finishShape(this.creating);
      if (this.cropAdjust && this.cropRef) this.finishCropAdjust();
    });

    // crop-adjust mode: dragging repositions the clip window, corner-scaling resizes it
    c.on('mouse:down', (e) => {
      if (!this.cropAdjust || this.tool !== 'select') return;
      const o = e.target;
      if (o && o.isType('image') && o.clipPath) {
        const cp = o.clipPath as FabricObject;
        this.cropRef = {
          left: o.left,
          top: o.top,
          scaleX: o.scaleX,
          scaleY: o.scaleY,
          clipLeft: cp.left,
          clipTop: cp.top,
          clipSize: cp.isType('circle') ? (cp as Circle).radius * 2 : cp.width,
        };
      } else this.cropRef = null;
    });
    c.on('object:moving', (e) => {
      if (!this.cropAdjust || !this.cropRef) return;
      const o = e.target;
      if (!o.isType('image') || !o.clipPath) return;
      const r = this.cropRef;
      const cp = o.clipPath as FabricObject;
      // canvas-space drag -> object-local delta
      const dx = o.left - r.left;
      const dy = o.top - r.top;
      const a = -(o.angle || 0) * (Math.PI / 180);
      let lx = (dx * Math.cos(a) - dy * Math.sin(a)) / (o.scaleX || 1);
      const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / (o.scaleY || 1);
      if (o.flipX) lx = -lx;
      const s = r.clipSize;
      const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
      cp.set({
        left: clamp(r.clipLeft - lx, Math.max(0, (o.width - s) / 2)),
        top: clamp(r.clipTop - ly, Math.max(0, (o.height - s) / 2)),
      });
      o.set({ left: r.left, top: r.top });
      o.dirty = true;
    });
    c.on('object:scaling', (e) => {
      if (!this.cropAdjust || !this.cropRef) return;
      const o = e.target;
      if (!o.isType('image') || !o.clipPath) return;
      const r = this.cropRef;
      const cp = o.clipPath as FabricObject;
      const k = o.scaleX / r.scaleX;
      const m = Math.min(o.width, o.height);
      const s = Math.max(0.15 * m, Math.min(m, r.clipSize * k));
      if (cp.isType('circle')) (cp as Circle).set({ radius: s / 2 });
      else cp.set({ width: s, height: s });
      const lim = Math.max(0, (o.width - s) / 2);
      const climY = Math.max(0, (o.height - s) / 2);
      cp.set({
        left: Math.max(-lim, Math.min(lim, cp.left)),
        top: Math.max(-climY, Math.min(climY, cp.top)),
      });
      o.set({ scaleX: r.scaleX, scaleY: r.scaleY, left: r.left, top: r.top });
      o.dirty = true;
    });

    this.canvases.set(id, c);
    c.renderAll(); // paint background now — the 3D preview samples this canvas
    if (this.ready) void this.initDoc();
  }

  private async initDoc() {
    const saved = this.loadDoc();
    if (saved) {
      await this.applyState(saved);
    }
    this.history = [this.serialize()];
    this.hIndex = 0;
    this.onUpdate?.();
  }

  // ---------- UI state ----------

  setActive(id: FaceId) {
    this.canvas().discardActiveObject();
    this.canvas().requestRenderAll();
    this.active = id;
    this.cropAdjust = false;
    this.canvas(id).calcOffset();
    this.onUpdate?.();
  }

  private isShapeTool() {
    return this.tool !== 'select' && this.tool !== 'brush';
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.cropAdjust = false;
    const shape = this.isShapeTool();
    for (const c of this.canvases.values()) {
      c.isDrawingMode = tool === 'brush';
      c.selection = tool === 'select';
      c.skipTargetFind = shape;
      c.defaultCursor = shape ? 'crosshair' : 'default';
      if (tool !== 'select') {
        c.discardActiveObject();
        c.requestRenderAll();
      }
    }
    this.onUpdate?.();
  }

  setEditAll(on: boolean) {
    this.editAll = on;
    this.onUpdate?.();
  }

  setCropAdjust(on: boolean) {
    this.cropAdjust = on;
    this.onUpdate?.();
  }

  setColor(color: string) {
    this.color = color;
    for (const c of this.canvases.values()) {
      if (c.freeDrawingBrush) c.freeDrawingBrush.color = color;
    }
    const objs = this.selection().filter((o) => !o.isType('image'));
    for (const o of objs) {
      for (const t of this.withTwins(o)) {
        const filled = !!t.fill && t.fill !== 'transparent';
        if (filled && !t.isType('line', 'path')) t.set('fill', color);
        else t.set('stroke', color);
        t.dirty = true;
      }
    }
    if (objs.length) {
      for (const c of this.canvases.values()) c.requestRenderAll();
      this.scheduleSnapshot();
    }
    this.onUpdate?.();
  }

  setSize(mm: number) {
    this.sizeMm = mm;
    const px = mm * PX_PER_MM;
    for (const c of this.canvases.values()) {
      if (c.freeDrawingBrush) c.freeDrawingBrush.width = px;
    }
    const objs = this.selection().filter((o) => !o.isType('image'));
    for (const o of objs) {
      for (const t of this.withTwins(o)) {
        const filled = !!t.fill && t.fill !== 'transparent';
        if (!filled || t.isType('line', 'path')) {
          t.set('strokeWidth', px);
          t.dirty = true;
        }
      }
    }
    if (objs.length) {
      for (const c of this.canvases.values()) c.requestRenderAll();
      this.scheduleSnapshot();
    }
    this.onUpdate?.();
  }

  setFillShapes(on: boolean) {
    this.fillShapes = on;
    this.onUpdate?.();
  }

  selection(): FabricObject[] {
    return this.ready ? this.canvas().getActiveObjects() : [];
  }

  selectedImage(): FabricObject | null {
    const s = this.selection();
    return s.length === 1 && s[0].isType('image') ? s[0] : null;
  }

  selectAll() {
    const c = this.canvas();
    const objs = c.getObjects();
    if (!objs.length) return;
    c.discardActiveObject();
    if (objs.length === 1) c.setActiveObject(objs[0]);
    else c.setActiveObject(new ActiveSelection(objs, { canvas: c }));
    c.requestRenderAll();
    this.onUpdate?.();
  }

  deselect() {
    this.canvas().discardActiveObject();
    this.canvas().requestRenderAll();
    this.onUpdate?.();
  }

  // ---------- shape creation (drag to draw) ----------

  private shapeStyle() {
    const px = this.sizeMm * PX_PER_MM;
    return this.fillShapes
      ? { fill: this.color, stroke: undefined, strokeWidth: 0 }
      : { fill: 'transparent', stroke: this.color, strokeWidth: px };
  }

  private makeShape(p: Point): FabricObject {
    const st = this.shapeStyle();
    switch (this.tool) {
      case 'rect':
        return new Rect({ left: p.x, top: p.y, width: 1, height: 1, ...st });
      case 'ellipse':
        return new Ellipse({ left: p.x, top: p.y, rx: 1, ry: 1, originX: 'center', originY: 'center', ...st });
      case 'tri':
        return new Triangle({ left: p.x, top: p.y, width: 1, height: 1, originX: 'center', originY: 'center', ...st });
      default:
        return new Line([p.x, p.y, p.x, p.y], {
          stroke: this.color,
          strokeWidth: this.sizeMm * PX_PER_MM,
          strokeLineCap: 'round',
        });
    }
  }

  private updateShape(d: CreateDrag, p: Point) {
    const { start, obj } = d;
    const w = Math.abs(p.x - start.x);
    const h = Math.abs(p.y - start.y);
    const cx = (start.x + p.x) / 2;
    const cy = (start.y + p.y) / 2;
    if (obj.isType('rect')) {
      obj.set({ left: Math.min(start.x, p.x), top: Math.min(start.y, p.y), width: Math.max(w, 1), height: Math.max(h, 1) });
    } else if (obj.isType('ellipse')) {
      (obj as Ellipse).set({ left: cx, top: cy, rx: Math.max(w / 2, 0.5), ry: Math.max(h / 2, 0.5) });
    } else if (obj.isType('triangle')) {
      obj.set({ left: cx, top: cy, width: Math.max(w, 1), height: Math.max(h, 1) });
    } else {
      (obj as Line).set({ x2: p.x, y2: p.y });
    }
    obj.setCoords();
    this.canvas(d.face).requestRenderAll();
  }

  private finishShape(d: CreateDrag) {
    this.creating = null;
    const c = this.canvas(d.face);
    const box = d.obj.getBoundingRect();
    if (Math.max(box.width, box.height) < 6) {
      this.suppress++;
      c.remove(d.obj);
      this.suppress--;
      c.requestRenderAll();
      return;
    }
    if (this.editAll) {
      d.obj.syncId = uid();
      void this.cloneToOtherFaces(d.face, d.obj, d.obj.syncId);
    }
    c.requestRenderAll();
    this.snapshot();
  }

  // ---------- history & persistence ----------

  private serialize(): string[] {
    return FACES.map((f) => JSON.stringify(this.canvas(f.id).toObject(PROPS)));
  }

  private scheduleSnapshot() {
    window.clearTimeout(this.snapTimer);
    this.snapTimer = window.setTimeout(() => this.snapshot(), 120);
  }

  private flushSnapshot() {
    if (this.snapTimer !== undefined) {
      window.clearTimeout(this.snapTimer);
      this.snapTimer = undefined;
      this.snapshot();
    }
  }

  snapshot() {
    this.snapTimer = undefined;
    const state = this.serialize();
    const prev = this.history[this.hIndex];
    if (prev && prev.every((s, i) => s === state[i])) return;
    this.history.splice(this.hIndex + 1);
    this.history.push(state);
    if (this.history.length > 60) this.history.shift();
    this.hIndex = this.history.length - 1;
    this.saveDoc(state);
    this.onUpdate?.();
  }

  private saveDoc(state: string[]) {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        this.onToast?.('Could not auto-save (storage full)');
      }
    }, 600);
  }

  private loadDoc(): string[] | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw);
      if (Array.isArray(state) && state.length === FACES.length) return state;
    } catch {
      /* corrupted doc — start fresh */
    }
    return null;
  }

  async undo() {
    this.flushSnapshot();
    if (!this.canUndo) return;
    this.hIndex--;
    await this.applyState(this.history[this.hIndex]);
    this.saveDoc(this.history[this.hIndex]);
  }

  async redo() {
    this.flushSnapshot();
    if (!this.canRedo) return;
    this.hIndex++;
    await this.applyState(this.history[this.hIndex]);
    this.saveDoc(this.history[this.hIndex]);
  }

  private async applyState(state: string[]) {
    this.suppress++;
    try {
      const live = this.serialize();
      for (let i = 0; i < FACES.length; i++) {
        if (state[i] === live[i]) continue;
        const c = this.canvas(FACES[i].id);
        await c.loadFromJSON(JSON.parse(state[i]));
        c.requestRenderAll();
      }
    } finally {
      this.suppress--;
    }
    this.cropAdjust = false;
    this.onUpdate?.();
  }

  // ---------- edit-all-faces sync ----------

  private otherFaces(src: FaceId): FaceId[] {
    return FACES.filter((f) => f.id !== src).map((f) => f.id);
  }

  private findBySyncId(id: FaceId, syncId: string): FabricObject | undefined {
    return this.canvas(id).getObjects().find((o) => o.syncId === syncId);
  }

  private withTwins(o: FabricObject): FabricObject[] {
    const out = [o];
    if (this.editAll && o.syncId) {
      for (const fid of this.otherFaces(this.active)) {
        const t = this.findBySyncId(fid, o.syncId);
        if (t) out.push(t);
      }
    }
    return out;
  }

  /** Relative scale when mapping content between two faces (like the design's relMap). */
  private faceScale(src: FaceId, dst: FaceId) {
    const a = FACE[src];
    const b = FACE[dst];
    return Math.min(b.wPX / a.wPX, b.hPX / a.hPX);
  }

  /** Copy the absolute transform of every modified object to its synced twins. */
  private propagateTransform(src: FaceId, target: FabricObject) {
    const objs = target instanceof ActiveSelection ? target.getObjects() : [target];
    const sf = FACE[src];
    for (const o of objs) {
      if (!o.syncId) continue;
      const d = util.qrDecompose(o.calcTransformMatrix());
      const relX = d.translateX / sf.wPX;
      const relY = d.translateY / sf.hPX;
      for (const fid of this.otherFaces(src)) {
        const twin = this.findBySyncId(fid, o.syncId);
        if (!twin) continue;
        const tf = FACE[fid];
        const k = this.faceScale(src, fid);
        twin.set({
          angle: d.angle,
          scaleX: d.scaleX * k,
          scaleY: d.scaleY * k,
          skewX: d.skewX,
          skewY: d.skewY,
          flipX: false,
          flipY: false,
        });
        twin.setPositionByOrigin(new Point(relX * tf.wPX, relY * tf.hPX), 'center', 'center');
        twin.setCoords();
        this.canvas(fid).requestRenderAll();
      }
    }
  }

  private async cloneToOtherFaces(src: FaceId, obj: FabricObject, syncId: string) {
    this.suppress++;
    try {
      const sf = FACE[src];
      const ctr = obj.getCenterPoint();
      for (const fid of this.otherFaces(src)) {
        const tf = FACE[fid];
        const k = this.faceScale(src, fid);
        const copy = await obj.clone(PROPS);
        copy.syncId = syncId;
        copy.set({ scaleX: copy.scaleX * k, scaleY: copy.scaleY * k });
        copy.setPositionByOrigin(
          new Point((ctr.x / sf.wPX) * tf.wPX, (ctr.y / sf.hPX) * tf.hPX),
          'center',
          'center',
        );
        this.canvas(fid).add(copy);
        this.canvas(fid).requestRenderAll();
      }
    } finally {
      this.suppress--;
    }
  }

  // ---------- content ----------

  /** Downscale to <=1200px and return a data URL so designs survive reloads. */
  private readImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1200 / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.width * k));
        c.height = Math.max(1, Math.round(im.height * k));
        c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/png'));
      };
      im.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('could not read image'));
      };
      im.src = url;
    });
  }

  async addImage(file: File, allFaces: boolean) {
    const dataUrl = await this.readImage(file);
    const linked = allFaces || this.editAll;
    const targets: FaceId[] = linked ? FACES.map((f) => f.id) : [this.active];
    const syncId = linked ? uid() : undefined;
    const af = FACE[this.active];
    this.suppress++;
    try {
      let activeImg: FabricImage | null = null;
      for (const fid of targets) {
        const img = await FabricImage.fromURL(dataUrl);
        const base = Math.min((af.wPX * 0.7) / img.width, (af.hPX * 0.85) / img.height);
        const f = FACE[fid];
        const scale = base * (fid === this.active ? 1 : this.faceScale(this.active, fid));
        img.set({ scaleX: scale, scaleY: scale, syncId });
        img.setPositionByOrigin(new Point(f.wPX / 2, f.hPX / 2), 'center', 'center');
        this.canvas(fid).add(img);
        this.canvas(fid).requestRenderAll();
        if (fid === this.active) activeImg = img;
      }
      if (activeImg && this.tool === 'select') {
        this.canvas().setActiveObject(activeImg);
        this.canvas().requestRenderAll();
      }
    } finally {
      this.suppress--;
    }
    this.snapshot();
  }

  setBackground(color: string) {
    const targets: FaceId[] = this.editAll ? FACES.map((f) => f.id) : [this.active];
    for (const fid of targets) {
      this.canvas(fid).backgroundColor = color;
      this.canvas(fid).requestRenderAll();
    }
    this.scheduleSnapshot();
    this.onUpdate?.();
  }

  deleteSelection() {
    const c = this.canvas();
    const objs = c.getActiveObjects();
    if (!objs.length) return;
    c.discardActiveObject();
    this.suppress++;
    try {
      for (const o of objs) {
        c.remove(o);
        if (this.editAll && o.syncId) {
          for (const fid of this.otherFaces(this.active)) {
            const twin = this.findBySyncId(fid, o.syncId);
            if (twin) {
              this.canvas(fid).remove(twin);
              this.canvas(fid).requestRenderAll();
            }
          }
        }
      }
    } finally {
      this.suppress--;
    }
    c.requestRenderAll();
    this.snapshot();
  }

  async cloneSelection() {
    const c = this.canvas();
    const objs = c.getActiveObjects();
    if (!objs.length) return;
    this.suppress++;
    const copies: FabricObject[] = [];
    try {
      c.discardActiveObject();
      for (const o of objs) {
        const copy = await o.clone(PROPS);
        copy.syncId = undefined; // clones are unlinked, like the design
        const ctr = o.getCenterPoint();
        copy.setPositionByOrigin(new Point(ctr.x + 24, ctr.y + 24), 'center', 'center');
        c.add(copy);
        copies.push(copy);
      }
      if (copies.length === 1) c.setActiveObject(copies[0]);
      else if (copies.length) c.setActiveObject(new ActiveSelection(copies, { canvas: c }));
      c.requestRenderAll();
    } finally {
      this.suppress--;
    }
    this.snapshot();
  }

  /** Apply/remove a centered square or circle crop on the selected image. */
  crop(shape: CropShape) {
    const o = this.selectedImage();
    if (!o) return;
    for (const t of this.withTwins(o)) {
      if (shape === 'none') {
        t.clipPath = undefined;
      } else {
        const m = Math.min(t.width, t.height);
        t.clipPath =
          shape === 'circle'
            ? new Circle({ radius: m / 2, originX: 'center', originY: 'center' })
            : new Rect({ width: m, height: m, originX: 'center', originY: 'center' });
      }
      t.dirty = true;
    }
    if (shape === 'none') this.cropAdjust = false;
    for (const c of this.canvases.values()) c.requestRenderAll();
    this.snapshot();
  }

  cropShape(): CropShape {
    const o = this.selectedImage();
    if (!o?.clipPath) return 'none';
    return o.clipPath.isType('circle') ? 'circle' : 'square';
  }

  /** After a crop-adjust drag ends: sync twins + record history. */
  finishCropAdjust() {
    if (!this.cropRef) return;
    this.cropRef = null;
    const o = this.selectedImage();
    if (o?.clipPath && this.editAll && o.syncId) {
      const cp = o.clipPath as FabricObject;
      for (const t of this.withTwins(o).slice(1)) {
        if (!t.clipPath) continue;
        const tp = t.clipPath as FabricObject;
        tp.set({ left: cp.left, top: cp.top });
        if (cp.isType('circle') && tp.isType('circle')) (tp as Circle).set({ radius: (cp as Circle).radius });
        else tp.set({ width: cp.width, height: cp.height });
        t.dirty = true;
      }
      for (const c of this.canvases.values()) c.requestRenderAll();
    }
    this.snapshot();
  }

  /** Copy the active face onto another face, mirrored (like folding the design over). */
  async mirrorTo(dstId: FaceId) {
    if (dstId === this.active) return;
    const src = FACE[this.active];
    const dst = FACE[dstId];
    const sc = this.canvas(src.id);
    const dc = this.canvas(dstId);
    const k = this.faceScale(src.id, dstId);
    this.suppress++;
    try {
      dc.discardActiveObject();
      dc.remove(...dc.getObjects());
      dc.backgroundColor = sc.backgroundColor;
      for (const o of sc.getObjects()) {
        const copy = await o.clone(PROPS);
        copy.syncId = undefined;
        const ctr = o.getCenterPoint();
        copy.flipX = !copy.flipX;
        copy.angle = -copy.angle;
        copy.set({ scaleX: copy.scaleX * k, scaleY: copy.scaleY * k });
        copy.setPositionByOrigin(
          new Point(dst.wPX - (ctr.x / src.wPX) * dst.wPX, (ctr.y / src.hPX) * dst.hPX),
          'center',
          'center',
        );
        dc.add(copy);
      }
      dc.requestRenderAll();
    } finally {
      this.suppress--;
    }
    this.snapshot();
    this.onToast?.(`${src.label} copied to ${dst.label} (mirrored)`);
  }

  /** Face artwork as a plain canvas for PDF export (multiplier scales resolution). */
  toCanvasElement(id: FaceId, multiplier: number): HTMLCanvasElement {
    return this.canvas(id).toCanvasElement(multiplier);
  }
}
