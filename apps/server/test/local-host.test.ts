import { request } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createWhiteboardServer } from '../src/server';
import { localRequestAllowed } from '../src/local-policy';

test('local host: LAN changes, DNS rebinding protection, authenticated shutdown and private storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-local-'));
  let origin: string | null = 'http://192.168.1.20:8787', stopped = false;
  const app = createWhiteboardServer({ dataDir: directory, local: { joinOrigin: () => origin, allowRequest: req => localRequestAllowed(req, origin), stopToken: 'a'.repeat(64), stop: () => { stopped = true; } } });
  try {
    const port = await app.listen(0), base = `http://127.0.0.1:${port}`;
    const info = () => fetch(base + '/api/local-info').then(r => r.json());
    assert.deepEqual(await info(), { mode: 'local', joinOrigin: origin });
    origin = null; assert.equal((await info()).joinOrigin, null);
    origin = 'http://192.168.1.21:8787'; assert.equal((await info()).joinOrigin, origin);
    assert.equal(await new Promise<number | undefined>((resolve, reject) => { const req = request(base + '/api/health', { headers: { Host: 'rebound.example:8787' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); }), 403);
    assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { 'X-Whiteboard-Client': '1', Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(base + '/api/local-stop', { method: 'POST' })).status, 403);
    assert.equal((await fetch(base + '/api/local-stop', { method: 'POST', headers: { 'X-Local-Control': 'é'.repeat(64) } })).status, 403);
    assert.equal(stopped, false);
    assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'null' } })).status, 403);
    assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'null', 'User-Agent': 'WebView WhiteboardTV/0.3.0' } })).status, 200);
    // WebSocket handshakes must apply the same origin policy as HTTP.
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws', { origin: 'https://evil.example' });
      socket.on('open', () => { socket.close(); reject(new Error('Cross-origin socket accepted')); });
      socket.on('error', error => { try { assert.match(error.message, /401/); resolve(); } catch (e) { reject(e); } });
    });
    const created = await fetch(base + '/api/rooms?mode=tv', { method: 'POST', headers: { 'X-Whiteboard-Client': '1', Origin: base } });
    assert.equal(created.status, 201);
    const credentials = await created.json();
    const room = await app.store.get(credentials.roomId);
    room.access.expiresAt = Date.now() - 1000; await app.store.save(room, room.doc);
    const previous = room.access.inviteToken;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws', { origin: base });
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('No local restore')); }, 5000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId: room.id, token: room.viewerToken, name: 'TV', viewOnly: true, legacyTV: true })));
      socket.on('error', reject);
      socket.on('message', raw => {
        const message = JSON.parse(raw.toString()); if (message.type !== 'ready') return;
        clearTimeout(timer); socket.close();
        try { assert.notEqual(message.access.inviteToken, previous); assert.ok(message.access.expiresAt > Date.now()); assert.equal(message.host, false); resolve(); } catch (e) { reject(e); }
      });
    });
    assert.equal((await fetch(base + '/api/local-stop', { method: 'POST', headers: { 'X-Local-Control': 'a'.repeat(64) } })).status, 202);
    assert.equal(stopped, true);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
