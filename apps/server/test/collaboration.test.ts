import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import type { ClientMessage, Credentials, ServerMessage, Stroke } from '@whiteboard/board-core';
import { createWhiteboardServer } from '../src/server';

async function client(port: number, credentials: Credentials, name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), doc = new Y.Doc();
  const inbox: ServerMessage[] = [];
  ws.on('message', raw => {
    const message: ServerMessage = JSON.parse(raw.toString()); inbox.push(message);
    if (message.type === 'ready' || message.type === 'update') Y.applyUpdate(doc, Buffer.from(message.update, 'base64'));
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
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId: credentials.roomId, token: credentials.token, name }));
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
    const room = await fetch(`http://127.0.0.1:${port}/api/rooms?mode=tv`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } }).then(r => r.json()) as Credentials;
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
