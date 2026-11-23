import QRCode from 'qrcode';
import { canvasBounds, DEFAULT_CANVAS, contentBounds, fitCamera, objectLayout, type AccessState, type BoardObject, type BoardSnapshot, type Credentials, type Member, type Camera, type Point, type ServerMessage, type Stroke } from '@whiteboard/board-core';
import './legacy-tv.css';
import { ImageCache } from './images';

// A dedicated read-only receiver avoids loading the modern editor/Yjs runtime on old TV WebViews.
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = get<HTMLCanvasElement>('board'), ctx = canvas.getContext('2d')!;
const create = get<HTMLButtonElement>('create'), claim = get<HTMLButtonElement>('claim');
let credentials: Credentials | null = null, socket: WebSocket | null = null, access: AccessState | undefined;
let snapshot: BoardSnapshot = { strokes: [], objects: [] }, members: Member[] = [];
const previews = new Map<string, { stroke: Stroke; time: number }>(), objectPreviews = new Map<string, { object: BoardObject; time: number }>();
let viewMode: 'canvas' | 'content' = 'canvas';
let camera: Camera | null = null, lastFrame = 0;
let frame = 0, retryTimer = 0, retry = 500, stopped = false, connected = false, claimMode = false, qrKey = '', qrVersion = 0;
let qrHidden = false, focusedMember = '';
let focusedPoint: Point | null = null;
const focusButton = get<HTMLButtonElement>('focus');
const images = new ImageCache(() => credentials!, schedule);
const room = new URL(location.href).searchParams.get('room');
try {
  const saved = JSON.parse(localStorage.getItem('whiteboard.tv.last') || 'null') as Credentials | null;
  if (room && saved?.roomId === room && saved.role === 'viewer' && /^[a-f0-9]{64}$/.test(saved.token)) credentials = saved;
} catch { /* New room can still be created. */ }
function persist() {
  if (!credentials) return;
  try { localStorage.setItem('whiteboard.tv.last', JSON.stringify(credentials)); } catch { /* Keep live access. */ }
  history.replaceState(null, '', '/legacy-tv.html?room=' + credentials.roomId + '&mode=tv&tvShell=android');
}
function status(text: string, online = false) {
  get('status').textContent = text; get('status-dot').style.background = online ? '#2abc79' : '#e9a23b';
  get('saved').textContent = online ? '实时同步' : text;
}
function showBoard() { get('welcome').hidden = true; get('footer').hidden = false; get('canvas-view').focus(); schedule(); }
function updateQR() {
  const available = connected && access && !access.paused && !access.ended && Date.now() < access.expiresAt;
  get('join').hidden = !credentials;
  const image = get<HTMLImageElement>('qr');
  claim.hidden = !connected || !access?.claimToken;
  if (!available) {
    image.hidden = true; qrKey = ''; qrVersion++;
    get('qr-hint').textContent = access?.ended ? '本次会话已结束' : connected ? '加入已暂停或邀请已过期' : '连接恢复后显示二维码';
    return;
  }
  if (!access!.claimToken) claimMode = false;
  const token = claimMode ? access!.claimToken! : access!.inviteToken;
  const url = location.origin + '/?room=' + credentials!.roomId + '#token=' + token;
  get('qr-title').textContent = claimMode ? '手机认领主持权限' : '扫码，一起写';
  get('qr-hint').textContent = claimMode ? '请由主持人扫描此二维码' : '手机 / Pad 独立编辑';
  claim.textContent = claimMode ? '返回编辑二维码' : '手机管理';
  image.alt = claimMode ? '手机主持认领二维码' : '电视编辑加入二维码';
  if (url === qrKey) { image.hidden = false; return; }
  qrKey = url; image.hidden = true; const version = ++qrVersion;
  QRCode.toDataURL(url, { width: 200, margin: 2 }).then(value => {
    if (version !== qrVersion) return;
    image.src = value; image.hidden = false;
  }).catch(() => { qrKey = ''; get('qr-hint').textContent = '二维码生成失败，稍后自动重试'; });
}
function receive(message: ServerMessage) {
  if (message.type === 'ready') {
    if (!message.snapshot) { status('服务需要升级'); stopped = true; socket?.close(); return; }
    connected = true; retry = 500; snapshot = message.snapshot; members = message.members; access = message.access;
    credentials!.token = message.token || credentials!.token; credentials!.role = 'viewer'; persist(); status('实时连接', true); updateQR();
  } else if (message.type === 'snapshot') snapshot = message;
  else if (message.type === 'members') members = message.members;
  else if (message.type === 'presence') { const i = members.findIndex(m => m.id === message.member.id); if (i >= 0) members[i] = message.member; }
  else if (message.type === 'preview') { if (message.stroke) previews.set(message.memberId, { stroke: message.stroke, time: Date.now() }); else previews.delete(message.memberId); }
  else if (message.type === 'object-preview') { if (message.object) objectPreviews.set(message.memberId, { object: message.object, time: Date.now() }); else objectPreviews.delete(message.memberId); }
  else if (message.type === 'access') { access = message.access; updateQR(); }
  else if (message.type === 'error') status(message.message);
  if (focusedMember && !members.some(m => m.id === focusedMember)) focusedMember = '';
  updateViewControls();
  schedule();
}
function connect() {
  if (!credentials || stopped) return;
  clearTimeout(retryTimer); status('正在连接');
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws'); socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId: credentials!.roomId, token: credentials!.token, name: '电视', viewOnly: true, legacyTV: true }));
  ws.onmessage = event => { if (socket !== ws) return; try { receive(JSON.parse(event.data)); } catch { status('同步消息异常，请重新加载'); } };
  ws.onclose = event => {
    if (socket !== ws) return;
    connected = false; previews.clear(); objectPreviews.clear(); members = []; focusedMember = ''; focusedPoint = null; updateViewControls(); schedule();
    if (event.code === 1008) { stopped = true; status(access?.ended ? '会话已结束，请在电视菜单新建白板' : '房间不可用，请在电视菜单新建白板'); }
    else if (!stopped) { status('连接中断，正在重连'); retryTimer = window.setTimeout(connect, retry); retry = Math.min(retry * 2, 10000); }
    updateQR();
  };
}
create.onclick = async () => {
  create.disabled = true; get('error').textContent = '';
  try {
    const response = await fetch('/api/rooms?mode=tv', { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } });
    if (!response.ok) throw new Error();
    credentials = await response.json(); persist(); showBoard(); connect();
  } catch { get('error').textContent = '创建失败，请检查服务后重试'; create.disabled = false; create.focus(); }
};
claim.onclick = () => { claimMode = !claimMode; updateQR(); };
get('toggle-qr').onclick = () => {
  qrHidden = !qrHidden; get('qr-content').setAttribute('aria-hidden', String(qrHidden));
  get('join').className = qrHidden ? 'collapsed' : '';
  get('toggle-qr').textContent = qrHidden ? '显示加入二维码' : '收起二维码';
  get('toggle-qr').setAttribute('aria-expanded', String(!qrHidden)); schedule();
};
function updateViewControls() {
  focusButton.textContent = focusedMember ? '关注 ' + members.find(m => m.id === focusedMember)!.name : '关注成员';
  focusButton.setAttribute('aria-pressed', String(!!focusedMember));
  get('canvas-view').setAttribute('aria-pressed', String(!focusedMember && viewMode === 'canvas'));
  get('fit').setAttribute('aria-pressed', String(!focusedMember && viewMode === 'content'));
  get('view-label').textContent = focusedMember ? '电视视图 · 关注成员' : viewMode === 'canvas' ? '电视视图 · 完整画布' : '电视视图 · 全部内容';
}
focusButton.onclick = () => {
  const options = [''].concat(members.filter(m => m.role === 'editor').map(m => m.id));
  focusedPoint = null; focusedMember = options[(options.indexOf(focusedMember) + 1) % options.length]; updateViewControls(); schedule();
};
get('canvas-view').onclick = () => { viewMode = 'canvas'; focusedMember = ''; focusedPoint = null; updateViewControls(); schedule(); };
get('fit').onclick = () => { viewMode = 'content'; focusedMember = ''; focusedPoint = null; updateViewControls(); schedule(); };

