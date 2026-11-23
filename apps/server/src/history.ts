import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { LIMITS, OBJECT_LIMITS, type BoardObject, type Stroke } from '@whiteboard/board-core';

type Value = BoardObject | Stroke;
type Change = { table: 'objects' | 'strokes'; id: string; fields: string[] | null; before: Value | null; after: Value | null; previous: Record<string, string>; next: Record<string, string> };
type Entry = { changes: Change[] };
type History = { undo: string[]; redo: string[] };
const groups = ['life', 'position', 'size', 'text', 'geometry'];
const owner = (token: string) => createHash('sha256').update(token).digest('hex');
const key = (change: Pick<Change, 'table' | 'id'>, group: string) => `${change.table}:${change.id}:${group}`;
const fieldGroup = (fields: string[]) => fields.includes('dx') ? 'geometry' : fields.includes('text') ? 'text' : fields.includes('width') ? 'size' : 'position';
function history(doc: Y.Doc, token: string): History { return doc.getMap<History>('history').get(owner(token)) ?? { undo: [], redo: [] }; }
export function historyState(doc: Y.Doc, token: string) { const h = history(doc, token); return { undo: h.undo.length, redo: h.redo.length }; }

// Capture only durable changes. Patches retain their field group; lifecycle changes guard all groups.
export function recordHistory(before: Y.Doc, after: Y.Doc, token: string, mutationId: string, patch?: { id: string; fields: string[] }) {
  const changes: Change[] = [], versions = after.getMap<string>('versions');
  for (const table of ['objects', 'strokes'] as const) {
    const old = before.getMap<Value>(table), next = after.getMap<Value>(table);
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(id) ?? null, b = next.get(id) ?? null;
      const force = table === 'objects' && patch?.id === id && a && b;
      if (JSON.stringify(a) === JSON.stringify(b) && !force) continue;
      const fields = a && b ? 'kind' in b && b.kind === 'connector' ? ['x', 'y', 'dx', 'dy', 'fromId', 'toId'] : force ? patch!.fields : Object.keys(b).filter(k => JSON.stringify((a as any)[k]) !== JSON.stringify((b as any)[k])) : null;
      const change: Change = { table, id, fields, before: a, after: b, previous: {}, next: {} };
      const guard = fields ? ['life', fieldGroup(fields)] : groups;
      for (const group of guard) {
        const k = key(change, group); change.previous[k] = versions.get(k) ?? '';
        change.next[k] = fields && group === 'life' ? change.previous[k] : mutationId;
        versions.set(k, change.next[k]);
      }
      if (!a && b) { const order = after.getMap<number>('renderOrder'), k = `${table}:${id}`; if (!order.has(k)) order.set(k, order.size + 1); }
      changes.push(change);
    }
  }
  if (!changes.length) return;
  const h = history(after, token);
  const entries = after.getMap<Entry>('historyEntries');
  entries.set(mutationId, { changes });
  for (const id of [...h.undo.slice(0, Math.max(0, h.undo.length - 49)), ...h.redo]) entries.delete(id);
  after.getMap<History>('history').set(owner(token), { undo: [...h.undo, mutationId].slice(-50), redo: [] });
}

// Conditional inverse, serialized with every edit. Versions detect later writes even if values match.
export function applyHistory(doc: Y.Doc, token: string, direction: 'undo' | 'redo'): string | undefined {
  const h = history(doc, token), source = [...h[direction]], entryId = source.pop();
  const entries = doc.getMap<Entry>('historyEntries'), entry = entryId ? entries.get(entryId) : undefined;
  if (!entry) return '没有可处理的操作';
  const versions = doc.getMap<string>('versions'), undo = direction === 'undo';
  let conflict = entry.changes.some(c => {
    const expected = undo ? c.next : c.previous;
    return Object.entries(expected).some(([k, v]) => (versions.get(k) ?? '') !== v);
  });
  // Validate the whole result before applying, including references created by another participant.
  const result = new Map(doc.getMap<BoardObject>('objects').entries());
  const strokes = new Map(doc.getMap<Stroke>('strokes').entries());
  for (const c of entry.changes) {
    const target = undo ? c.before : c.after, map = c.table === 'objects' ? result : strokes;
    if (!target) map.delete(c.id);
    else if (!c.fields) (map as Map<string, Value>).set(c.id, target);
    else {
      const current = map.get(c.id);
      if (!current) { conflict = true; continue; }
      const patch = Object.fromEntries(c.fields.map(f => [f, (target as any)[f]]));
      (map as Map<string, Value>).set(c.id, { ...current, ...patch });
    }
  }
  for (const o of result.values()) if (o.kind === 'connector') {
    for (const id of [o.fromId, o.toId]) if (id && (!result.has(id) || result.get(id)!.kind === 'connector')) conflict = true;
  }
  if (result.size > OBJECT_LIMITS.count || strokes.size > LIMITS.strokes || [...strokes.values()].reduce((n, s) => n + s.points.length / 2, 0) > LIMITS.pointsPerRoom) throw new Error('恢复内容超出白板容量上限');
  if (!conflict) {
    for (const c of entry.changes) {
      const target = undo ? c.before : c.after, map = doc.getMap<Value>(c.table);
      const deleted = doc.getMap<boolean>(c.table === 'objects' ? 'deletedObjects' : 'deleted');
      if (!target) { map.delete(c.id); deleted.set(c.id, true); }
      else { map.set(c.id, (c.table === 'objects' ? result : strokes).get(c.id)!); deleted.delete(c.id); }
      for (const [k, v] of Object.entries(undo ? c.previous : c.next)) versions.set(k, v);
    }
  }
  const opposite = undo ? 'redo' : 'undo';
  if (conflict) entries.delete(entryId!);
  else for (const id of h[opposite].slice(0, Math.max(0, h[opposite].length - 49))) entries.delete(id);
  doc.getMap<History>('history').set(owner(token), { ...h, [direction]: source, [opposite]: conflict ? h[opposite] : [...h[opposite], entryId!].slice(-50) });
  return conflict ? '这一步涉及的内容已被后续操作修改，已跳过，保留其他人的修改' : undefined;
}
