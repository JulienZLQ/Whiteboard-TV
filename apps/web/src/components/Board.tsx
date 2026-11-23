import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Monitor, UserPlus, Minus, Plus, Scan, Download, RefreshCw, WifiOff } from 'lucide-react';
import { androidTV } from '../tv';
import { COLORS, type Camera, type TextObject } from '@whiteboard/board-core';
import { BoardEngine, type Tool } from '../canvas/engine';
import { BoardSession, roomLink } from '../session';
import { imageBlob, imagePath, prepareImage } from '../images';
import { ObjectEditor } from './ObjectEditor';
import { Toolbar } from './Toolbar';
import { TVJoinCard } from './TVJoinCard';
import { RoomControls } from './RoomControls';
import { InviteDialog } from './InviteDialog';

export function Board({ session }: { session: BoardSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const viewer = session.credentials.role === 'viewer';
  const container = useRef<HTMLDivElement>(null), engine = useRef<BoardEngine | null>(null);
  const [tool, setTool] = useState<Tool>('pen'), [color, setColor] = useState<string>(COLORS[0]);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<TextObject | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false), [imageError, setImageError] = useState(''), [joinHidden, setJoinHidden] = useState(false);
  const [focus, setFocus] = useState('');
  const [viewMode, setViewMode] = useState<'canvas' | 'content'>('canvas');
  const [manage, setManage] = useState(false);
  const [invite, setInvite] = useState(false), [empty, setEmpty] = useState(true);
  useEffect(() => {
    const instance = new BoardEngine(container.current!, session, viewer, setCamera, setSelected, setEditing); engine.current = instance;
    const check = () => setEmpty(session.getStrokes().length === 0 && session.getPreviews().length === 0 && session.getObjects().length === 0 && session.getObjectPreviews().length === 0);
    const unsubscribe = session.subscribeCanvas(check); check();
    return () => { unsubscribe(); instance.destroy(); engine.current = null; };
  }, [session, viewer]);
  useEffect(() => { if (engine.current) { engine.current.tool = tool; engine.current.color = color; } }, [tool, color, viewer]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || invite || manage || editing) return;
      if (event.key.toLowerCase() === 'f') { setFocus(''); setViewMode('content'); engine.current?.fit(); }
      if (event.key.toLowerCase() === 'p' && !viewer) setTool('pen');
      if (event.key.toLowerCase() === 'h' && !viewer) setTool('hand');
      if (event.key.toLowerCase() === 'v' && !viewer) setTool('select');
      if (event.key === 'Escape') engine.current?.select('');
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !viewer) { event.preventDefault(); session.deleteObject(selected); engine.current?.select(''); }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [viewer, invite, manage, editing, selected, session]);
  useEffect(() => { if (focus && !state.members.some(m => m.id === focus)) { setFocus(''); engine.current?.focus(''); } }, [focus, state.members]);
  async function addImage(file: File) {
    setUploading(true); setImageError('');
    try {
      if (session.getSnapshot().connection !== 'online') throw new Error('连接恢复后即可上传图片');
      const blob = await prepareImage(file);
      const response = await fetch(imagePath(session.credentials), { method: 'POST', headers: { Authorization: 'Bearer ' + session.credentials.token, 'X-Whiteboard-Client': '1', 'Content-Type': 'image/png' }, body: blob });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || (response.status === 403 ? '当前会话无法上传图片' : '图片上传失败，请重试')); }
      const asset = await response.json();
      if (session.getSnapshot().connection === 'denied') throw new Error('会话已失效');
      engine.current?.placeImage(asset); setTool('select');
    } catch (error) { setImageError(error instanceof Error ? error.message : '图片上传失败'); }
    finally { setUploading(false); }
  }
  async function exportCopy() {
    try {
    const objects = session.getObjects(), strokes = session.getStrokes();
    const ids = [...new Set(objects.flatMap(o => o.kind === 'image' ? [o.assetId] : []))];
    const assets: Record<string, string> = {};
    // Sequential reads keep the memory peak bounded on phones; never silently omit image bytes.
    for (const id of ids) { const blob = await imageBlob(session.credentials, id); assets[id] = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); }); }
    const blob = new Blob([JSON.stringify({ schemaVersion: ids.length ? 3 : 2, roomId: session.credentials.roomId, strokes, objects, ...(ids.length ? { assets } : {}) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'whiteboard-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setImageError('完整副本导出失败，请连接服务后重试（包含图片原件）'); }
  }
  const selectedObject = session.getObjects().find(o => o.id === selected);
  const joinVisible = viewer && !joinHidden && !!state.access && state.connection === 'online';
  useEffect(() => { engine.current?.setJoinVisible(joinVisible); }, [joinVisible]);
  const status = state.connection === 'denied' ? '无法连接' : state.connection === 'offline' ? '连接中断' : state.connection === 'connecting' ? '正在连接' : '实时连接';
  return <main className={`board ${viewer ? 'tv-mode' : ''}`}>
    <div ref={container} className="canvas" data-testid="canvas" aria-label={viewer ? '电视白板总览' : '白板绘图区'} style={{ cursor: viewer ? 'default' : tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair' }}/>
    <header className="brand panel"><div className="brand-mark" aria-hidden="true">W</div><div><h1>共创白板</h1><p>{viewer ? focus ? '电视视图 · 关注成员' : viewMode === 'canvas' ? '电视视图 · 完整画布' : '电视视图 · 全部内容' : '每个人的想法，都在这里'}</p></div></header>
    <div className="collaboration panel">
      <div className="avatars" aria-label={`${state.members.length} 台设备在线`}>{state.members.slice(0, 3).map(member => <span key={member.id} title={`${member.name}${member.role === 'viewer' ? ' · 观看' : ''}`} style={{ backgroundColor: member.color }}>{member.role === 'viewer' ? <Monitor size={17}/> : member.name.slice(0, 1)}</span>)}</div>
      <span className={`connection ${state.connection}`} role="status"><i/>{status}</span>
      <span className="header-divider"/>
      {!viewer && state.connection === 'online' ? <a aria-label="电视视图" className="secondary tv-link" href={roomLink(session.credentials, true)} target="_blank" rel="noreferrer"><Monitor size={19}/><span>电视视图</span></a> : null}
      {state.host ? <button className="secondary manage-button" onClick={() => setManage(true)}>管理</button> : null}
      <button disabled={state.connection !== 'online' || !state.access || state.access.paused || state.access.ended} className="primary invite-button" onClick={() => setInvite(true)}><UserPlus size={19}/><span>{state.access?.paused ? '加入已暂停' : '邀请加入'}</span></button>
    </div>
    {viewer && state.access && state.connection === 'online' ? <TVJoinCard access={state.access} credentials={session.credentials} hidden={joinHidden} onToggle={() => setJoinHidden(!joinHidden)}/> : null}
    {empty ? <div className="empty-state"><PencilMark/><h2>{viewer ? '等待第一个想法' : '从一笔开始'}</h2><p>{viewer ? '编辑端的每一笔，都会出现在这里' : '写下文字、贴一张便签，或自由书写'}</p><span>{viewer ? '画面自动适配全部内容' : '双指移动与缩放 · 每个人都有独立视角'}</span></div> : null}
    {!viewer ? <Toolbar tool={tool} color={color} onTool={value => { setTool(value); if (value !== 'select') engine.current?.select(''); }} onColor={setColor} onImage={() => fileInput.current?.click()} uploading={uploading || state.connection !== 'online'}/> : null}
    <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} aria-label="选择图片文件" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addImage(file); }}/>
    {!viewer && selected && !editing ? <div className="object-actions panel" aria-label="已选对象操作"><span>已选对象</span>{selectedObject?.kind === 'image' ? <><button className="secondary" aria-label="缩小图片" onClick={() => engine.current?.scaleSelected(.8)}>缩小</button><button className="secondary" aria-label="放大图片" onClick={() => engine.current?.scaleSelected(1.25)}>放大</button></> : <button className="secondary" onClick={() => { const object = session.getObjects().find(o => o.id === selected); if (object && object.kind !== 'image') setEditing(object); }}>编辑内容</button>}<button className="danger" onClick={() => { session.deleteObject(selected); engine.current?.select(''); }}>删除对象</button></div> : null}
    {!viewer && (tool === 'text' || tool === 'note') && !editing ? <div className="tool-hint" role="status">点击画布放置{tool === 'note' ? '便签' : '文字'}</div> : null}
    {editing ? <ObjectEditor session={session} object={editing} onClose={() => setEditing(null)} onSaved={id => { setEditing(null); setTool('select'); engine.current?.select(id); }}/> : null}
    <footer className="save-status panel" aria-live="polite">{state.connection !== 'online' ? <WifiOff size={18}/> : <Check size={18}/>}<span>{state.pending ? `${state.pending} 项待保存` : state.connection === 'online' ? '已保存' : '等待连接'}</span>{!androidTV() ? <button className="icon-button export" aria-label="导出本地副本" title="导出本地副本" onClick={exportCopy}><Download size={17}/></button> : null}</footer>
    <div className="zoom-controls panel" aria-label="画布视角">
      {viewer ? <button className="secondary view-button" aria-pressed={!focus && viewMode === 'canvas'} onClick={() => { setFocus(''); setViewMode('canvas'); engine.current?.showCanvas(); }}>完整画布</button> : null}
      {!viewer ? <button className="icon-button" aria-label="缩小" onClick={() => engine.current?.zoom(0.8)}><Minus size={20}/></button> : null}
      {viewer ? <select aria-label="电视关注成员" value={focus} onChange={event => { setFocus(event.target.value); engine.current?.focus(event.target.value); }}><option value="">关注成员</option>{state.members.filter(m => m.role === 'editor').map(m => <option key={m.id} value={m.id}>关注 {m.name}</option>)}</select> : null}
      {!viewer ? <span>{`${Math.round(camera.zoom * 100)}%`}</span> : null}
      {!viewer ? <button className="icon-button" aria-label="放大" onClick={() => engine.current?.zoom(1.25)}><Plus size={20}/></button> : null}
      <span className="zoom-divider"/><button className={viewer ? "secondary view-button" : "icon-button"} aria-pressed={viewer ? !focus && viewMode === 'content' : undefined} aria-label="显示全部内容" title="显示全部内容 (F)" onClick={() => { setFocus(''); setViewMode('content'); engine.current?.fit(); }}>{viewer ? '显示全部内容' : <Scan size={21}/>}</button>
    </div>
    {uploading ? <div className="tool-hint" role="status">正在压缩并上传图片…</div> : null}
    {imageError ? <div className="image-notice panel" role="alert"><span>{imageError}</span><button className="secondary" onClick={() => setImageError('')}>关闭</button></div> : null}
    {state.error ? <div className="error-banner" role="alert"><span>{state.error}</span>{state.pending && state.connection === 'online' ? <button onClick={session.retrySave}><RefreshCw size={16}/>重试保存</button> : null}</div> : null}
    {manage ? <RoomControls session={session} state={state} onClose={() => setManage(false)}/> : null}
    {invite && state.access && !state.access.paused && !state.access.ended ? <InviteDialog url={roomLink({ ...session.credentials, token: state.access.inviteToken })} viewer={false} onClose={() => setInvite(false)}/> : null}
  </main>;
}
function PencilMark() { return <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M9 34c8-18 16-25 18-20 2 5-18 23-10 22 6-1 13-13 16-10 3 3-2 7 5 6" stroke="#315EFB" strokeWidth="3" strokeLinecap="round"/></svg>; }
