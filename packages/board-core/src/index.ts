export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number };
export type Size = { width: number; height: number };
export type Stroke = { id: string; points: number[]; color: string; width: number; kind: 'pen' | 'marker' };
export type TextObject = { id: string; kind: 'text' | 'note'; x: number; y: number; text: string; color: string };
export type ImageObject = { id: string; kind: 'image'; x: number; y: number; assetId: string; width: number; height: number };
export type ShapeObject = { id: string; kind: 'shape'; shape: 'rectangle' | 'ellipse'; x: number; y: number; width: number; height: number; color: string };
export type ConnectorObject = { id: string; kind: 'connector'; x: number; y: number; dx: number; dy: number; fromId: string | null; toId: string | null; arrow: boolean; color: string };
export type BoardObject = TextObject | ImageObject | ShapeObject | ConnectorObject;
export type ConnectorGeometry = Pick<ConnectorObject, 'x' | 'y' | 'dx' | 'dy' | 'fromId' | 'toId'>;
export function isTextObject(o: BoardObject): o is TextObject { return o.kind === 'text' || o.kind === 'note'; }
export function isResizable(o: BoardObject): o is ImageObject | ShapeObject { return o.kind === 'image' || o.kind === 'shape'; }
function validColor(color: unknown) { return typeof color === 'string' && /^#[a-fA-F0-9]{6}$/.test(color); }
function validConnectorGeometry(o: ConnectorGeometry) {
  return validPoint(o) && Number.isFinite(o.dx) && Number.isFinite(o.dy) && Math.abs(o.dx) <= LIMITS.coordinate * 2 && Math.abs(o.dy) <= LIMITS.coordinate * 2
    && validPoint({ x: o.x + o.dx, y: o.y + o.dy }) && Math.hypot(o.dx, o.dy) >= 1
    && (o.fromId === null || validId(o.fromId)) && (o.toId === null || validId(o.toId)) && (!o.fromId || o.fromId !== o.toId);
}
export const IMAGE_LIMITS = { bytes: 1024 * 1024, edge: 1280, assets: 20 };
export function validAssetId(id: unknown): id is string { return typeof id === 'string' && /^[a-f0-9]{64}$/.test(id); }
export function validImageSize(value: unknown): value is Size { const s = value as Size; return !!s && Number.isFinite(s.width) && Number.isFinite(s.height) && s.width >= 16 && s.height >= 16 && s.width <= 4000 && s.height <= 4000; }
export type ObjectPatch = { text: string } | { x: number; y: number } | { width: number; height: number } | ConnectorGeometry;
export type ObjectPreview = { memberId: string; object: BoardObject; updatedAt: number };
export const OBJECT_LIMITS = { count: 500, text: 500, mutations: 10_000 };
export function validId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(id); }
export function validObject(value: unknown): value is BoardObject {
  const shape = value as ShapeObject;
  if (shape?.kind === 'shape') return validId(shape.id) && validPoint(shape) && validImageSize(shape) && (shape.shape === 'rectangle' || shape.shape === 'ellipse') && validColor(shape.color);
  const connector = value as ConnectorObject;
  if (connector?.kind === 'connector') return validId(connector.id) && validConnectorGeometry(connector) && typeof connector.arrow === 'boolean' && validColor(connector.color) && connector.fromId !== connector.id && connector.toId !== connector.id;
  const image = value as ImageObject;
  if (image?.kind === 'image') return validId(image.id) && validPoint(image) && validAssetId(image.assetId) && validImageSize(image);
  const o = value as TextObject;
  return !!o && validId(o.id) && (o.kind === 'text' || o.kind === 'note') && validPoint(o)
    && typeof o.text === 'string' && o.text.length <= OBJECT_LIMITS.text && !/[\u0000-\u0008\u000b-\u001f]/.test(o.text)
    && typeof o.color === 'string' && /^#[a-fA-F0-9]{6}$/.test(o.color);
}
export function validObjectPatch(value: unknown): value is ObjectPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>, keys = Object.keys(p);
  return (keys.length === 1 && typeof p.text === 'string' && p.text.length <= OBJECT_LIMITS.text && !/[\u0000-\u0008\u000b-\u001f]/.test(p.text))
    || (keys.length === 2 && keys.includes('x') && keys.includes('y') && validPoint(p))
    || (keys.length === 6 && ['x', 'y', 'dx', 'dy', 'fromId', 'toId'].every(k => keys.includes(k)) && validConnectorGeometry(p as ConnectorGeometry))
    || (keys.length === 2 && keys.includes('width') && keys.includes('height') && validImageSize(p));
}
// Fixed-width typography keeps wrapping and overview bounds deterministic on every client.
export function objectLayout(object: BoardObject) {
  if (object.kind === 'connector') return { width: Math.abs(object.dx), height: Math.abs(object.dy), lines: [] as string[] };
  if (isResizable(object)) return { width: object.width, height: object.height, lines: [] as string[] };
  const lines: string[] = []; let line = '', width = 0;
  for (const char of object.text) {
    if (char === '\n') { lines.push(line); line = ''; width = 0; continue; }
    const advance = char.charCodeAt(0) <= 127 ? 15 : 26;
    if (width + advance > 272) { lines.push(line); line = ''; width = 0; }
    line += char; width += advance;
  }
  lines.push(line);
  return { width: 320, height: Math.max(object.kind === 'note' ? 200 : 82, lines.length * 34 + 48), lines };
}
export function contentBounds(strokes: Stroke[], objects: BoardObject[]) {
  let bounds = strokeBounds(strokes);
  for (const object of objects) {
    const b = objectBounds(resolveObject(object, objects));
    bounds = bounds ? { left: Math.min(bounds.left, b.left), top: Math.min(bounds.top, b.top), right: Math.max(bounds.right, b.right), bottom: Math.max(bounds.bottom, b.bottom) } : b;
  }
  return bounds;
}
export function contentFrame(strokes: Stroke[], objects: BoardObject[]): Stroke[] {
  const b = contentBounds(strokes, objects);
  return b ? [{ id: 'content-frame', kind: 'pen', width: 1, color: '#000000', points: [b.left, b.top, b.right, b.bottom] }] : [];
}
export type Member = { id: string; name: string; color: string; role: 'editor' | 'viewer'; cursor: Point | null; host?: boolean };
export type Preview = { memberId: string; stroke: Stroke; updatedAt: number };
export type Credentials = { roomId: string; token: string; role: 'editor' | 'viewer'; viewerToken?: string };
export const COLORS = ['#315EFB', '#8738DB', '#FA8908'] as const;
export const LIMITS = { pointsPerStroke: 4000, pointsPerRoom: 100_000, strokes: 2000, coordinate: 100_000, previewTtl: 5000 };

