export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number };
export type Size = { width: number; height: number };
export type Stroke = { id: string; points: number[]; color: string; width: number; kind: 'pen' | 'marker' };
export type Member = { id: string; name: string; color: string; role: 'editor' | 'viewer'; cursor: Point | null };
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
export type ClientMessage =
  | { type: 'hello'; protocolVersion: 1; roomId: string; token: string; name: string }
  | { type: 'presence'; cursor: Point | null }
  | { type: 'preview'; stroke: Stroke | null; seq: number }
  | { type: 'commit'; stroke: Stroke; mutationId: string }
  | { type: 'delete'; strokeId: string; mutationId: string };
export type ServerMessage =
  | { type: 'ready'; memberId: string; role: Member['role']; viewerToken: string; update: string; members: Member[] }
  | { type: 'members'; members: Member[] }
  | { type: 'presence'; member: Member }
  | { type: 'preview'; memberId: string; stroke: Stroke | null }
  | { type: 'update'; update: string }
  | { type: 'saved'; mutationId: string }
  | { type: 'error'; message: string; mutationId?: string };
