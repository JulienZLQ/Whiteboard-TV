import * as Y from 'yjs';
import { LIMITS, type ClientMessage, type Credentials, type Member, type Preview, type ServerMessage, type Stroke } from '@whiteboard/board-core';

export function newId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''); }
type Mutation = Extract<ClientMessage, { type: 'commit' | 'delete' }>;
export type SessionState = { connection: 'connecting' | 'online' | 'offline' | 'denied'; pending: number; error: string; members: Member[]; memberId: string };
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));

export class BoardSession {
  readonly doc = new Y.Doc();
  readonly previews = new Map<string, Preview>();
  readonly members = new Map<string, Member>();
  private pending = new Map<string, Mutation>();
  private inFlight = new Set<string>();
  private uiListeners = new Set<() => void>();
  private canvasListeners = new Set<() => void>();
  private socket?: WebSocket;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private sweep: ReturnType<typeof setInterval>;
  private retry = 500;
  private seq = 0;
  private lastPresence = 0;
  private lastPreview = 0;
  private queueKey: string;
  private state: SessionState = { connection: 'connecting', pending: 0, error: '', members: [], memberId: '' };
  constructor(readonly credentials: Credentials, readonly name: string) {
    this.queueKey = `whiteboard.pending.${credentials.roomId}`;
    try {
      const saved = credentials.role === 'editor' ? JSON.parse(sessionStorage.getItem(this.queueKey) ?? '[]') as Mutation[] : [];
      for (const operation of saved) this.pending.set(operation.mutationId, operation);
    } catch { /* Storage may be disabled; live session still works. */ }
    this.doc.on('update', this.redraw);
    window.addEventListener('offline', this.offline);
    window.addEventListener('online', this.online);
    this.sweep = setInterval(() => {
      let changed = false;
      for (const [id, preview] of this.previews) if (Date.now() - preview.updatedAt > LIMITS.previewTtl) { this.previews.delete(id); changed = true; }
      if (changed) this.redraw();
    }, 500);
  }
  subscribe = (listener: () => void) => { this.uiListeners.add(listener); return () => { this.uiListeners.delete(listener); }; };
  subscribeCanvas = (listener: () => void) => { this.canvasListeners.add(listener); return () => { this.canvasListeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(patch: Partial<SessionState> = {}) {
    this.state = { ...this.state, ...patch, pending: this.pending.size };
    for (const listener of this.uiListeners) listener();
  }
  private redraw = () => { for (const listener of this.canvasListeners) listener(); };
  private send(message: ClientMessage) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  private offline = () => {
    clearTimeout(this.timer); this.publish({ connection: 'offline', members: [] });
    this.socket?.close();
  };
  private online = () => {
    if (this.stopped || this.state.connection === 'denied') return;
    clearTimeout(this.timer); this.connect();
  };
  connect = () => {
    if (this.stopped) return;
    if (!navigator.onLine) { this.publish({ connection: 'offline' }); return; }
    this.publish({ connection: 'connecting' });
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    this.socket = ws;
    ws.onopen = () => this.send({ type: 'hello', protocolVersion: 1, roomId: this.credentials.roomId, token: this.credentials.token, name: this.name });
    ws.onmessage = event => {
      let message: ServerMessage;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'ready') {
        this.retry = 500; this.seq = 0;
        this.credentials.viewerToken = message.viewerToken;
        this.credentials.role = message.role;
        Y.applyUpdate(this.doc, decode(message.update));
        this.members.clear(); for (const member of message.members) this.members.set(member.id, member);
        this.publish({ connection: 'online', memberId: message.memberId, members: message.members, error: '' });
        this.inFlight.clear(); this.flush();
        this.redraw();
      } else if (message.type === 'members') {
        this.members.clear(); for (const member of message.members) this.members.set(member.id, member);
        this.publish({ members: message.members }); this.redraw();
      } else if (message.type === 'presence') {
        this.members.set(message.member.id, message.member); this.redraw();
      } else if (message.type === 'preview') {
        if (message.stroke) this.previews.set(message.memberId, { memberId: message.memberId, stroke: message.stroke, updatedAt: Date.now() });
        else this.previews.delete(message.memberId);
        this.redraw();
      } else if (message.type === 'update') {
        Y.applyUpdate(this.doc, decode(message.update));
      } else if (message.type === 'saved') {
        this.pending.delete(message.mutationId); this.inFlight.delete(message.mutationId); this.persistQueue(); this.publish({ error: '' }); this.redraw(); this.flush();
      } else if (message.type === 'error') {
        this.publish({ error: message.message });
      }
    };
    ws.onclose = event => {
      if (ws !== this.socket) return;
      this.members.clear(); this.previews.clear(); this.inFlight.clear(); this.redraw();
      if (this.stopped) return;
      if (event.code === 1008) { this.publish({ connection: 'denied', members: [], error: '房间无法访问或连接受限，请重新打开邀请链接' }); return; }
      this.publish({ connection: 'offline', members: [] });
      if (navigator.onLine) this.timer = setTimeout(this.connect, this.retry);
      this.retry = Math.min(10_000, this.retry * 2);
    };
  };
  getStrokes(): Stroke[] {
    const strokes = new Map(this.doc.getMap<Stroke>('strokes').entries());
    const deleted = this.doc.getMap<boolean>('deleted');
    for (const operation of this.pending.values()) {
      if (operation.type === 'commit' && !deleted.has(operation.stroke.id)) strokes.set(operation.stroke.id, operation.stroke);
      if (operation.type === 'delete') strokes.delete(operation.strokeId);
    }
    return [...strokes.values()];
  }
  getPreviews() { return [...this.previews.values()].filter(p => !this.doc.getMap('strokes').has(p.stroke.id) && !this.doc.getMap('deleted').has(p.stroke.id)); }
  private persistQueue() {
    try { sessionStorage.setItem(this.queueKey, JSON.stringify([...this.pending.values()])); }
    catch { this.publish({ error: '本地存储空间不足，请保持页面打开并导出副本' }); }
  }
  private mutate(operation: Mutation) {
    if (this.credentials.role !== 'editor' || this.state.connection === 'denied') return;
    this.pending.set(operation.mutationId, operation); this.persistQueue(); this.publish(); this.redraw();
    this.flush();
  }
  commit(stroke: Stroke) { this.mutate({ type: 'commit', stroke: { ...stroke, points: [...stroke.points] }, mutationId: newId() }); }
  erase(strokeId: string) { this.mutate({ type: 'delete', strokeId, mutationId: newId() }); }
  private flush() {
    if (this.state.connection !== 'online' || this.credentials.role !== 'editor') return;
    for (const operation of this.pending.values()) {
      if (this.inFlight.size >= 4) break;
      if (this.inFlight.has(operation.mutationId)) continue;
      this.inFlight.add(operation.mutationId); this.send(operation);
    }
  }
  retrySave = () => { this.inFlight.clear(); this.flush(); };
  presence(cursor: Member['cursor']) {
    if (this.state.connection !== 'online' || (cursor && performance.now() - this.lastPresence < 40)) return;
    this.lastPresence = performance.now(); this.send({ type: 'presence', cursor });
  }
  preview(stroke: Stroke | null) {
    if (this.state.connection !== 'online' || this.credentials.role !== 'editor') return;
    if (stroke && performance.now() - this.lastPreview < 45) return;
    this.lastPreview = performance.now(); this.send({ type: 'preview', stroke, seq: this.seq++ });
  }
  close() {
    this.stopped = true; clearTimeout(this.timer); clearInterval(this.sweep);
    window.removeEventListener('offline', this.offline); window.removeEventListener('online', this.online);
    this.socket?.close(); this.doc.destroy(); this.canvasListeners.clear(); this.uiListeners.clear();
  }
}

export function roomLink(credentials: Credentials, viewer = false) {
  const url = new URL('/', location.origin);
  url.searchParams.set('room', credentials.roomId);
  if (viewer) url.searchParams.set('mode', 'tv');
  url.hash = new URLSearchParams({ token: viewer ? credentials.viewerToken ?? credentials.token : credentials.token }).toString();
  return url.toString();
}
