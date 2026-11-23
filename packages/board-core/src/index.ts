export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number };
export type Size = { width: number; height: number };
export type Stroke = { id: string; points: number[]; color: string; width: number; kind: 'pen' | 'marker' };
export type BoardObject = { id: string; kind: 'text' | 'note'; x: number; y: number; text: string; color: string };
export type ObjectPatch = { text: string } | { x: number; y: number };
export type ObjectPreview = { memberId: string; object: BoardObject; updatedAt: number };
export const OBJECT_LIMITS = { count: 500, text: 500, mutations: 10_000 };
export function validId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(id); }
export function validObject(value: unknown): value is BoardObject {
  const o = value as BoardObject;
  return !!o && validId(o.id) && (o.kind === 'text' || o.kind === 'note') && validPoint(o)
    && typeof o.text === 'string' && o.text.length <= OBJECT_LIMITS.text && !/[\u0000-\u0008\u000b-\u001f]/.test(o.text)
    && typeof o.color === 'string' && /^#[a-fA-F0-9]{6}$/.test(o.color);
}
export function validObjectPatch(value: unknown): value is ObjectPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>, keys = Object.keys(p);
  return (keys.length === 1 && typeof p.text === 'string' && p.text.length <= OBJECT_LIMITS.text && !/[\u0000-\u0008\u000b-\u001f]/.test(p.text))
    || (keys.length === 2 && keys.includes('x') && keys.includes('y') && validPoint(p));
}
// Fixed-width typography keeps wrapping and overview bounds deterministic on every client.
export function objectLayout(object: BoardObject) {
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
    const size = objectLayout(object), b = { left: object.x, top: object.y, right: object.x + size.width, bottom: object.y + size.height };
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