export function screenToWorld(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}
export function worldToScreen(point: Point, camera: Camera): Point {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}
export function zoomAt(camera: Camera, anchor: Point, factor: number): Camera {
  const world = screenToWorld(anchor, camera);
  const zoom = Math.max(0.05, Math.min(8, camera.zoom * factor));
  return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom };
}
export function strokeBounds(strokes: Stroke[]) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.points.length; i += 2) {
      const x = stroke.points[i], y = stroke.points[i + 1], pad = stroke.width / 2;
      left = Math.min(left, x - pad); right = Math.max(right, x + pad);
      top = Math.min(top, y - pad); bottom = Math.max(bottom, y + pad);
    }
  }
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}
export function fitCamera(strokes: Stroke[], size: Size, margin = 100): Camera {
  const bounds = strokeBounds(strokes) ?? { left: 0, top: 0, right: 1280, bottom: 720 };
  const width = Math.max(1, bounds.right - bounds.left), height = Math.max(1, bounds.bottom - bounds.top);
  const safe = Math.min(margin, Math.min(size.width, size.height) * 0.2);
  const zoom = Math.min(1.5, Math.max(1, size.width - safe * 2) / width, Math.max(1, size.height - safe * 2) / height);
  return { zoom, x: size.width / 2 - (bounds.left + width / 2) * zoom, y: size.height / 2 - (bounds.top + height / 2) * zoom };
}
export function validPoint(value: unknown): value is Point {
  const p = value as Point;
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= LIMITS.coordinate && Math.abs(p.y) <= LIMITS.coordinate;
}
export function validStroke(value: unknown): value is Stroke {
  const s = value as Stroke;
  return !!s && typeof s.id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(s.id)
    && /^#[a-fA-F0-9]{6}$/.test(s.color) && Number.isFinite(s.width) && s.width >= 1 && s.width <= 40
    && (s.kind === 'pen' || s.kind === 'marker') && Array.isArray(s.points)
    && s.points.length >= 2 && s.points.length <= LIMITS.pointsPerStroke * 2 && s.points.length % 2 === 0
    && s.points.every(n => Number.isFinite(n) && Math.abs(n) <= LIMITS.coordinate);
}
export type AccessState = { inviteToken: string; expiresAt: number; paused: boolean; ended: boolean; claimToken?: string };
export type ObjectMutation =
  | { type: 'create-object'; object: BoardObject; mutationId: string }
  | { type: 'update-object'; objectId: string; patch: ObjectPatch; mutationId: string }
  | { type: 'delete-object'; objectId: string; mutationId: string };
export type ClientMessage =
  | ObjectMutation
  | { type: 'object-preview'; object: BoardObject | null; seq: number }
  | { type: 'manage'; action: 'pause' | 'resume' | 'rotate' | 'remove' | 'end'; memberId?: string }
  | { type: 'hello'; protocolVersion: 1; roomId: string; token: string; name: string; viewOnly?: boolean; legacyTV?: boolean }
  | { type: 'presence'; cursor: Point | null }
  | { type: 'preview'; stroke: Stroke | null; seq: number }
  | { type: 'commit'; stroke: Stroke; mutationId: string }
  | { type: 'delete'; strokeId: string; mutationId: string };