function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
function stroke(s: Stroke) {
  ctx.globalAlpha = s.kind === 'marker' ? .3 : 1; ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(s.points[0], s.points[1]);
  if (s.points.length === 2) ctx.lineTo(s.points[0] + .01, s.points[1] + .01);
  for (let i = 2; i < s.points.length; i += 2) ctx.lineTo(s.points[i], s.points[i + 1]);
  ctx.stroke(); ctx.globalAlpha = 1;
}
function object(o: BoardObject) {
  const layout = objectLayout(o);
  if (o.kind === 'image') {
    const image = images.get(o.assetId); ctx.fillStyle = '#e9edf5'; ctx.fillRect(o.x, o.y, o.width, o.height);
    if (image) ctx.drawImage(image, o.x, o.y, o.width, o.height);
    else { ctx.font = '16px sans-serif'; ctx.fillStyle = '#667085'; ctx.fillText('图片加载中…', o.x + 12, o.y + 24); }
    return;
  }
  if (o.kind === 'note') { ctx.fillStyle = '#FFF1AD'; ctx.fillRect(o.x, o.y, layout.width, layout.height); ctx.fillStyle = '#E9CF6D'; ctx.fillRect(o.x, o.y, layout.width, 6); }
  ctx.font = '24px monospace'; ctx.textBaseline = 'top'; ctx.fillStyle = o.kind === 'note' ? '#3B3525' : o.color;
  layout.lines.forEach((line, i) => ctx.fillText(line, o.x + 24, o.y + 24 + i * 34));
}
function paint() {
  frame = 0;
  const width = innerWidth, height = innerHeight, ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; }
  const active = Array.from(previews.values()).map(p => p.stroke).filter(s => !(snapshot.deletedStrokeIds || []).includes(s.id)), activeObjects = Array.from(objectPreviews.values()).map(p => p.object).filter(o => !(snapshot.deletedObjectIds || []).includes(o.id));
  const bounds = contentBounds(snapshot.strokes.concat(active), snapshot.objects.concat(activeObjects));
  const b = viewMode === 'canvas' ? canvasBounds(bounds) : bounds ?? DEFAULT_CANVAS;
  const target = fitCamera([{ id: 'overview', points: [b.left, b.top, b.right, b.bottom], width: 1, color: '#000000', kind: 'pen' }], { width: Math.max(100, width - (qrHidden ? 0 : 290)), height: Math.max(100, height - 180) }, 32);
  target.y += 110;
  const focused = members.find(m => m.id === focusedMember);
  if (focused?.cursor) focusedPoint = focused.cursor;
  if (!focused) focusedPoint = null;
  const cursor = focusedPoint;
  if (cursor) { target.zoom = 1; target.x = (width - (qrHidden ? 0 : 290)) / 2 - cursor.x; target.y = height / 2 - cursor.y; }
  const now = performance.now(), alpha = 1 - Math.exp(-Math.min(48, now - lastFrame) / 90); lastFrame = now;
  const moving = !!camera && (Math.abs(camera.x - target.x) > .1 || Math.abs(camera.y - target.y) > .1 || Math.abs(camera.zoom - target.zoom) > .0001);
  canvas.dataset.cameraMoving = String(moving);
  if (camera && moving && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    camera = { x: camera.x + (target.x - camera.x) * alpha, y: camera.y + (target.y - camera.y) * alpha, zoom: camera.zoom + (target.zoom - camera.zoom) * alpha }; schedule();
  } else camera = target;
  const viewCamera = camera;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.translate(viewCamera.x, viewCamera.y); ctx.scale(viewCamera.zoom, viewCamera.zoom);
  const previewIds = new Set(activeObjects.map(o => o.id));
  snapshot.objects.filter(o => !previewIds.has(o.id)).forEach(object);
  const savedIds = new Set(snapshot.strokes.map(s => s.id));
  snapshot.strokes.forEach(stroke); active.filter(s => !savedIds.has(s.id)).forEach(stroke); activeObjects.forEach(object);
  ctx.restore();
  members.forEach(member => {
    if (!member.cursor) return;
    const x = member.cursor.x * viewCamera.zoom + viewCamera.x, y = member.cursor.y * viewCamera.zoom + viewCamera.y;
    ctx.fillStyle = member.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 9, y + 24); ctx.lineTo(x + 13, y + 14); ctx.lineTo(x + 24, y + 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = '18px sans-serif'; const w = ctx.measureText(member.name).width + 18; ctx.fillRect(x + 18, y + 26, w, 32); ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.fillText(member.name, x + 27, y + 32);
  });
  get('empty').hidden = !credentials || snapshot.strokes.length + snapshot.objects.length + active.length + activeObjects.length > 0;
  canvas.dataset.viewMode = focusedMember ? 'member' : viewMode; canvas.dataset.viewWidth = String(width - (qrHidden ? 0 : 290)); canvas.dataset.camera = JSON.stringify(viewCamera); canvas.dataset.joinVisible = String(!qrHidden); canvas.dataset.focusedMember = focusedMember; canvas.dataset.loadedImageCount = String(images.loaded);
  canvas.dataset.strokeCount = String(snapshot.strokes.length); canvas.dataset.objectCount = String(snapshot.objects.length);
  canvas.dataset.previewCount = String(active.length); canvas.dataset.objectPreviewCount = String(activeObjects.length);
  canvas.dataset.cursorCount = String(members.filter(m => m.cursor).length);
}
setInterval(() => {
  const now = Date.now(); let changed = false;
  previews.forEach((p, id) => { if (now - p.time > 5000) { previews.delete(id); changed = true; } });
  objectPreviews.forEach((p, id) => { if (now - p.time > 5000) { objectPreviews.delete(id); changed = true; } });
  if (changed) schedule(); updateQR();
}, 1000);
window.addEventListener('resize', schedule);
window.WhiteboardTV = {
  key(key: string) {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(b => !b.disabled && b.getClientRects().length > 0 && !b.closest('[aria-hidden="true"]'));
    if (!buttons.length) return false;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (key === 'Enter') { if (index < 0) buttons[0].focus(); else buttons[index].click(); return true; }
    const direction = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
    if (!direction) return false;
    buttons[(index + direction + buttons.length) % buttons.length].focus(); return true;
  },
  back() { if (claimMode) { claimMode = false; updateQR(); return true; } return false; },
};
window.addEventListener('keydown', e => { if (window.WhiteboardTV!.key(e.key)) e.preventDefault(); });
if (credentials) { showBoard(); connect(); } else create.focus();
schedule();
