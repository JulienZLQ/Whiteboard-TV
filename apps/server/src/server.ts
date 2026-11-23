import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { COLORS, IMAGE_LIMITS, validAssetId, LIMITS, OBJECT_LIMITS, validId, validObject, validObjectPatch, validPoint, validStroke, type BoardObject, type ClientMessage, type ServerMessage, type Member, type Stroke } from '@whiteboard/board-core';
import { ImageStore } from './images';
import { RoomStore, secret, type Room } from './store';

type Peer = { legacyTV: boolean; snapshotTimer?: ReturnType<typeof setTimeout>; room: Room; member: Member; token: string; previewSeq: number; objectSeq: number; alive: boolean };
const matches = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export function createWhiteboardServer(options: { dataDir: string; webRoot?: string }) {
  const store = new RoomStore(options.dataDir);
  const peers = new Map<WebSocket, Peer>();
  const images = new ImageStore(options.dataDir);
  let creating = 0, uploading = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true,"stage":"M3-images"}'); return; }
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      // JSON/custom-header requirement blocks ordinary cross-origin forms; no CORS is enabled.
      if (req.headers['x-whiteboard-client'] !== '1' || creating >= 4) { res.writeHead(403).end(); return; }
      creating++;
      try {
        const room = await store.create();
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
        res.writeHead(201).end(JSON.stringify({ roomId: room.id, token: room.editorToken, viewerToken: room.viewerToken, role: url.searchParams.get('mode') === 'tv' ? 'viewer' : 'editor' }));
      } catch { res.writeHead(503).end(JSON.stringify({ error: '无法创建房间，请稍后重试' })); }
      finally { creating--; }
      return;
    }
    const imageRoute = /^\/api\/rooms\/([a-f0-9]{24})\/images(?:\/([a-f0-9]{64}))?$/.exec(url.pathname);
    if (imageRoute) {
      res.setHeader('Cache-Control', 'no-store');
      let room: Room;
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      try { room = await store.get(imageRoute[1]); } catch { res.writeHead(404).end(); return; }
      const canEdit = /^[a-f0-9]{64}$/.test(token) && (matches(token, room.access.hostToken) || room.access.editors.includes(token));
      const allowed = /^[a-f0-9]{64}$/.test(token) && !room.access.ended && (canEdit || matches(token, room.viewerToken));
      if (!allowed) { res.writeHead(403).end(); return; }
      if (req.method === 'GET' && imageRoute[2]) {
        try { const bytes = await images.get(room.id, imageRoute[2]); res.setHeader('Content-Type', 'image/png'); res.end(bytes); }
        catch { res.writeHead(404).end(); }
        return;
      }
      if (req.method !== 'POST' || imageRoute[2]) { res.writeHead(405).end(); return; }
      if (!canEdit || req.headers['x-whiteboard-client'] !== '1' || req.headers['content-type'] !== 'image/png') { res.writeHead(403).end(); return; }
      if (uploading >= 4) { res.writeHead(429).end(); return; }
      if (Number(req.headers['content-length']) > IMAGE_LIMITS.bytes) { res.writeHead(413).end(); return; }
      uploading++;
      req.setTimeout(15000, () => req.destroy());
      try {
        const chunks: Buffer[] = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > IMAGE_LIMITS.bytes) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        // Serialize uploads with room management so revocation/end cannot race a write.
        const task = room.queue.then(async () => {
          if (room.access.ended || !(matches(token, room.access.hostToken) || room.access.editors.includes(token))) throw new Error('会话权限已失效');
          return images.put(room.id, Buffer.concat(chunks));
        });
        room.queue = task.then(() => {}, () => {});
        const asset = await task;
        res.setHeader('Content-Type', 'application/json'); res.writeHead(201).end(JSON.stringify(asset));
      } catch (error) { if (!res.headersSent) res.writeHead(400).end(JSON.stringify({ error: error instanceof Error ? error.message : '图片上传失败' })); }
      finally { uploading--; req.setTimeout(0); }
      return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404).end(); return; }
    if (!options.webRoot || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404).end(); return; }
    try {
      const root = resolve(options.webRoot);
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const file = await stat(path).then(s => s.isFile() ? path : resolve(root, 'index.html')).catch(() => extname(path) ? '' : resolve(root, 'index.html'));
      if (!file) { res.writeHead(404).end(); return; }
      const body = await readFile(file);
      res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404).end(); }
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
  wss.on('error', () => { /* HTTP listen failures are reported by listen(). */ });
  function send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'Slow client'); return; }
    const peer = peers.get(ws);
    if (peer?.legacyTV && (message.type === 'ready' || message.type === 'update')) {
      const snapshot = () => ({ strokes: [...peer.room.doc.getMap<Stroke>('strokes').values()], objects: [...peer.room.doc.getMap<BoardObject>('objects').values()], deletedObjectIds: [...peer.room.doc.getMap('deletedObjects').keys()], deletedStrokeIds: [...peer.room.doc.getMap('deleted').keys()] });
      if (message.type === 'ready') ws.send(JSON.stringify({ ...message, update: '', snapshot: snapshot() }));
      else if (!peer.snapshotTimer) peer.snapshotTimer = setTimeout(() => {
        peer.snapshotTimer = undefined;
        if (peers.get(ws) === peer) send(ws, { type: 'snapshot', ...snapshot() });
      }, 100);
      return;
    }
    ws.send(JSON.stringify(message));
  }
  function members(room: Room) { return [...peers.values()].filter(p => p.room === room).map(p => p.member); }
  function broadcast(room: Room, message: ServerMessage, except?: WebSocket) {
    for (const [socket, peer] of peers) if (peer.room === room && socket !== except) send(socket, message);
  }
  function publishMembers(room: Room) { broadcast(room, { type: 'members', members: members(room) }); }
  function access(room: Room, host = false) { const a = room.access; return { inviteToken: a.inviteToken, expiresAt: a.expiresAt, paused: a.paused, ended: a.ended, ...(host ? { claimToken: a.claimToken } : {}) }; }
  function publishAccess(room: Room) { for (const [ws, p] of peers) if (p.room === room) send(ws, { type: 'access', access: access(room, p.member.host) }); }
  wss.on('connection', ws => {
    let authenticating = false, count = 0, period = Date.now();
    const deadline = setTimeout(() => { if (!peers.has(ws)) ws.close(1008, 'Authentication required'); }, 5000);
    ws.on('error', () => {});
    ws.on('pong', () => { const peer = peers.get(ws); if (peer) peer.alive = true; });
    ws.on('message', raw => {
      if (Date.now() - period > 1000) { count = 0; period = Date.now(); }
      if (++count > 100) { ws.close(1008, 'Rate limit'); return; }
      let message: ClientMessage;
      try { message = JSON.parse(raw.toString()); if (!message || typeof message !== 'object') throw new Error(); }
      catch { send(ws, { type: 'error', message: '消息格式错误' }); return; }
      const peer = peers.get(ws);
      if (!peer) {
        if (authenticating || message.type !== 'hello') return;
        const hello = message;
        if (hello.protocolVersion !== 1 || typeof hello.token !== 'string' || !/^[a-f0-9]{64}$/.test(hello.token) || typeof hello.name !== 'string') { ws.close(1008, 'Invalid credentials'); return; }
        authenticating = true;
        void store.get(hello.roomId).then(room => {
          room.queue = room.queue.then(async () => {
            if (ws.readyState !== WebSocket.OPEN) return;
            let token = hello.token, host = matches(token, room.access.hostToken);
            let role: Member['role'] | null = host || room.access.editors.includes(token) ? 'editor' : matches(token, room.viewerToken) ? 'viewer' : null;
            const claim = !!room.access.claimToken && matches(token, room.access.claimToken);
            const joining = matches(token, room.access.inviteToken);
            if (room.access.ended || members(room).length >= 32 || ((joining || claim) && (room.access.paused || Date.now() >= room.access.expiresAt))) { ws.close(1008, 'Room unavailable'); return; }
            if (claim || joining) {
              if (!claim && room.access.editors.length >= 256) { ws.close(1008, 'Room full'); return; }
              const previous = room.access;
              token = claim ? room.access.hostToken : secret(); host = claim; role = 'editor';
              room.access = { ...previous, editors: claim ? previous.editors : [...previous.editors, token], claimToken: claim ? '' : previous.claimToken };
              try { await store.save(room, room.doc); } catch (e) { room.access = previous; throw e; }
            }
            if (ws.readyState !== WebSocket.OPEN) return;
            if (!role) { ws.close(1008, 'Invalid credentials'); return; }
            if (hello.viewOnly || hello.legacyTV) role = 'viewer';
            const member: Member = { id: randomBytes(8).toString('hex'), name: hello.name.replace(/[\u0000-\u001f]/g, '').slice(0, 20) || '访客', color: COLORS[members(room).length % COLORS.length], role, host, cursor: null };
            peers.set(ws, { legacyTV: hello.legacyTV === true, room, member, token, previewSeq: -1, objectSeq: -1, alive: true }); clearTimeout(deadline);
            send(ws, { type: 'ready', memberId: member.id, token, host, role, access: access(room, host), viewerToken: room.viewerToken, update: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64'), members: members(room) });
            publishMembers(room); publishAccess(room);
          }).catch(() => ws.close(1008, 'Room unavailable'));
        }).catch(() => ws.close(1008, 'Room unavailable'));
        return;
      }
      if (message.type === 'manage') {
        if (!peer.member.host) { send(ws, { type: 'error', message: '仅主持人可以管理会话' }); return; }
        const command = message;
        peer.room.queue = peer.room.queue.then(async () => {
          const room = peer.room;
          if (peers.get(ws) !== peer || room.access.ended) return;
          const previous = room.access;
          const next = { ...previous, editors: [...previous.editors] };
          let removed: Peer | undefined;
          if (command.action === 'pause') next.paused = true;
          else if (command.action === 'resume') next.paused = false;
          else if (command.action === 'rotate') { next.inviteToken = secret(); next.claimToken = secret(); next.expiresAt = Date.now() + 12 * 60 * 60 * 1000; }
          else if (command.action === 'end') { next.ended = true; next.paused = true; }
          else if (command.action === 'remove') {
            removed = [...peers.values()].find(p => p.room === room && p.member.id === command.memberId && !p.member.host && p.member.role === 'editor');
            if (!removed) return;
            next.editors = next.editors.filter(t => t !== removed!.token);
            next.inviteToken = secret(); next.claimToken = secret(); next.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
          } else return;
          room.access = next;
          try { await store.save(room, room.doc); } catch (e) { room.access = previous; throw e; }
          publishAccess(room);
          for (const [socket, p] of peers) if (p.room === room && (next.ended || (removed && p.token === removed.token))) {
            clearTimeout(p.snapshotTimer); peers.delete(socket); socket.close(1008, next.ended ? 'Session ended' : 'Removed by host');
            broadcast(room, { type: 'preview', memberId: p.member.id, stroke: null });
            broadcast(room, { type: 'object-preview', memberId: p.member.id, object: null });
          }
          publishMembers(room);
        }).catch(() => send(ws, { type: 'error', message: '管理操作保存失败，请重试' }));
      } else if (message.type === 'presence') {
        if (message.cursor !== null && !validPoint(message.cursor)) return;
        peer.member.cursor = message.cursor;
        broadcast(peer.room, { type: 'presence', member: peer.member }, ws);
      } else if (message.type === 'preview') {
        if (peer.member.role !== 'editor' || !Number.isSafeInteger(message.seq) || message.seq <= peer.previewSeq || (message.stroke !== null && !validStroke(message.stroke))) return;
        peer.previewSeq = message.seq;
        broadcast(peer.room, { type: 'preview', memberId: peer.member.id, stroke: message.stroke }, ws);
      } else if (message.type === 'object-preview') {
        if (peer.member.role !== 'editor' || !Number.isSafeInteger(message.seq) || message.seq <= peer.objectSeq || (message.object !== null && !validObject(message.object))) return;
        peer.objectSeq = message.seq;
        broadcast(peer.room, { type: 'object-preview', memberId: peer.member.id, object: message.object }, ws);
      } else if (message.type === 'create-object' || message.type === 'update-object' || message.type === 'delete-object') {
        const operation = message;
        if (!validId(operation.mutationId)) return;
        if (peer.member.role !== 'editor') { send(ws, { type: 'error', message: '电视凭证仅可观看', mutationId: operation.mutationId }); return; }
        if (operation.type === 'create-object' ? !validObject(operation.object) : !validId(operation.objectId) || (operation.type === 'update-object' && !validObjectPatch(operation.patch))) {
          send(ws, { type: 'error', message: '文字或对象超出支持范围', mutationId: operation.mutationId }); return;
        }
        peer.room.queue = peer.room.queue.then(async () => {
          if (peers.get(ws) !== peer || peer.room.access.ended) return;
          const room = peer.room, candidate = new Y.Doc();
          try {
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc));
            const objects = candidate.getMap<BoardObject>('objects'), deleted = candidate.getMap<boolean>('deletedObjects'), applied = candidate.getMap<boolean>('objectMutations');
            if (!applied.has(operation.mutationId)) {
              if (applied.size >= OBJECT_LIMITS.mutations) throw new Error('对象操作数量已达预览版本上限');
              const id = operation.type === 'create-object' ? operation.object.id : operation.objectId;
              if (operation.type === 'create-object' && !objects.has(id) && !deleted.has(id)) {
                if (objects.size >= OBJECT_LIMITS.count) throw new Error('文字与便签数量已达预览版本上限');
                const object = operation.object;
                if (object.kind === 'image') {
                  if (!validAssetId(object.assetId) || !await images.exists(room.id, object.assetId)) throw new Error('图片尚未上传或不存在');
                  const { x, y, assetId, width, height } = object;
                  objects.set(id, { id, kind: 'image', x, y, assetId, width, height });
                } else { const { kind, x, y, text, color } = object; objects.set(id, { id, kind, x, y, text, color }); }
              } else if (operation.type === 'update-object' && objects.has(id) && !deleted.has(id)) {
                const current = objects.get(id)!;
                if (('text' in operation.patch && current.kind === 'image') || ('width' in operation.patch && current.kind !== 'image')) throw new Error('对象不支持此操作');
                objects.set(id, { ...current, ...operation.patch });
              } else if (operation.type === 'delete-object') { deleted.set(id, true); objects.delete(id); }
              applied.set(operation.mutationId, true);
              await store.save(room, candidate);
              const update = Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(room.doc));
              Y.applyUpdate(room.doc, update);
              broadcast(room, { type: 'update', update: Buffer.from(update).toString('base64') });
            }
            broadcast(room, { type: 'object-preview', memberId: peer.member.id, object: null });
            send(ws, { type: 'saved', mutationId: operation.mutationId });
          } finally { candidate.destroy(); }
        }).catch(error => send(ws, { type: 'error', mutationId: operation.mutationId, message: error.message?.includes('上限') ? error.message : '保存失败，请重试；本地内容仍保留' }));
      } else if (message.type === 'commit' || message.type === 'delete') {
        const operation = message;
        if (typeof operation.mutationId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(operation.mutationId)) return;
        if (peer.member.role !== 'editor') { send(ws, { type: 'error', message: '电视凭证仅可观看', mutationId: operation.mutationId }); return; }
        if ((operation.type === 'commit' && !validStroke(operation.stroke)) || (operation.type === 'delete' && (typeof operation.strokeId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(operation.strokeId)))) {
          send(ws, { type: 'error', message: '笔迹超出支持范围', mutationId: operation.mutationId }); return;
        }
        peer.room.queue = peer.room.queue.then(async () => {
          if (peers.get(ws) !== peer || peer.room.access.ended) return;
          const room = peer.room, candidate = new Y.Doc();
          try {
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc));
            const strokes = candidate.getMap<Stroke>('strokes'), deleted = candidate.getMap<boolean>('deleted');
            if (operation.type === 'commit') {
              if (!deleted.has(operation.stroke.id) && !strokes.has(operation.stroke.id)) {
                let points = operation.stroke.points.length / 2;
                for (const s of strokes.values()) points += s.points.length / 2;
                if (strokes.size >= LIMITS.strokes || points > LIMITS.pointsPerRoom) throw new Error('白板容量已达实验版本上限');
                strokes.set(operation.stroke.id, operation.stroke);
              }
            } else {
              if (deleted.size >= 10_000) throw new Error('操作数量已达实验版本上限');
              deleted.set(operation.strokeId, true); strokes.delete(operation.strokeId);
            }
            await store.save(room, candidate);
            const update = Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(room.doc));
            Y.applyUpdate(room.doc, update);
            broadcast(room, { type: 'update', update: Buffer.from(update).toString('base64') });
            broadcast(room, { type: 'preview', memberId: peer.member.id, stroke: null });
            send(ws, { type: 'saved', mutationId: operation.mutationId });
          } finally { candidate.destroy(); }
        }).catch(error => send(ws, { type: 'error', mutationId: operation.mutationId, message: error.message?.includes('上限') ? error.message : '保存失败，请重试；本地笔迹仍保留' }));
      }
    });
    ws.on('close', () => {
      clearTimeout(deadline);
      const peer = peers.get(ws); peers.delete(ws);
      if (peer) { clearTimeout(peer.snapshotTimer); broadcast(peer.room, { type: 'object-preview', memberId: peer.member.id, object: null }); publishMembers(peer.room); broadcast(peer.room, { type: 'preview', memberId: peer.member.id, stroke: null }); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const [socket, peer] of peers) {
      if (!peer.alive) socket.terminate();
      else { peer.alive = false; socket.ping(); }
    }
  }, 15_000);
  heartbeat.unref();
  return {
    server, store,
    listen: (port = 8787, host = '127.0.0.1') => new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve((server.address() as { port: number }).port); });
    }),
    close: async () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
      await store.close();
    },
  };
}
