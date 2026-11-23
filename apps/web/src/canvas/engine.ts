import Konva from 'konva';
import { fitCamera, zoomAt, screenToWorld, COLORS, LIMITS, type Camera, type Point, type Stroke } from '@whiteboard/board-core';
import { BoardSession, newId } from '../session';

export type Tool = 'hand' | 'pen' | 'marker' | 'eraser';
export class BoardEngine {
  private stage: Konva.Stage;
  private layer: Konva.Layer;
  private documentGroup = new Konva.Group();
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
  tool: Tool = 'pen';
  color: string = COLORS[0];
  constructor(private element: HTMLDivElement, private session: BoardSession, private viewer: boolean, private onCamera: (camera: Camera) => void) {
    Konva.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.stage = new Konva.Stage({ container: element, width: element.clientWidth, height: element.clientHeight });
    this.layer = new Konva.Layer({ listening: false }); this.stage.add(this.layer);
    this.layer.add(this.documentGroup, this.overlay);
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
    element.addEventListener('wheel', this.wheel, { signal, passive: false });
    this.schedule();
  }
  private local(event: PointerEvent): Point { const r = this.element.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.viewer || this.session.getSnapshot().connection === 'denied') return;
    event.preventDefault();
    this.element.setPointerCapture(event.pointerId);
    const point = this.local(event); this.pointers.set(event.pointerId, point);
    if (this.pointers.size > 1) { this.drawing = null; this.session.preview(null); this.gesture = true; this.pinchDistance = 0; this.schedule(); return; }
    this.previous = point;
    this.moved = true;
    if (this.gesture) return;
    const world = screenToWorld(point, this.camera);
    if (this.tool === 'pen' || this.tool === 'marker') this.drawing = { id: newId(), points: [world.x, world.y], color: this.color, width: this.tool === 'marker' ? 22 : 4, kind: this.tool };
    if (this.tool === 'eraser') this.eraseAt(world);
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
    } else if (this.tool === 'hand' && this.previous) {
      this.camera.x += point.x - this.previous.x; this.camera.y += point.y - this.previous.y; this.moved = true;
    } else if (this.tool === 'eraser') this.eraseAt(world);
    this.previous = point; this.session.presence(world); this.schedule();
  };
  private up = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    if (this.drawing && !this.gesture) this.session.commit(this.drawing);
    this.drawing = null; this.session.preview(null); this.pointers.delete(event.pointerId);
    if (!this.pointers.size) { this.gesture = false; this.previous = null; }
    this.pinchDistance = 0; this.pinchCenter = null;
    if (event.pointerType !== 'mouse') this.session.presence(null);
    this.schedule();
  };
  private cancel = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    this.drawing = null; this.session.preview(null); this.pointers.delete(event.pointerId);
    if (!this.pointers.size) this.gesture = false;
    this.pinchDistance = 0; this.pinchCenter = null; this.session.presence(null); this.schedule();
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault(); if (this.viewer) return;
    const r = this.element.getBoundingClientRect();
    this.camera = zoomAt(this.camera, { x: event.clientX - r.left, y: event.clientY - r.top }, Math.exp(-event.deltaY * 0.001));
    this.moved = true; this.schedule();
  };
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
    const strokes = this.session.getStrokes(), previews = this.session.getPreviews();
    if (this.viewer || (!this.moved && strokes.length)) {
      this.camera = fitCamera([...strokes, ...previews.map(p => p.stroke)], this.stage.size(), 100);
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
    this.overlay.destroyChildren();
    const previewGroup = new Konva.Group({ x: this.camera.x, y: this.camera.y, scaleX: this.camera.zoom, scaleY: this.camera.zoom });
    this.overlay.add(previewGroup);
    for (const preview of previews) previewGroup.add(this.line(preview.stroke));
    if (this.drawing) previewGroup.add(this.line(this.drawing));
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
    this.element.dataset.strokeCount = String(strokes.length);
    this.element.dataset.drawing = String(!!this.drawing);
    this.element.dataset.previewCount = String(previews.length);
    this.element.dataset.cursorCount = String([...this.session.members.values()].filter(m => m.cursor && m.id !== this.session.getSnapshot().memberId).length);
    this.element.dataset.camera = JSON.stringify(this.camera);
    this.element.style.backgroundPosition = `${this.camera.x}px ${this.camera.y}px`;
    this.onCamera({ ...this.camera }); this.layer.batchDraw();
  };
  zoom(factor: number) { if (!this.viewer) { this.camera = zoomAt(this.camera, { x: this.stage.width() / 2, y: this.stage.height() / 2 }, factor); this.moved = true; this.schedule(); } }
  fit() { this.camera = fitCamera(this.session.getStrokes(), this.stage.size()); this.moved = true; this.schedule(); }
  destroy() { cancelAnimationFrame(this.frame); this.resize.disconnect(); this.unsubscribe(); this.events.abort(); this.stage.destroy(); }
}
