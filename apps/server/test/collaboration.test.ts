import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import type { ClientMessage, Credentials, ServerMessage, Stroke } from '@whiteboard/board-core';
import { createWhiteboardServer } from '../src/server';

async function client(port: number, credentials: Credentials, name: string, legacyTV = false) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), doc = new Y.Doc();
  const inbox: ServerMessage[] = [];
  ws.on('message', raw => {
    const message: ServerMessage = JSON.parse(raw.toString()); inbox.push(message);
    if ((message.type === 'ready' || message.type === 'update') && message.update) Y.applyUpdate(doc, Buffer.from(message.update, 'base64'));
  });
  const wait = async <T extends ServerMessage['type']>(type: T, predicate?: (m: Extract<ServerMessage, { type: T }>) => boolean) => {
    const start = Date.now();
    while (Date.now() - start < 4000) {
      const index = inbox.findIndex(m => m.type === type && (!predicate || predicate(m as Extract<ServerMessage, { type: T }>)));
      if (index >= 0) return inbox.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for ' + type);
  };
  await new Promise<void>(resolve => ws.on('open', resolve));
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId: credentials.roomId, token: credentials.token, name, legacyTV }));
  const ready = await wait('ready');
  return { ready, ws, doc, wait, inbox, send: (message: ClientMessage) => ws.send(JSON.stringify(message)) };
}
const stroke: Stroke = { id: 'stroke-0001', points: [10, 20, 30, 40], color: '#315EFB', width: 4, kind: 'pen' };

test('real sockets: live previews, read-only TV, concurrent commits, deletion and restart recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-test-'));
  let app = createWhiteboardServer({ dataDir: directory });
  let clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    let port = await app.listen(0);
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    const a = await client(port, room, 'A'), b = await client(port, room, 'B');
    const tv = await client(port, { ...room, token: room.viewerToken!, role: 'viewer' }, 'TV'); clients.push(a, b, tv);
    a.send({ type: 'preview', stroke, seq: 1 });
    assert.equal((await tv.wait('preview', m => !!m.stroke)).stroke?.id, stroke.id);
    assert.equal(tv.doc.getMap('strokes').size, 0, 'preview must arrive before durable commit');
    tv.send({ type: 'commit', stroke, mutationId: 'viewer-forbidden' });
    assert.match((await tv.wait('error')).message, /仅可观看/);
    a.send({ type: 'commit', stroke, mutationId: 'mutation-0001' });
    b.send({ type: 'commit', stroke: { ...stroke, id: 'stroke-0002', color: '#FA8908' }, mutationId: 'mutation-0002' });
    await Promise.all([a.wait('saved'), b.wait('saved')]);
    await tv.wait('update');
    assert.equal(a.doc.getMap('strokes').size, 2);
    assert.equal(b.doc.getMap('strokes').size, 2);
    a.send({ type: 'delete', strokeId: stroke.id, mutationId: 'mutation-delete' }); await a.wait('saved');
    b.send({ type: 'commit', stroke, mutationId: 'late-replayed-commit' }); await b.wait('saved');
    assert.equal(b.doc.getMap('strokes').has(stroke.id), false, 'late replay must not resurrect a deleted stroke');
    a.send({ type: 'commit', stroke: { ...stroke, points: [Infinity, 2] }, mutationId: 'invalid-mutation' });
    assert.match((await a.wait('error')).message, /范围/);
    for (const c of clients) c.ws.terminate();
    await app.close();
    app = createWhiteboardServer({ dataDir: directory }); port = await app.listen(0);
    const restored = await client(port, room, 'Restored'); clients.push(restored);
    assert.equal(restored.doc.getMap('strokes').size, 1);
    assert.equal(restored.doc.getMap('strokes').has('stroke-0002'), true);
    assert.equal(restored.doc.getMap('deleted').has(stroke.id), true);
  } finally {
    for (const c of clients) { c.ws.terminate(); c.doc.destroy(); }
    await app.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('invalid invitation is denied and rooms are isolated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-isolation-'));
  const app = createWhiteboardServer({ dataDir: directory }), port = await app.listen(0);
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    const create = () => fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Promise<Credentials>;
    const first = await create(), second = await create();
    const a = await client(port, first, 'A'), b = await client(port, second, 'B'); clients.push(a, b);
    a.send({ type: 'commit', stroke, mutationId: 'isolation-0001' }); await a.wait('saved');
    assert.equal(b.doc.getMap('strokes').size, 0);
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    bad.on('open', () => bad.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId: first.roomId, token: second.token, name: 'Intruder' })));
    const code = await new Promise<number>((resolve, reject) => { bad.on('close', resolve); bad.on('error', reject); });
    assert.equal(code, 1008);
  } finally { for (const c of clients) { c.ws.terminate(); c.doc.destroy(); } await app.close(); await rm(directory, { recursive: true, force: true }); }
});

