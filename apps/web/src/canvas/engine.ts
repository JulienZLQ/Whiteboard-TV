import Konva from 'konva';
import { fitCamera, hitObject, objectBounds, resolveObject, isTextObject, isResizable, validObject, canvasBounds, DEFAULT_CANVAS, contentBounds, contentFrame, objectLayout, zoomAt, screenToWorld, COLORS, LIMITS, type Camera, type Point, type Stroke, type BoardObject, type TextObject, type ImageObject, type ShapeObject, type ConnectorObject } from '@whiteboard/board-core';
import { ImageCache } from '../images';
import { BoardSession, newId } from '../session';

export type Tool = 'hand' | 'pen' | 'marker' | 'eraser' | 'select' | 'text' | 'note' | 'rectangle' | 'ellipse' | 'arrow' | 'line';
export class BoardEngine {
  private stage: Konva.Stage;
  private layer: Konva.Layer;
  private documentGroup = new Konva.Group();
  private objectGroup = new Konva.Group();
  private objectNodes = new Map<string, Konva.Group>();
  private objectRefs = new Map<string, BoardObject>();
  private selected = '';
  private images: ImageCache;
  private joinVisible = true;
  private resizing: { origin: ImageObject | ShapeObject; current: ImageObject | ShapeObject; start: Point } | null = null;
  private placing: TextObject | null = null;
  private creating: { start: Point; current: ShapeObject | ConnectorObject } | null = null;
  private endpoint: { current: ConnectorObject; end: 'start' | 'end' } | null = null;
  private renderObjects: BoardObject[] = [];
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
  private viewMode: 'canvas' | 'content' = 'canvas';
  private focusedMember = '';
  private focusedPoint: Point | null = null;
  private lastFrame = 0;
  tool: Tool = 'pen';
  color: string = COLORS[0];
  constructor(private element: HTMLDivElement, private session: BoardSession, private viewer: boolean, private onCamera: (camera: Camera) => void, private onSelection: (id: string) => void, private onEdit: (object: TextObject) => void, private onTool: (tool: Tool) => void) {
    this.images = new ImageCache(() => session.credentials, () => { this.objectRefs.clear(); this.schedule(); });
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
  private viewSize() { return { width: this.stage.width() - (this.viewer && this.joinVisible && this.stage.width() >= 900 ? 270 : 0), height: this.stage.height() - (this.viewer ? 60 : 0) }; }
  private local(event: PointerEvent): Point { const r = this.element.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.viewer || this.session.getSnapshot().connection === 'denied') return;
    event.preventDefault();
    this.element.setPointerCapture(event.pointerId);
    const point = this.local(event); this.pointers.set(event.pointerId, point);
    if (this.pointers.size > 1) { this.drawing = null; this.placing = null; this.dragging = null; this.resizing = null; this.creating = null; this.endpoint = null; this.session.previewObject(null); this.session.preview(null); this.gesture = true; this.pinchDistance = 0; this.schedule(); return; }
    this.previous = point;
    this.moved = true;
    if (this.gesture) return;
    const world = screenToWorld(point, this.camera);
    if (this.tool === 'pen' || this.tool === 'marker') this.drawing = { id: newId(), points: [world.x, world.y], color: this.color, width: this.tool === 'marker' ? 22 : 4, kind: this.tool };
    if (this.tool === 'eraser') this.eraseAt(world);
    if (this.tool === 'select') {
      const selected = this.session.getObjects().find(o => o.id === this.selected);
      const resolved = selected && resolveObject(selected, this.session.getObjects());
      if (resolved?.kind === 'connector' && (Math.hypot(world.x - resolved.x, world.y - resolved.y) * this.camera.zoom <= 20 || Math.hypot(world.x - resolved.x - resolved.dx, world.y - resolved.y - resolved.dy) * this.camera.zoom <= 20)) {
        this.endpoint = { current: resolved, end: Math.hypot(world.x - resolved.x, world.y - resolved.y) * this.camera.zoom <= 20 ? 'start' : 'end' };
      } else if (selected && isResizable(selected) && Math.abs(world.x - selected.x - selected.width) * this.camera.zoom <= 20 && Math.abs(world.y - selected.y - selected.height) * this.camera.zoom <= 20) {
        this.resizing = { origin: selected, current: selected, start: world };
      } else {
        const object = this.hitObject(world); this.select(object?.id ?? '');
        if (object) { const resolved = resolveObject(object, this.session.getObjects()); this.dragging = { origin: resolved, current: resolved, start: world }; }
      }
    }
    if (this.tool === 'rectangle' || this.tool === 'ellipse') this.creating = { start: world, current: { id: newId(), kind: 'shape', shape: this.tool, x: world.x, y: world.y, width: 200, height: 140, color: this.color } };
    if (this.tool === 'arrow' || this.tool === 'line') this.creating = { start: world, current: { id: newId(), kind: 'connector', x: world.x, y: world.y, dx: 160, dy: 0, fromId: this.targetAt(world)?.id ?? null, toId: null, arrow: this.tool === 'arrow', color: this.color } };
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
    } else if (this.creating) {
      const { start, current } = this.creating;
      if (current.kind === 'shape') {
        const width = Math.min(4000, Math.max(16, Math.abs(world.x - start.x))), height = Math.min(4000, Math.max(16, Math.abs(world.y - start.y)));
        this.creating.current = { ...current, x: world.x < start.x ? start.x - width : start.x, y: world.y < start.y ? start.y - height : start.y, width, height };
      } else {
        const target = this.targetAt(world);
        this.creating.current = { ...current, dx: world.x - start.x, dy: world.y - start.y, toId: target?.id !== current.fromId ? target?.id ?? null : null };
      }
      if (validObject(this.creating.current)) this.session.previewObject(this.creating.current);
    } else if (this.endpoint) {
      const { current, end } = this.endpoint, target = this.targetAt(world);
      this.endpoint.current = end === 'start'
        ? { ...current, x: world.x, y: world.y, dx: current.x + current.dx - world.x, dy: current.y + current.dy - world.y, fromId: target?.id !== current.toId ? target?.id ?? null : null }
        : { ...current, dx: world.x - current.x, dy: world.y - current.y, toId: target?.id !== current.fromId ? target?.id ?? null : null };
      if (validObject(this.endpoint.current)) this.session.previewObject(this.endpoint.current);
    } else if (this.resizing) {
      const { origin, start } = this.resizing;
      const factor = ((world.x - start.x) * origin.width + (world.y - start.y) * origin.height) / (origin.width ** 2 + origin.height ** 2) + 1;
      const size = origin.kind === 'image' ? this.imageScale(origin, factor) : { width: Math.max(16, Math.min(4000, origin.width + world.x - start.x)), height: Math.max(16, Math.min(4000, origin.height + world.y - start.y)) };
      const latest = this.session.getObjects().find(o => o.id === origin.id);
      if (latest && isResizable(latest)) { this.resizing.current = { ...latest, ...size }; this.session.previewObject(this.resizing.current); }
    } else if (this.dragging) {
      const { origin, start } = this.dragging;
      if (Math.hypot(world.x - start.x, world.y - start.y) * this.camera.zoom >= 3) {
        const x = Math.max(-LIMITS.coordinate, Math.min(LIMITS.coordinate, origin.x + world.x - start.x));
        const y = Math.max(-LIMITS.coordinate, Math.min(LIMITS.coordinate, origin.y + world.y - start.y));
        const latest = this.session.getObjects().find(o => o.id === origin.id);
        if (latest) { this.dragging.current = latest.kind === 'connector' && origin.kind === 'connector' ? { ...latest, x, y, dx: origin.dx, dy: origin.dy, fromId: null, toId: null } : { ...latest, x, y }; this.session.previewObject(this.dragging.current); }
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
      if (current.x !== origin.x || current.y !== origin.y) this.session.updateObject(origin.id, current.kind === 'connector' ? this.connectorPatch(current) : { x: current.x, y: current.y });
    }
    if (!this.gesture && this.resizing) {
      const { origin, current } = this.resizing;
      if (current.width !== origin.width || current.height !== origin.height) this.session.updateObject(origin.id, { width: current.width, height: current.height });
    }
    if (!this.gesture && this.endpoint && validObject(this.endpoint.current)) this.session.updateObject(this.endpoint.current.id, this.connectorPatch(this.endpoint.current));
    if (!this.gesture && this.creating && validObject(this.creating.current)) { const object = this.creating.current; this.session.createObject(object); this.select(object.id); this.onTool('select'); }
    this.creating = null; this.endpoint = null;
    const placing = !this.gesture ? this.placing : null;
    this.placing = null; this.dragging = null; this.resizing = null; this.session.previewObject(null);
    if (placing) this.onEdit(placing);
    this.drawing = null; this.session.preview(null); this.pointers.delete(event.pointerId);
    if (!this.pointers.size) { this.gesture = false; this.previous = null; }
    this.pinchDistance = 0; this.pinchCenter = null;
    if (event.pointerType !== 'mouse') this.session.presence(null);
    this.schedule();
  };
  private cancel = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    this.drawing = null; this.placing = null; this.dragging = null; this.resizing = null; this.creating = null; this.endpoint = null; this.session.previewObject(null); this.session.preview(null); this.pointers.delete(event.pointerId);
    if (!this.pointers.size) this.gesture = false;
    this.pinchDistance = 0; this.pinchCenter = null; this.session.presence(null); this.schedule();
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault(); if (this.viewer) return;
    const r = this.element.getBoundingClientRect();
    this.camera = zoomAt(this.camera, { x: event.clientX - r.left, y: event.clientY - r.top }, Math.exp(-event.deltaY * 0.001));
    this.moved = true; this.schedule();
  };
  private connectorPatch(o: ConnectorObject) { const { x, y, dx, dy, fromId, toId } = o; return { x, y, dx, dy, fromId, toId }; }
  private targetAt(point: Point) { return this.session.getObjects().reverse().find(o => o.kind !== 'connector' && hitObject(o, point, 14 / this.camera.zoom)); }
  private hitObject(point: Point) {
    const objects = this.session.getObjects();
    return [...objects].reverse().find(o => hitObject(resolveObject(o, objects), point, 8 / this.camera.zoom));
  }
  private doubleClick = (event: MouseEvent) => {
    if (this.viewer || this.tool !== 'select' || this.session.getSnapshot().connection === 'denied') return;
    const rect = this.element.getBoundingClientRect();
    const object = this.hitObject(screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, this.camera));
    if (object && isTextObject(object)) this.onEdit(object);
  };
  select(id: string) { if (id !== this.selected) { this.selected = id; this.onSelection(id); this.schedule(); } }
  private objectNode(object: BoardObject, draft = false) {
    object = resolveObject(object, this.renderObjects);
    const layout = objectLayout(object), node = new Konva.Group({ x: object.x, y: object.y, opacity: draft ? .82 : 1 });
    if (object.kind === 'shape') {
      const common = { stroke: object.color, strokeWidth: 3, fill: object.color + '12' };
      if (object.shape === 'ellipse') node.add(new Konva.Ellipse({ ...common, x: object.width / 2, y: object.height / 2, radiusX: object.width / 2, radiusY: object.height / 2 }));
      else node.add(new Konva.Rect({ ...common, width: object.width, height: object.height, cornerRadius: 12 }));
      return node;
    }
    if (object.kind === 'connector') {
      const attrs = { points: [0, 0, object.dx, object.dy], stroke: object.color, fill: object.color, strokeWidth: 3, lineCap: 'round' as const, lineJoin: 'round' as const };
      node.add(object.arrow ? new Konva.Arrow({ ...attrs, pointerLength: 14, pointerWidth: 12 }) : new Konva.Line(attrs));
      return node;
    }
    if (object.kind === 'image') {
      const image = this.images.get(object.assetId);
      node.add(new Konva.Rect({ width: layout.width, height: layout.height, fill: '#e9edf5', stroke: '#d0d8e7', strokeWidth: 1 }));
      if (image) node.add(new Konva.Image({ image, width: layout.width, height: layout.height }));
      else node.add(new Konva.Text({ x: 12, y: 12, text: '图片加载中…', fontSize: 16, fill: '#667085' }));
      return node;
    }
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
    const visible = new Map(objects.map(o => [o.id, o]));
    for (const p of objectPreviews) visible.set(p.object.id, p.object);
    for (const o of [this.dragging?.current, this.resizing?.current, this.endpoint?.current, this.creating?.current]) if (o) visible.set(o.id, o);
    const allObjects = [...visible.values()]; this.renderObjects = allObjects;
    if (this.viewer) {
      const bounds = contentBounds([...strokes, ...previews.map(p => p.stroke)], allObjects);
      const b = this.viewMode === 'canvas' ? canvasBounds(bounds) : bounds ?? DEFAULT_CANVAS;
      const target = fitCamera([{ id: 'overview', points: [b.left, b.top, b.right, b.bottom], width: 1, color: '#000000', kind: 'pen' }], this.viewSize());
      const member = this.session.members.get(this.focusedMember);
      if (member?.cursor) this.focusedPoint = member.cursor;
      if (!member) this.focusedPoint = null;
      const cursor = this.focusedPoint;
      if (cursor) { target.zoom = 1; target.x = this.viewSize().width / 2 - cursor.x; target.y = this.stage.height() / 2 - cursor.y; }
      const now = performance.now(), alpha = 1 - Math.exp(-Math.min(32, now - this.lastFrame) / 90); this.lastFrame = now;
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
    if (this.resizing) previewIds.add(this.resizing.origin.id);
    if (this.endpoint) previewIds.add(this.endpoint.current.id);
    objects.forEach((original, index) => {
      const object = resolveObject(original, allObjects);
      if (object.kind === 'connector' ? JSON.stringify(this.objectRefs.get(object.id)) !== JSON.stringify(object) : this.objectRefs.get(object.id) !== object) {
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
    if (this.resizing && objectIds.has(this.resizing.origin.id)) previewGroup.add(this.objectNode(this.resizing.current));
    if (this.creating) previewGroup.add(this.objectNode(this.creating.current, true));
    if (this.endpoint && objectIds.has(this.endpoint.current.id)) previewGroup.add(this.objectNode(this.endpoint.current));
    const selectedRaw = this.endpoint?.current ?? this.resizing?.current ?? this.dragging?.current ?? objects.find(o => o.id === this.selected);
    const selected = selectedRaw && resolveObject(selectedRaw, allObjects);
    if (selected && objectIds.has(selected.id) && selected.kind !== 'connector') {
      const size = objectLayout(selected);
      previewGroup.add(new Konva.Rect({ x: selected.x, y: selected.y, width: size.width, height: size.height, stroke: '#315EFB', strokeWidth: 2 / this.camera.zoom, dash: [6 / this.camera.zoom, 4 / this.camera.zoom], cornerRadius: 6 }));
    }
    if (selected && isResizable(selected) && objectIds.has(selected.id)) previewGroup.add(new Konva.Rect({ x: selected.x + selected.width - 8 / this.camera.zoom, y: selected.y + selected.height - 8 / this.camera.zoom, width: 16 / this.camera.zoom, height: 16 / this.camera.zoom, fill: '#315EFB', stroke: 'white', strokeWidth: 2 / this.camera.zoom, cornerRadius: 3 / this.camera.zoom }));
    if (selected?.kind === 'connector' && objectIds.has(selected.id)) for (const p of [{ x: selected.x, y: selected.y }, { x: selected.x + selected.dx, y: selected.y + selected.dy }]) previewGroup.add(new Konva.Circle({ ...p, radius: 8 / this.camera.zoom, fill: 'white', stroke: '#315EFB', strokeWidth: 2 / this.camera.zoom }));
    this.element.dataset.connectors = JSON.stringify(allObjects.filter(o => o.kind === 'connector').map(o => resolveObject(o, allObjects)));
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
    this.element.dataset.loadedImageCount = String(this.images.loaded);
    this.element.dataset.joinVisible = String(this.joinVisible);
    this.element.dataset.viewMode = this.focusedMember ? 'member' : this.viewMode;
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
  setJoinVisible(visible: boolean) { this.joinVisible = visible; this.schedule(); }
  private imageScale(image: ImageObject | ShapeObject, factor: number) { const value = Math.max(16 / Math.min(image.width, image.height), Math.min(4000 / Math.max(image.width, image.height), factor)); return { width: image.width * value, height: image.height * value }; }
  scaleSelected(factor: number) { const image = this.session.getObjects().find(o => o.id === this.selected); if (image && isResizable(image)) this.session.updateObject(image.id, this.imageScale(image, factor)); }
  placeImage(asset: { assetId: string; width: number; height: number }) {
    const ratio = asset.width / asset.height;
    if (ratio > 250 || ratio < 1 / 250) throw new Error('图片过于狭长，请先裁剪');
    const scale = Math.max(16 / Math.min(asset.width, asset.height), Math.min(1, 480 / Math.max(asset.width, asset.height)));
    const width = asset.width * scale, height = asset.height * scale;
    const center = screenToWorld({ x: this.stage.width() / 2, y: this.stage.height() * .42 }, this.camera);
    const object: ImageObject = { id: newId(), kind: 'image', assetId: asset.assetId, width, height, x: Math.max(-LIMITS.coordinate, Math.min(LIMITS.coordinate, center.x - width / 2)), y: Math.max(-LIMITS.coordinate, Math.min(LIMITS.coordinate, center.y - height / 2)) };
    this.moved = true; this.session.createObject(object); this.select(object.id);
  }
  zoom(factor: number) { if (!this.viewer) { this.camera = zoomAt(this.camera, { x: this.stage.width() / 2, y: this.stage.height() / 2 }, factor); this.moved = true; this.schedule(); } }
  focus(memberId: string) { this.focusedMember = memberId; this.focusedPoint = null; this.schedule(); }
  showCanvas() { this.viewMode = 'canvas'; this.focusedMember = ''; this.focusedPoint = null; this.schedule(); }
  fit() { this.viewMode = 'content'; this.focusedMember = ''; this.focusedPoint = null; if (!this.viewer) this.camera = fitCamera(contentFrame(this.session.getStrokes(), this.session.getObjects()), this.viewSize()); this.moved = true; this.schedule(); }
  destroy() { this.images.destroy(); cancelAnimationFrame(this.frame); this.resize.disconnect(); this.unsubscribe(); this.events.abort(); this.stage.destroy(); }
}