export type BoardSnapshot = { strokes: Stroke[]; objects: BoardObject[]; deletedObjectIds?: string[]; deletedStrokeIds?: string[] };
export type ServerMessage =
  | ({ type: 'snapshot' } & BoardSnapshot)
  | { type: 'object-preview'; memberId: string; object: BoardObject | null }
  | { type: 'access'; access: AccessState }
  | { type: 'ready'; snapshot?: BoardSnapshot; token?: string; host?: boolean; access?: AccessState; memberId: string; role: Member['role']; viewerToken: string; update: string; members: Member[] }
  | { type: 'members'; members: Member[] }
  | { type: 'presence'; member: Member }
  | { type: 'preview'; memberId: string; stroke: Stroke | null }
  | { type: 'update'; update: string }
  | { type: 'saved'; mutationId: string }
  | { type: 'error'; message: string; mutationId?: string };

// A stable, tiled canvas extent is distinct from fitting just the document's marks.
export const DEFAULT_CANVAS = { left: 0, top: 0, right: 1280, bottom: 720 };
export function canvasBounds(content: ReturnType<typeof contentBounds>) {
  if (!content) return { ...DEFAULT_CANVAS };
  return {
    left: Math.min(0, Math.floor(content.left / 1280) * 1280),
    top: Math.min(0, Math.floor(content.top / 720) * 720),
    right: Math.max(1280, Math.ceil(content.right / 1280) * 1280),
    bottom: Math.max(720, Math.ceil(content.bottom / 720) * 720),
  };
}


// Resolve endpoints from current target geometry, so previews and persisted moves use one rule.
export function resolveObject(object: BoardObject, objects: BoardObject[]): BoardObject {
  if (object.kind !== 'connector') return object;
  const from = objects.find(o => o.id === object.fromId && o.kind !== 'connector');
  const to = objects.find(o => o.id === object.toId && o.kind !== 'connector');
  const center = (o: BoardObject) => { const size = objectLayout(o); return { x: o.x + size.width / 2, y: o.y + size.height / 2 }; };
  const a = from ? center(from) : { x: object.x, y: object.y };
  const b = to ? center(to) : { x: object.x + object.dx, y: object.y + object.dy };
  const edge = (o: BoardObject, towards: Point) => {
    const c = center(o), size = objectLayout(o), dx = towards.x - c.x, dy = towards.y - c.y;
    const factor = o.kind === 'shape' && o.shape === 'ellipse'
      ? 1 / (Math.sqrt((dx / (size.width / 2)) ** 2 + (dy / (size.height / 2)) ** 2) || 1)
      : 1 / (Math.max(Math.abs(dx) / (size.width / 2), Math.abs(dy) / (size.height / 2)) || 1);
    return { x: c.x + dx * factor, y: c.y + dy * factor };
  };
  const start = from ? edge(from, b) : a, end = to ? edge(to, a) : b;
  return { ...object, x: start.x, y: start.y, dx: end.x - start.x, dy: end.y - start.y };
}
export function objectBounds(o: BoardObject) {
  if (o.kind === 'connector') return { left: Math.min(o.x, o.x + o.dx) - 12, top: Math.min(o.y, o.y + o.dy) - 12, right: Math.max(o.x, o.x + o.dx) + 12, bottom: Math.max(o.y, o.y + o.dy) + 12 };
  const size = objectLayout(o), pad = o.kind === 'shape' ? 2 : 0;
  return { left: o.x - pad, top: o.y - pad, right: o.x + size.width + pad, bottom: o.y + size.height + pad };
}
export function hitObject(o: BoardObject, point: Point, tolerance = 8): boolean {
  if (o.kind === 'connector') {
    const t = Math.max(0, Math.min(1, ((point.x - o.x) * o.dx + (point.y - o.y) * o.dy) / (o.dx ** 2 + o.dy ** 2 || 1)));
    return Math.hypot(point.x - o.x - t * o.dx, point.y - o.y - t * o.dy) <= tolerance;
  }
  const size = objectLayout(o);
  if (o.kind === 'shape' && o.shape === 'ellipse') return ((point.x - o.x - size.width / 2) / (size.width / 2 + tolerance)) ** 2 + ((point.y - o.y - size.height / 2) / (size.height / 2 + tolerance)) ** 2 <= 1;
  return point.x >= o.x - tolerance && point.x <= o.x + size.width + tolerance && point.y >= o.y - tolerance && point.y <= o.y + size.height + tolerance;
}
export function patchObject(current: BoardObject, patch: ObjectPatch): BoardObject | null {
  if ('dx' in patch ? current.kind !== 'connector' : 'text' in patch ? !isTextObject(current) : 'width' in patch ? !isResizable(current) : current.kind === 'connector') return null;
  const updated = { ...current, ...patch };
  return validObject(updated) ? updated : null;
}
// Referenced objects must belong to this document and cannot themselves be connectors.
export function normalizeConnector(o: ConnectorObject, objects: BoardObject[]): ConnectorObject {
  const target = (id: string | null) => objects.some(target => target.id === id && target.kind !== 'connector') ? id : null;
  return { ...o, fromId: target(o.fromId), toId: target(o.toId) };
}