async function rejected(port: number, roomId: string, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId, token, name: 'Rejected' })));
  return new Promise<number>((resolve, reject) => { ws.on('close', resolve); ws.on('error', reject); });
}

test('host lifecycle: personal credentials, pause, rotation, revocation, one-time claim and persistent end', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-management-'));
  let app = createWhiteboardServer({ dataDir: directory }), port = await app.listen(0);
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    const host = await client(port, room, 'Host'); clients.push(host);
    assert.equal(host.ready.host, true);
    const invitation = host.ready.access!.inviteToken;
    const guest = await client(port, { ...room, token: invitation, role: 'editor' }, 'Guest'); clients.push(guest);
    assert.notEqual(guest.ready.token, invitation);
    assert.equal(guest.ready.host, false);
    assert.equal(guest.ready.access!.claimToken, undefined);
    guest.send({ type: 'manage', action: 'end' });
    assert.match((await guest.wait('error')).message, /仅主持人/);
    host.send({ type: 'manage', action: 'pause' });
    await host.wait('access', m => m.access.paused);
    assert.equal(await rejected(port, room.roomId, invitation), 1008);
    const reconnected = await client(port, { ...room, token: guest.ready.token! }, 'Reconnect'); clients.push(reconnected);
    reconnected.send({ type: 'commit', stroke, mutationId: 'paused-existing-user' }); await reconnected.wait('saved');
    host.send({ type: 'manage', action: 'rotate' });
    const rotated = (await host.wait('access', m => m.access.inviteToken !== invitation)).access;
    host.send({ type: 'manage', action: 'resume' }); await host.wait('access', m => !m.access.paused && m.access.inviteToken === rotated.inviteToken);
    assert.equal(await rejected(port, room.roomId, invitation), 1008);
    const claimed = await client(port, { ...room, token: rotated.claimToken! }, 'Phone host'); clients.push(claimed);
    assert.equal(claimed.ready.host, true);
    assert.equal(await rejected(port, room.roomId, rotated.claimToken!), 1008);
    host.send({ type: 'manage', action: 'remove', memberId: guest.ready.memberId });
    await host.wait('access', m => m.access.inviteToken !== rotated.inviteToken && m.access.inviteToken !== invitation);
    assert.equal(await rejected(port, room.roomId, guest.ready.token!), 1008);
    assert.equal(await rejected(port, room.roomId, rotated.inviteToken), 1008);
    const persisted = await app.store.get(room.roomId);
    const freshInvite = persisted.access.inviteToken;
    persisted.access.expiresAt = Date.now() - 1;
    assert.equal(await rejected(port, room.roomId, freshInvite), 1008);
    host.send({ type: 'manage', action: 'end' }); await host.wait('access', m => m.access.ended);
    for (const c of clients) c.ws.terminate();
    await app.close(); app = createWhiteboardServer({ dataDir: directory }); port = await app.listen(0);
    assert.equal(await rejected(port, room.roomId, room.token), 1008);
    assert.equal(await rejected(port, room.roomId, room.viewerToken!), 1008);
    assert.equal((await app.store.get(room.roomId)).doc.getMap('strokes').size, 1);
  } finally { for (const c of clients) { c.ws.terminate(); c.doc.destroy(); } await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('text objects: previews, field-wise updates, retry deduplication, delete wins and restart recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-objects-'));
  let app = createWhiteboardServer({ dataDir: directory }), port = await app.listen(0);
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    const a = await client(port, room, 'A'), b = await client(port, room, 'B'), tv = await client(port, { ...room, token: room.viewerToken! }, 'TV'); clients.push(a, b, tv);
    const object = { id: 'object-note-01', kind: 'note' as const, x: 10, y: 20, text: '第一行\n共同创作', color: '#315EFB' };
    a.send({ type: 'object-preview', object, seq: 1 });
    assert.deepEqual((await tv.wait('object-preview', m => !!m.object)).object, object);
    assert.equal(tv.doc.getMap('objects').size, 0);
    tv.send({ type: 'create-object', object, mutationId: 'viewer-object-denied' }); assert.match((await tv.wait('error')).message, /仅可观看/);
    a.send({ type: 'create-object', object: { ...object, text: 'x'.repeat(501) }, mutationId: 'too-long-object' }); assert.match((await a.wait('error')).message, /范围/);
    a.send({ type: 'create-object', object, mutationId: 'create-object-01' }); await a.wait('saved');
    const move = { type: 'update-object' as const, objectId: object.id, patch: { x: 200, y: 300 }, mutationId: 'move-object-01' };
    a.send(move); b.send({ type: 'update-object', objectId: object.id, patch: { text: '新的内容' }, mutationId: 'text-object-01' });
    await Promise.all([a.wait('saved'), b.wait('saved')]);
    assert.deepEqual(b.doc.getMap('objects').get(object.id), { ...object, x: 200, y: 300, text: '新的内容' });
    b.send({ ...move, patch: { x: 500, y: 600 }, mutationId: 'move-object-02' }); await b.wait('saved');
    a.send(move); await a.wait('saved');
    assert.equal((a.doc.getMap('objects').get(object.id) as typeof object).x, 500, 'an acknowledged replay must not overwrite a newer move');
    b.send({ type: 'create-object', object: { ...object, id: 'object-text-02', kind: 'text' }, mutationId: 'create-object-02' }); await b.wait('saved');
    b.send({ type: 'delete-object', objectId: object.id, mutationId: 'delete-object-01' }); await b.wait('saved');
    a.send({ ...move, mutationId: 'late-move-object' }); await a.wait('saved');
    a.send({ type: 'create-object', object, mutationId: 'late-create-object' }); await a.wait('saved');
    assert.equal(a.doc.getMap('objects').has(object.id), false);
    for (const c of clients) c.ws.terminate(); await app.close();
    app = createWhiteboardServer({ dataDir: directory }); port = await app.listen(0);
    const restored = await client(port, room, 'Restored'); clients.push(restored);
    assert.equal(restored.doc.getMap('objects').size, 1);
    assert.equal(restored.doc.getMap('objects').has('object-text-02'), true);
    assert.equal(restored.doc.getMap('deletedObjects').has(object.id), true);
    assert.equal(restored.doc.getMap('objectMutations').has(move.mutationId), true);
  } finally { for (const c of clients) { c.ws.terminate(); c.doc.destroy(); } await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('legacy TV receives snapshots and previews with forced viewer permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-legacy-'));
  const app = createWhiteboardServer({ dataDir: directory }), port = await app.listen(0);
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    const editor = await client(port, room, 'Editor'), tv = await client(port, room, 'Legacy', true); clients.push(editor, tv);
    assert.equal(tv.ready.role, 'viewer'); assert.equal(tv.ready.update, ''); assert.deepEqual(tv.ready.snapshot?.strokes, []);
    tv.send({ type: 'commit', stroke, mutationId: 'legacy-write-denied' }); assert.match((await tv.wait('error')).message, /仅可观看/);
    const object = { id: 'legacy-note-01', kind: 'note' as const, x: 100, y: 100, text: '旧电视同步', color: '#315EFB' };
    editor.send({ type: 'object-preview', object, seq: 1 }); assert.deepEqual((await tv.wait('object-preview', m => !!m.object)).object, object);
    editor.send({ type: 'commit', stroke, mutationId: 'legacy-stroke-save' }); await editor.wait('saved');
    editor.send({ type: 'create-object', object, mutationId: 'legacy-note-save' }); await editor.wait('saved');
    const saved = await tv.wait('snapshot', m => m.objects.length === 1); assert.equal(saved.strokes.length, 1);
    editor.send({ type: 'delete-object', objectId: object.id, mutationId: 'legacy-note-delete' }); await editor.wait('saved');
    const deleted = await tv.wait('snapshot', m => m.objects.length === 0); assert.ok(deleted.deletedObjectIds?.includes(object.id));
  } finally { for (const c of clients) { c.ws.terminate(); c.doc.destroy(); } await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('images require room credentials, persist with geometry, reject wrong-kind patches and revoke removed access', async () => {
  const { png } = await import('./image-fixture');
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-image-http-'));
  let app = createWhiteboardServer({ dataDir: directory }), port = await app.listen(0);
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    const host = await client(port, room, 'Host'), guest = await client(port, { ...room, token: host.ready.access!.inviteToken }, 'Guest'); clients.push(host, guest);
    const path = () => `http://127.0.0.1:${port}/api/rooms/${room.roomId}/images`;
    const upload = (token: string, body = png()) => fetch(path(), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Whiteboard-Client': '1', 'Content-Type': 'image/png' }, body });
    assert.equal((await upload(room.viewerToken!)).status, 403);
    assert.equal((await upload(host.ready.access!.inviteToken)).status, 403);
    assert.equal((await upload(room.token, Buffer.from('<svg/>'))).status, 400);
    const response = await upload(guest.ready.token!); assert.equal(response.status, 201);
    const asset = await response.json() as { assetId: string; width: number; height: number };
    const read = (token: string) => fetch(path() + '/' + asset.assetId, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal((await read('')).status, 403); assert.equal((await read('x'.repeat(64))).status, 403);
    assert.deepEqual(Buffer.from(await (await read(room.viewerToken!)).arrayBuffer()), png());
    const other = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    assert.equal((await read(other.token)).status, 403);
    const object = { id: 'image-object-01', kind: 'image' as const, x: 100, y: 200, ...asset };
    host.send({ type: 'create-object', object: { ...object, assetId: 'f'.repeat(64) }, mutationId: 'missing-image-asset' }); await host.wait('error');
    host.send({ type: 'create-object', object, mutationId: 'create-image-asset' }); await host.wait('saved');
    host.send({ type: 'update-object', objectId: object.id, patch: { text: 'invalid' }, mutationId: 'image-text-denied' }); await host.wait('error');
    host.send({ type: 'update-object', objectId: object.id, patch: { width: 320, height: 240 }, mutationId: 'image-size-update' }); await host.wait('saved');
    guest.send({ type: 'update-object', objectId: object.id, patch: { x: 500, y: 600 }, mutationId: 'image-move-update' }); await guest.wait('saved');
    assert.deepEqual(host.doc.getMap('objects').get(object.id), { ...object, x: 500, y: 600, width: 320, height: 240 });
    host.send({ type: 'manage', action: 'remove', memberId: guest.ready.memberId }); await host.wait('access', m => m.access.inviteToken !== host.ready.access!.inviteToken);
    assert.equal((await read(guest.ready.token!)).status, 403); assert.equal((await upload(guest.ready.token!)).status, 403);
    for (const c of clients) c.ws.terminate(); await app.close(); app = createWhiteboardServer({ dataDir: directory }); port = await app.listen(0);
    assert.deepEqual(Buffer.from(await (await read(room.viewerToken!)).arrayBuffer()), png());
    const restored = await client(port, room, 'Restored'); clients.push(restored);
    assert.equal((restored.doc.getMap('objects').get(object.id) as { width: number }).width, 320);
    restored.send({ type: 'delete-object', objectId: object.id, mutationId: 'image-delete-01' }); await restored.wait('saved');
    restored.send({ type: 'update-object', objectId: object.id, patch: { width: 100, height: 100 }, mutationId: 'image-resize-late' }); await restored.wait('saved');
    assert.equal(restored.doc.getMap('objects').has(object.id), false);
    restored.send({ type: 'manage', action: 'end' }); await restored.wait('access', m => m.access.ended);
    assert.equal((await read(room.viewerToken!)).status, 403);
  } finally { for (const c of clients) { c.ws.terminate(); c.doc.destroy(); } await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('connected shapes merge geometry, detach at deletion, reject type changes and survive restart', async () => {
  const { resolveObject } = await import('@whiteboard/board-core');
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-shapes-'));
  let app = createWhiteboardServer({ dataDir: directory }), port = await app.listen(0);
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    const a = await client(port, room, 'A'), b = await client(port, room, 'B'), tv = await client(port, room, 'TV', true); clients.push(a, b, tv);
    const shape = { id: 'shape-0001', kind: 'shape' as const, shape: 'rectangle' as const, x: 0, y: 0, width: 200, height: 100, color: '#315EFB' };
    const other = { ...shape, id: 'shape-0002', shape: 'ellipse' as const, x: 500 };
    const link = { id: 'connector-01', kind: 'connector' as const, x: 100, y: 50, dx: 500, dy: 0, fromId: shape.id, toId: other.id, arrow: true, color: '#315EFB' };
    for (const object of [shape, other, link]) { a.send({ type: 'create-object', object, mutationId: 'create-' + object.id }); await a.wait('saved'); }
    const snapshot = await tv.wait('snapshot', m => m.objects.length === 3); assert.equal(snapshot.objects.filter(o => o.kind === 'connector').length, 1);
    a.send({ type: 'object-preview', object: { ...shape, x: 100 }, seq: 1 }); assert.equal((await tv.wait('object-preview', m => !!m.object)).object?.x, 100);
    a.send({ type: 'update-object', objectId: shape.id, patch: { x: 100, y: 100 }, mutationId: 'move-shape-01' });
    b.send({ type: 'update-object', objectId: shape.id, patch: { width: 300, height: 120 }, mutationId: 'resize-shape-01' });
    await Promise.all([a.wait('saved'), b.wait('saved')]);
    const objects = a.doc.getMap<import('@whiteboard/board-core').BoardObject>('objects');
    assert.deepEqual(objects.get(shape.id), { ...shape, x: 100, y: 100, width: 300, height: 120 });
    a.send({ type: 'update-object', objectId: shape.id, patch: { text: 'invalid' }, mutationId: 'shape-type-denied' }); await a.wait('error');
    const resolved = resolveObject(link, [...objects.values()]); assert.equal(resolved.kind, 'connector');
    b.send({ type: 'delete-object', objectId: shape.id, mutationId: 'delete-shape-01' }); await b.wait('saved');
    await a.wait('update', () => !objects.has(shape.id));
    assert.deepEqual(objects.get(link.id), { ...resolved, fromId: null });
    a.send({ type: 'update-object', objectId: shape.id, patch: { x: 700, y: 700 }, mutationId: 'late-move-shape' }); await a.wait('saved'); assert.equal(objects.has(shape.id), false);
    a.send({ type: 'create-object', object: { ...link, id: 'connector-02', fromId: 'other-room-id', toId: null }, mutationId: 'unknown-target-link' }); await a.wait('saved');
    assert.equal((objects.get('connector-02') as typeof link).fromId, null);
    for (const c of clients) c.ws.terminate(); await app.close(); app = createWhiteboardServer({ dataDir: directory }); port = await app.listen(0);
    const restored = await client(port, room, 'Restored'); clients.push(restored);
    assert.deepEqual(restored.doc.getMap('objects').get(link.id), { ...resolved, fromId: null });
  } finally { for (const c of clients) { c.ws.terminate(); c.doc.destroy(); } await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('personal durable history preserves other fields, skips competing writes, restores links, and deduplicates after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-history-'));
  let app = createWhiteboardServer({ dataDir: directory });
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  let sequence = 0;
  const send = async (c: Awaited<ReturnType<typeof client>>, value: any) => {
    const mutationId = 'history-test-' + (++sequence); c.send({ ...value, mutationId });
    return c.wait('saved', m => m.mutationId === mutationId);
  };
  try {
    let port = await app.listen(0);
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    const a = await client(port, room, 'A');
    const b = await client(port, { ...room, token: a.ready.access!.inviteToken }, 'B');
    const tv = await client(port, { ...room, token: room.viewerToken! }, 'TV', true); clients.push(a,b,tv);
    const shape = { id: 'history-shape', kind: 'shape', shape: 'rectangle', x: 0, y: 0, width: 200, height: 120, color: '#315EFB' };
    await send(a, { type: 'create-object', object: shape });
    await send(a, { type: 'update-object', objectId: shape.id, patch: { x: 100, y: 50 } });
    await send(b, { type: 'update-object', objectId: shape.id, patch: { width: 300, height: 180 } });
    await send(a, { type: 'history', direction: 'undo' });
    let value = a.doc.getMap<any>('objects').get(shape.id);
    assert.equal(value.x, 0); assert.equal(value.width, 300, 'undo movement preserves peer resize');
    await send(a, { type: 'history', direction: 'redo' });
    assert.equal(a.doc.getMap<any>('objects').get(shape.id).x, 100);
    await send(b, { type: 'update-object', objectId: shape.id, patch: { x: 100, y: 50 } });
    assert.match((await send(a, { type: 'history', direction: 'undo' })).notice!, /已跳过/, 'same-value writes still own the field');
    assert.equal(a.doc.getMap<any>('objects').get(shape.id).x, 100);
    const link = { id: 'history-connector', kind: 'connector', x: 200, y: 100, dx: 300, dy: 0, fromId: shape.id, toId: null, arrow: true, color: '#315EFB' };
    await send(a, { type: 'create-object', object: link });
    await send(a, { type: 'delete-object', objectId: shape.id });
    assert.equal(a.doc.getMap<any>('objects').get(link.id).fromId, null);
    const undo = await send(a, { type: 'history', direction: 'undo' });
    assert.equal(undo.notice, undefined);
    assert.equal(a.doc.getMap<any>('objects').get(link.id).fromId, shape.id);
    assert.equal(a.doc.getMap<any>('objects').get(shape.id).width, 300);
    const restored = await tv.wait('snapshot', m => m.objects.some(o => o.id === shape.id) && m.objects.some(o => o.kind === 'connector' && o.fromId === shape.id));
    assert.equal(restored.deletedObjectIds!.includes(shape.id), false);
    assert.deepEqual(restored.objects.map(o => o.id), [shape.id, link.id], 'delete/undo retains durable stacking order');
    await send(a, { type: 'history', direction: 'redo' });
    await send(a, { type: 'history', direction: 'undo' });
    const originalCommit = { type: 'commit' as const, stroke, mutationId: 'history-original-commit' };
    a.send(originalCommit); await a.wait('saved', m => m.mutationId === originalCommit.mutationId);
    await send(b, { type: 'delete', strokeId: stroke.id });
    await send(b, { type: 'history', direction: 'undo' });
    assert.equal(a.doc.getMap('strokes').has(stroke.id), true);
    const lastUndo = await send(a, { type: 'history', direction: 'undo' });
    assert.equal(a.doc.getMap('strokes').has(stroke.id), false);
    a.send(originalCommit); await a.wait('saved', m => m.mutationId === originalCommit.mutationId);
    assert.equal(a.doc.getMap('strokes').has(stroke.id), false, 'replayed creation cannot restore undone stroke');
    tv.send({ type: 'history', direction: 'redo', mutationId: 'viewer-history-test' });
    assert.match((await tv.wait('error')).message, /仅可观看/);
    clients.forEach(c => c.ws.terminate()); await app.close();
    app = createWhiteboardServer({ dataDir: directory }); port = await app.listen(0);
    const reconnected = await client(port, room, 'A reconnected'); clients.push(reconnected);
    assert.ok((await reconnected.wait('history-state')).history.redo > 0);
    reconnected.send({ type: 'history', direction: 'undo', mutationId: lastUndo.mutationId });
    await reconnected.wait('saved', m => m.mutationId === lastUndo.mutationId);
    assert.equal(reconnected.doc.getMap('objects').size, 2, 'repeated undo after reconnect does not undo another item');
    await send(reconnected, { type: 'history', direction: 'redo' });
    assert.equal(reconnected.doc.getMap('strokes').has(stroke.id), true);
  } finally { clients.forEach(c => { c.ws.terminate(); c.doc.destroy(); }); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('failed history persistence leaves the document and undo stack intact until a successful retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-history-atomic-'));
  const app = createWhiteboardServer({ dataDir: directory }), port = await app.listen(0);
  let a: Awaited<ReturnType<typeof client>> | undefined;
  try {
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    a = await client(port, room, 'A');
    a.send({ type: 'commit', stroke, mutationId: 'atomic-stroke-create' }); await a.wait('saved');
    const save = app.store.save.bind(app.store);
    app.store.save = async () => { throw new Error('injected write failure'); };
    const command = { type: 'history' as const, direction: 'undo' as const, mutationId: 'atomic-undo-retry' };
    a.send(command); await a.wait('error', m => m.mutationId === command.mutationId);
    assert.equal(a.doc.getMap('strokes').size, 1);
    assert.equal((await app.store.get(room.roomId)).doc.getMap('strokes').size, 1);
    app.store.save = save;
    a.send(command); await a.wait('saved', m => m.mutationId === command.mutationId);
    assert.equal(a.doc.getMap('strokes').size, 0);
    a.send(command); await a.wait('saved', m => m.mutationId === command.mutationId);
    assert.equal(a.doc.getMap('strokes').size, 0);
  } finally { a?.ws.terminate(); a?.doc.destroy(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('TV first editor hosting is atomic, persists across restart and is not reset by rotation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-auto-host-'));
  let app = createWhiteboardServer({ dataDir: directory }), port = await app.listen(0);
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  const add = async (credentials: Credentials, name: string, legacy = false) => { const c = await client(port, credentials, name, legacy); clients.push(c); return c; };
  try {
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms?mode=tv`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
    const tv = await add(room, 'TV', true), invitation = tv.ready.access!.inviteToken;
    const stored = await app.store.get(room.roomId);
    assert.equal(stored.access.autoHostPending, true);
    const watcher = await add({ ...room, token: invitation }, 'Read only', true);
    assert.equal(watcher.ready.host, false);
    assert.equal(stored.access.autoHostPending, true);
    tv.send({ type: 'manage', action: 'pause' }); await tv.wait('access', m => m.access.paused);
    assert.equal(await rejected(port, room.roomId, invitation), 1008);
    assert.equal(stored.access.autoHostPending, true);
    tv.inbox.length = 0;
    tv.send({ type: 'manage', action: 'resume' }); await tv.wait('access', m => !m.access.paused);
    const save = app.store.save.bind(app.store);
    app.store.save = async () => { throw new Error('simulated persistence failure'); };
    assert.equal(await rejected(port, room.roomId, invitation), 1008);
    assert.equal(stored.access.autoHostPending, true);
    app.store.save = save;
    const joined = await Promise.all([add({ ...room, token: invitation }, 'First'), add({ ...room, token: invitation }, 'Second')]);
    assert.equal(joined.filter(c => c.ready.host).length, 1);
    const host = joined.find(c => c.ready.host)!, guest = joined.find(c => !c.ready.host)!;
    assert.equal(stored.access.autoHostPending, false);
    assert.equal(stored.access.claimToken, '');
    guest.send({ type: 'manage', action: 'end' }); assert.match((await guest.wait('error')).message, /仅主持人/);
    host.send({ type: 'manage', action: 'rotate' });
    const rotated = (await host.wait('access', m => m.access.inviteToken !== invitation)).access;
    assert.equal((await add({ ...room, token: rotated.inviteToken }, 'Later')).ready.host, false);
    for (const c of clients) c.ws.terminate(); await app.close();
    app = createWhiteboardServer({ dataDir: directory }); port = await app.listen(0);
    assert.equal((await add({ ...room, token: host.ready.token! }, 'Host reconnect')).ready.host, true);
    assert.equal((await add({ ...room, token: guest.ready.token! }, 'Guest reconnect')).ready.host, false);
    assert.equal((await add({ ...room, token: rotated.inviteToken }, 'After restart')).ready.host, false);
  } finally { for (const c of clients) { c.ws.terminate(); c.doc.destroy(); } await app.close(); await rm(directory, { recursive: true, force: true }); }
});
