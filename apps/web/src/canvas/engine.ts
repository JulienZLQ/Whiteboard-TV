import Konva from 'konva';
import { fitCamera, contentBounds, contentFrame, objectLayout, zoomAt, screenToWorld, COLORS, LIMITS, type Camera, type Point, type Stroke, type BoardObject } from '@whiteboard/board-core';
import { BoardSession, newId } from '../session';

export type Tool = 'hand' | 'pen' | 'marker' | 'eraser' | 'select' | 'text' | 'note';
export class BoardEngine {
  private stage: Konva.Stage;
  private layer: Konva.Layer;
  private documentGroup = new Konva.Group();
  private objectGroup = new Konva.Group();
  private objectNodes = new Map<string, Konva.Group>();
  private objectRefs = new Map<string, BoardObject>();
  private selected = '';
  private placing: BoardObject | null = null;
  private dragging: { origin: BoardObject; start: Point; current: BoardObject } | null = null;
  private overlay = new Konva.Group();
  private strokes = new Map<string, Konva.Line>();
  private strokeRefs = new Map<string, Stroke>();
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private resize: ResizeObserver;
  private unsubscribe: () => void;
  private events = new AbortController();
  private frame = 0;
  private pointers = new Map<number, Point>();
  private drawing: Stroke | null = null;
  private previous: Point | null = null;
  private pinchDistance = 0;
  private pinchCenter: Point | null = null;
  private gesture = false;
  private moved = false;
  private overview = { left: 0, top: 0, right: 1280, bottom: 720 };
  private focusedMember = '';
  private lastFrame = 0;
  tool: Tool = 'pen';
  color: string = COLORS[0];
  constructor(private element: HTMLDivElement, private session: BoardSession, private viewer: boolean, private onCamera: (camera: Camera) => void, private onSelection: (id: string) => void, private onEdit: (object: BoardObject) => void) {
    Konva.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.stage = new Konva.Stage({ container: element, width: element.clientWidth, height: element.clientHeight });
    this.layer = new Konva.Layer({ listening: false }); this.stage.add(this.layer);
    this.layer.add(this.objectGroup, this.documentGroup, this.overlay);
    this.camera = fitCamera([], this.stage.size());
    this.resize = new ResizeObserver(() => { this.stage.size({ width: element.clientWidth, height: element.clientHeight }); this.schedule(); });
    this.resize.observe(element);
    this.unsubscribe = session.subscribeCanvas(this.schedule);
    const signal = this.events.signal;
    element.addEventListener('pointerdown', this.down, { signal });
    element.addEventListener('pointermove', this.move, { signal });
    element.addEventListener('pointerup', this.up, { signal });
    element.addEventListener('pointercancel', this.cancel, { signal });
    element.addEventListener('lostpointercapture', this.cancel, { signal });
    element.addEventListener('pointerleave', () => { if (!this.pointers.size) session.presence(null); }, { signal });
    element.addEventListener('dblclick', this.doubleClick, { signal });
    element.addEventListener('wheel', this.wheel, { signal, passive: false });
    this.schedule();
  }
  private viewSize() { return { width: this.stage.width() - (this.viewer && this.stage.width() >= 900 ? 270 : 0), height: this.stage.height() }; }
  private local(event: PointerEvent): Point { const r = this.element.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.viewer || this.session.getSnapshot().connection === 'denied') return;
    event.preventDefault();
    this.element.setPointerCapture(event.pointerId);
    const point = this.local(event); this.pointers.set(event.pointerId, point);
    if (this.pointers.size > 1) { this.drawing = null; this.placing = null; this.dragging = null; this.session.previewObject(null); this.session.preview(null); this.gesture = true; this.pinchDistance = 0; this.schedule(); return; }
    this.previous = point;
    this.moved = true;
    if (this.gesture) return;
    const world = screenToWorld(point, this.camera);
    if (this.tool === 'pen' || this.tool === 'marker') this.drawing = { id: newId(), points: [world.x, world.y], color: this.color, width: this.tool === 'marker' ? 22 : 4, kind: this.tool };
    if (this.tool === 'eraser') this.eraseAt(world);
    if (this.tool === 'select') {
      const object = this.hitObject(world); this.select(object?.id ?? '');
      if (object) this.dragging = { origin: object, current: object, start: world };
    }
    if (this.tool === 'text' || this.tool === 'note') this.placing = { id: newId(), kind: this.tool, x: world.x, y: world.y, text: '', color: this.color };
    this.session.presence(world); this.schedule();
  };
  private move = (event: PointerEvent) => {
    if (this.viewer) return;
    const point = this.local(event), world = screenToWorld(point, this.camera);
    if (!this.pointers.has(event.pointerId)) { if (event.pointerType === 'mouse' || event.pointerType === 'pen') this.session.presence(world); return; }
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDistance && this.pinchCenter) {
        this.camera = zoomAt(this.camera, this.pinchCenter, distance / this.pinchDistance);
        this.camera.x += center.x - this.pinchCenter.x; this.camera.y += center.y - this.pinchCenter.y;
        this.moved = true;
      }
      this.pinchDistance = distance; this.pinchCenter = center; this.schedule(); return;
    }
    if (this.gesture) return;
    if (this.drawing) {
      if (Math.abs(world.x) > LIMITS.coordinate || Math.abs(world.y) > LIMITS.coordinate) return;
      const points = this.drawing.points;
      if (Math.hypot(world.x - points.at(-2)!, world.y - points.at(-1)!) * this.camera.zoom < 1) return;
      if (points.length >= LIMITS.pointsPerStroke * 2) {
        this.session.commit(this.drawing);
        this.drawing = { ...this.drawing, id: newId(), points: points.slice(-2) };
      }
      this.drawing.points.push(world.x, world.y); this.session.preview(this.drawing);
    } else if (this.dragging) {
      const { origin, start } = this.dragging;
      if (Math.hypot(world.x - start.x, world.y - start.y) * this.camera.zoom >= 3) {
        const x = Math.max(-LIMITS.coordinate, Math.min(LIMITS.coordinate, origin.x + world.x - start.x));
        const y = Math.max(-LIMITS.coordinate, Math.min(LIMITS.coordinate, origin.y + world.y - start.y));
        const latest = this.session.getObjects().find(o => o.id === origin.id);
        if (latest) { this.dragging.current = { ...latest, x, y }; this.session.previewObject(this.dragging.current); }
      }
    } else if (this.tool === 'hand' && this.previous) {
      this.camera.x += point.x - this.previous.x; this.camera.y += point.y - this.previous.y; this.moved = true;
    } else if (this.tool === 'eraser') this.eraseAt(world);
    this.previous = point; this.session.presence(world); this.schedule();
  };
  private up = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    if (this.drawing && !this.gesture) this.session.commit(this.drawing);
    if (!this.gesture && this.dragging) {
      const { origin, current } = this.dragging;
      if (current.x !== origin.x || current.y !== origin.y) this.session.updateObject(origin.id, { x: current.x, y: current.y });
    }
    const placing = !this.gesture ? this.placing : null;
    this.placing = null; this.dragging = null; this.session.previewObject(null);
    if (placing) this.onEdit(placing);
    this.drawing = null; this.session.preview(null); this.pointers.delete(event.pointerId);
    if (!this.pointers.size) { this.gesture = false; this.previous = null; }
    this.pinchDistance = 0; this.pinchCenter = null;
    if (event.pointerType !== 'mouse') this.session.presence(null);
    this.schedule();
  };
  private cancel = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    this.drawing = null; this.placing = null; this.dragging = null; this.session.previewObject(null); this.session.preview(null); this.pointers.delete(event.pointerId);
    if (!this.pointers.size) this.gesture = false;
    this.pinchDistance = 0; this.pinchCenter = null; this.session.presence(null); this.schedule();
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault(); if (this.viewer) return;
    const r = this.element.getBoundingClientRect();
    this.camera = zoomAt(this.camera, { x: event.clientX - r.left, y: event.clientY - r.top }, Math.exp(-event.deltaY * 0.001));
    this.moved = true; this.schedule();
  };
  private hitObject(point: Point) {
    return this.session.getObjects().reverse().find(o => { const size = objectLayout(o); return point.x >= o.x && point.x <= o.x + size.width && point.y >= o.y && point.y <= o.y + size.height; });
  }
  private doubleClick = (event: MouseEvent) => {
    if (this.viewer || this.tool !== 'select' || this.session.getSnapshot().connection === 'denied') return;
    const rect = this.element.getBoundingClientRect();
    const object = this.hitObject(screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, this.camera));
    if (object) this.onEdit(object);
  };
  select(id: string) { if (id !== this.selected) { this.selected = id; this.onSelection(id); this.schedule(); } }
  private objectNode(object: BoardObject, draft = false) {
    const layout = objectLayout(object), node = new Konva.Group({ x: object.x, y: object.y, opacity: draft ? .82 : 1 });
    if (object.kind === 'note') {
      node.add(new Konva.Rect({ width: layout.width, height: layout.height, fill: '#FFF1AD', cornerRadius: 6, shadowColor: '#493d13', shadowOpacity: .12, shadowBlur: 10, shadowOffsetY: 4 }));
      node.add(new Konva.Rect({ width: layout.width, height: 6, fill: '#E9CF6D', cornerRadius: [6, 6, 0, 0] }));
    }
    node.add(new Konva.Text({ x: 24, y: 24, width: 272, text: layout.lines.join('\n'), fontSize: 24, lineHeight: 34 / 24, wrap: 'none', fontFamily: 'monospace', fill: object.kind === 'note' ? '#3B3525' : object.color }));
    return node;
  }
  private eraseAt(point: Point) {
    for (const stroke of this.session.getStrokes().reverse()) {
      const p = stroke.points, threshold = 10 / this.camera.zoom + stroke.width / 2;
      for (let i = 0; i < p.length; i += 2) {
        const a = { x: p[i], y: p[i + 1] }, b = { x: p[i + 2] ?? a.x, y: p[i + 3] ?? a.y };
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) < threshold) { this.session.erase(stroke.id); return; }
      }
    }
  }
  private line(stroke: Stroke) {
    const points = stroke.points.length === 2 ? [...stroke.points, stroke.points[0] + 0.01, stroke.points[1] + 0.01] : stroke.points;
    return new Konva.Line({ points, stroke: stroke.color, strokeWidth: stroke.width, lineCap: 'round', lineJoin: 'round', opacity: stroke.kind === 'marker' ? 0.3 : 1 });
  }
  private schedule = () => { if (!this.frame) this.frame = requestAnimationFrame(this.render); };
  private render = () => {
    this.frame = 0;
    const strokes = this.session.getStrokes(), previews = this.session.getPreviews(), objects = this.session.getObjects();
    const objectPreviews = this.session.getObjectPreviews();
    if (this.selected && !objects.some(o => o.id === this.selected)) this.select('');
    const allObjects = [...objects, ...objectPreviews.map(p => p.object)];
    if (this.viewer) {
      const bounds = contentBounds([...strokes, ...previews.map(p => p.stroke)], allObjects);
      if (bounds) this.overview = { left: Math.min(this.overview.left, bounds.left), top: Math.min(this.overview.top, bounds.top), right: Math.max(this.overview.right, bounds.right), bottom: Math.max(this.overview.bottom, bounds.bottom) };
      const b = this.overview;
      const target = fitCamera([{ id: 'overview', points: [b.left, b.top, b.right, b.bottom], width: 1, color: '#000000', kind: 'pen' }], this.viewSize());
      const cursor = this.session.members.get(this.focusedMember)?.cursor;
      if (cursor) { target.zoom = 1; target.x = this.viewSize().width / 2 - cursor.x; target.y = this.stage.height() / 2 - cursor.y; }
      const now = performance.now(), alpha = 1 - Math.exp(-Math.min(32, now - this.lastFrame) / 65); this.lastFrame = now;
      const moving = Math.abs(target.x - this.camera.x) > .1 || Math.abs(target.y - this.camera.y) > .1 || Math.abs(target.zoom - this.camera.zoom) > .0001;
      this.element.dataset.cameraMoving = String(moving);
      if (moving && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) { this.camera = { x: this.camera.x + (target.x - this.camera.x) * alpha, y: this.camera.y + (target.y - this.camera.y) * alpha, zoom: this.camera.zoom + (target.zoom - this.camera.zoom) * alpha }; this.schedule(); }
      else this.camera = target;
    } else if (!this.moved && (strokes.length || objects.length)) {
      this.camera = fitCamera(contentFrame([...strokes, ...previews.map(p => p.stroke)], allObjects), this.stage.size(), 100);
      if (!this.viewer) this.moved = true;
    }
    this.documentGroup.position(this.camera); this.documentGroup.scale({ x: this.camera.zoom, y: this.camera.zoom });
    const ids = new Set(strokes.map(s => s.id));
    for (const [id, line] of this.strokes) if (!ids.has(id)) { line.destroy(); this.strokes.delete(id); this.strokeRefs.delete(id); }
    for (const stroke of strokes) {
      if (this.strokeRefs.get(stroke.id) === stroke) continue;
      this.strokes.get(stroke.id)?.destroy();
      const line = this.line(stroke); this.documentGroup.add(line); this.strokes.set(stroke.id, line); this.strokeRefs.set(stroke.id, stroke);
    }
    this.objectGroup.position(this.camera); this.objectGroup.scale({ x: this.camera.zoom, y: this.camera.zoom });
    const objectIds = new Set(objects.map(o => o.id));
    for (const [id, node] of this.objectNodes) if (!objectIds.has(id)) { node.destroy(); this.objectNodes.delete(id); this.objectRefs.delete(id); }
    const previewIds = new Set(objectPreviews.map(p => p.object.id));
    if (this.dragging) previewIds.add(this.dragging.origin.id);
    objects.forEach((object, index) => {
      if (this.objectRefs.get(object.id) !== object) {
        this.objectNodes.get(object.id)?.destroy();
        const node = this.objectNode(object); this.objectGroup.add(node); this.objectNodes.set(object.id, node); this.objectRefs.set(object.id, object);
      }
      const node = this.objectNodes.get(object.id)!; node.zIndex(index); node.visible(!previewIds.has(object.id));
    });
    this.overlay.destroyChildren();
    const previewGroup = new Konva.Group({ x: this.camera.x, y: this.camera.y, scaleX: this.camera.zoom, scaleY: this.camera.zoom });
    this.overlay.add(previewGroup);
    for (const preview of previews) previewGroup.add(this.line(preview.stroke));
    if (this.drawing) previewGroup.add(this.line(this.drawing));
    for (const preview of objectPreviews) previewGroup.add(this.objectNode(preview.object, true));
    if (this.dragging && objectIds.has(this.dragging.origin.id)) previewGroup.add(this.objectNode(this.dragging.current));
    const selected = this.dragging?.current ?? objects.find(o => o.id === this.selected);
    if (selected && objectIds.has(selected.id)) {
      const size = objectLayout(selected);
      previewGroup.add(new Konva.Rect({ x: selected.x, y: selected.y, width: size.width, height: size.height, stroke: '#315EFB', strokeWidth: 2 / this.camera.zoom, dash: [6 / this.camera.zoom, 4 / this.camera.zoom], cornerRadius: 6 }));
    }
    for (const member of this.session.members.values()) {
      if (member.id === this.session.getSnapshot().memberId || !member.cursor) continue;
      const x = member.cursor.x * this.camera.zoom + this.camera.x, y = member.cursor.y * this.camera.zoom + this.camera.y;
      const cursor = new Konva.Group({ x, y });
      cursor.add(new Konva.Line({ points: [0, 0, 9, 24, 13, 14, 24, 10], closed: true, fill: member.color, stroke: '#fff', strokeWidth: 2 }));
      const label = new Konva.Label({ x: 18, y: 26 });
      label.add(new Konva.Tag({ fill: member.color, cornerRadius: 8 }));
      label.add(new Konva.Text({ text: member.name, padding: 8, fill: '#fff', fontSize: this.viewer ? 20 : 14, fontFamily: 'sans-serif' }));
      cursor.add(label); this.overlay.add(cursor);
    }
    this.element.dataset.objectCount = String(objects.length);
    this.element.dataset.objectPreviewCount = String(objectPreviews.length);
    this.element.dataset.selectedObject = this.selected;
    this.element.dataset.strokeCount = String(strokes.length);
    this.element.dataset.drawing = String(!!this.drawing);
    this.element.dataset.previewCount = String(previews.length);
    this.element.dataset.cursorCount = String([...this.session.members.values()].filter(m => m.cursor && m.id !== this.session.getSnapshot().memberId).length);
    this.element.dataset.camera = JSON.stringify(this.camera);
    this.element.style.backgroundPosition = `${this.camera.x}px ${this.camera.y}px`;
    this.onCamera({ ...this.camera }); this.layer.batchDraw();
  };
  zoom(factor: number) { if (!this.viewer) { this.camera = zoomAt(this.camera, { x: this.stage.width() / 2, y: this.stage.height() / 2 }, factor); this.moved = true; this.schedule(); } }
  focus(memberId: string) { this.focusedMember = memberId; this.schedule(); }
  fit() { this.focusedMember = ''; this.overview = contentBounds(this.session.getStrokes(), this.session.getObjects()) ?? { left: 0, top: 0, right: 1280, bottom: 720 }; this.camera = fitCamera(contentFrame(this.session.getStrokes(), this.session.getObjects()), this.viewSize()); this.moved = true; this.schedule(); }
  destroy() { cancelAnimationFrame(this.frame); this.resize.disconnect(); this.unsubscribe(); this.events.abort(); this.stage.destroy(); }
}
