import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ImageDown, Undo2, Redo2, Check, Monitor, UserPlus, Minus, Plus, Scan, Download, RefreshCw, WifiOff } from 'lucide-react';
import { openTVMenu } from '../tv-menu';
import { androidTV } from '../tv';
import { COLORS, isTextObject, isResizable, type Camera, type TextObject } from '@whiteboard/board-core';
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
  const [exporting, setExporting] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const [tool, setTool] = useState<Tool>('pen'), [color, setColor] = useState<string>(COLORS[0]);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<TextObject | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false), [imageError, setImageError] = useState(''), [joinHidden, setJoinHidden] = useState(false);
  const [focus, setFocus] = useState('');
  const [uiHidden, setUIHidden] = useState(false);
  const [viewMode, setViewMode] = useState<'canvas' | 'content'>('canvas');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [invite, setInvite] = useState(false), [empty, setEmpty] = useState(true);
  useEffect(() => {
    const instance = new BoardEngine(container.current!, session, viewer, setCamera, setSelected, setEditing, setTool); engine.current = instance;
    const check = () => setEmpty(session.getStrokes().length === 0 && session.getPreviews().length === 0 && session.getObjects().length === 0 && session.getObjectPreviews().length === 0);
    const unsubscribe = session.subscribeCanvas(check); check();
    return () => { unsubscribe(); instance.destroy(); engine.current = null; };
  }, [session, viewer]);
  useEffect(() => { if (engine.current) { engine.current.tool = tool; engine.current.color = color; } }, [tool, color, viewer]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || invite || manage || editing) return;
      if (!viewer && (event.ctrlKey || event.metaKey)) {
        const key = event.key.toLowerCase();
        if (key === 'z' || key === 'y') { event.preventDefault(); session.history(key === 'y' || event.shiftKey ? 'redo' : 'undo'); }
        return;
      }
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
    const blob = new Blob([JSON.stringify({ schemaVersion: objects.some(o => o.kind === 'shape' || o.kind === 'connector') ? 4 : ids.length ? 3 : 2, roomId: session.credentials.roomId, strokes, objects, ...(ids.length ? { assets } : {}) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'whiteboard-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setImageError('完整副本导出失败，请连接服务后重试（包含图片原件）'); }
  }
  async function exportPNG(mode: 'canvas' | 'content') {
    setExporting(true); setImageError('');
    try {
      const { exportPNG } = await import('../canvas/export');
      const blob = await exportPNG(session.getStrokes(), session.getObjects(), session.credentials, mode);
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `whiteboard-${mode}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setExportOpen(false);
    } catch { setImageError('图片导出失败，请检查连接后重试；不会导出缺少图片的版本'); }
    finally { setExporting(false); }
  }
  const selectedObject = session.getObjects().find(o => o.id === selected);
  const joinVisible = viewer && !uiHidden && !joinHidden && !!state.access && state.connection === 'online';
  useEffect(() => { engine.current?.setJoinVisible(joinVisible); }, [joinVisible]);
  useEffect(() => {
    document.documentElement.classList.toggle('tv-ui-hidden', viewer && uiHidden);
    engine.current?.refreshTVLayout();
    return () => { document.documentElement.classList.remove('tv-ui-hidden'); };
  }, [viewer, uiHidden]);
  const chooseView = (value: 'canvas' | 'content') => { setFocus(''); setViewMode(value); if (value === 'canvas') engine.current?.showCanvas(); else engine.current?.fit(); };
  const status = state.connection === 'denied' ? '无法连接' : state.connection === 'offline' ? '连接中断' : state.connection === 'connecting' ? '正在连接' : '实时连接';
  return <main className={`board ${viewer ? 'tv-mode' : ''}`}>
    <div ref={container} className="canvas" data-testid="canvas" aria-label={viewer ? '电视白板总览' : '白板绘图区'} style={{ cursor: viewer ? 'default' : tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair' }}/>
    <header className="brand panel"><div className="brand-mark" aria-hidden="true">W</div><div><h1>共创白板</h1>{!viewer ? <p>每个人的想法，都在这里</p> : null}</div></header>
    <div className={viewer ? "collaboration tv-header" : "collaboration panel"}>
      {!viewer ? <div className="avatars" aria-label={`${state.members.length} 台设备在线`}>{state.members.slice(0, 3).map(member => <span key={member.id} title={`${member.name}${member.role === 'viewer' ? ' · 观看' : ''}`} style={{ backgroundColor: member.color }}>{member.role === 'viewer' ? <Monitor size={17}/> : member.name.slice(0, 1)}</span>)}</div> : null}
      {viewer ? <span className="tv-sync tv-header-item" role="status">{state.connection === 'online' ? '实时同步' : '等待同步'}</span> : null}
      <span className={`connection ${state.connection} ${viewer ? 'tv-header-item' : ''}`} role="status"><i/><span title={status}>{status}</span></span>
      {!viewer ? <span className="header-divider"/> : null}
      {!viewer && state.connection === 'online' ? <a aria-label="电视视图" className="secondary tv-link" href={roomLink(session.credentials, true)} target="_blank" rel="noreferrer"><Monitor size={19}/><span>电视视图</span></a> : null}
      {!viewer && state.host ? <button className="secondary manage-button" onClick={() => setManage(true)}>管理</button> : null}
      {viewer ? <><button data-tv-row="header" className="secondary tv-header-item" onClick={() => setManage(true)}>管理成员</button><button data-tv-row="header" className="secondary tv-header-item" onClick={openTVMenu}>设置</button></> : null}
      {!viewer ? <button disabled={state.connection !== 'online' || !state.access || state.access.paused || state.access.ended} className="primary invite-button" onClick={() => setInvite(true)}><UserPlus size={19}/><span>{state.access?.paused ? '加入已暂停' : '邀请加入'}</span></button> : null}
    </div>
    {viewer && state.access && state.connection === 'online' ? <TVJoinCard access={state.access} credentials={session.credentials} hidden={joinHidden} onToggle={() => setJoinHidden(!joinHidden)}/> : null}
    {empty ? <div className="empty-state"><PencilMark/><h2>{viewer ? '等待第一个想法' : '从一笔开始'}</h2><p>{viewer ? '编辑端的每一笔，都会出现在这里' : '写下文字、贴一张便签，或自由书写'}</p><span>{viewer ? '默认展示完整画布' : '双指移动与缩放 · 每个人都有独立视角'}</span></div> : null}
    {!viewer ? <Toolbar onPaletteChange={setPaletteOpen} tool={tool} color={color} onTool={value => { setTool(value); if (value !== 'select') engine.current?.select(''); }} onColor={setColor} onImage={() => fileInput.current?.click()} uploading={uploading || state.connection !== 'online'}/> : null}
    <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} aria-label="选择图片文件" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addImage(file); }}/>
    {!viewer && !paletteOpen && selected && !editing ? <div className="object-actions panel" aria-label="已选对象操作"><span>已选对象</span>{selectedObject && isResizable(selectedObject) ? <><button className="secondary" aria-label={selectedObject.kind === 'image' ? '缩小图片' : '缩小形状'} onClick={() => engine.current?.scaleSelected(.8)}>缩小</button><button className="secondary" aria-label={selectedObject.kind === 'image' ? '放大图片' : '放大形状'} onClick={() => engine.current?.scaleSelected(1.25)}>放大</button></> : selectedObject && isTextObject(selectedObject) ? <button className="secondary" onClick={() => { const object = session.getObjects().find(o => o.id === selected); if (object && isTextObject(object)) setEditing(object); }}>编辑内容</button> : null}<button className="danger" onClick={() => { session.deleteObject(selected); engine.current?.select(''); }}>删除对象</button></div> : null}
    {!viewer && !paletteOpen && (tool === 'text' || tool === 'note') && !editing ? <div className="tool-hint" role="status">点击画布放置{tool === 'note' ? '便签' : '文字'}</div> : null}
    {!viewer && !paletteOpen && ['rectangle', 'ellipse', 'arrow', 'line'].includes(tool) ? <div className="tool-hint" role="status">{tool === 'rectangle' || tool === 'ellipse' ? '拖动画布绘制形状' : '拖动连接两个对象，或在空白处绘制'}</div> : null}
    {!viewer && !paletteOpen && selectedObject?.kind === 'connector' ? <div className="tool-hint" role="status">拖动端点重新连接 · 拖动线条自由移动</div> : null}
    {editing ? <ObjectEditor session={session} object={editing} onClose={() => setEditing(null)} onSaved={id => { setEditing(null); setTool('select'); engine.current?.select(id); }}/> : null}
    {!viewer ? <div className="history-controls panel" aria-label="操作历史"><button className="icon-button" aria-label="撤销" title="撤销 (Ctrl/⌘ Z)" disabled={!state.undo || !!state.pending || state.connection !== 'online'} onClick={() => session.history('undo')}><Undo2 size={20}/></button><button className="icon-button" aria-label="重做" title="重做 (Ctrl/⌘ Shift Z)" disabled={!state.redo || !!state.pending || state.connection !== 'online'} onClick={() => session.history('redo')}><Redo2 size={20}/></button></div> : null}
    {state.notice ? <div className="history-notice panel" role="status"><span>{state.notice}</span><button className="secondary" onClick={session.dismissNotice}>知道了</button></div> : null}
    {exportOpen ? <div className="export-menu panel" role="group" aria-label="导出白板"><strong>导出 PNG 图片</strong><button className="secondary" disabled={exporting} onClick={() => void exportPNG('canvas')}>导出完整画布</button><button className="secondary" disabled={exporting} onClick={() => void exportPNG('content')}>导出全部内容</button><small>{exporting ? '正在生成图片…' : '白色背景 · 最长边 4096 像素'}</small><button className="secondary" disabled={exporting} onClick={() => setExportOpen(false)}>关闭导出</button></div> : null}
    {!viewer ? <footer className="save-status panel" aria-live="polite">{state.connection !== 'online' ? <WifiOff size={18}/> : <Check size={18}/>}<span>{state.pending ? `${state.pending} 项待保存` : state.connection === 'online' ? '已保存' : '等待连接'}</span>{!androidTV() ? <button className="icon-button export" aria-label="导出本地副本" title="导出本地副本" onClick={exportCopy}><Download size={17}/></button> : null}{!androidTV() ? <button className="secondary png-export" aria-label="导出图片" title="导出图片" aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}><ImageDown size={17}/><span>导出图片</span></button> : null}</footer> : <button className="tv-visibility-toggle panel secondary" data-tv-row="visibility" aria-pressed={uiHidden} onClick={() => setUIHidden(!uiHidden)}>{uiHidden ? '显示界面' : '隐藏界面'}</button>}
    <div className="zoom-controls panel" aria-label="画布视角" data-tv-view={viewer ? viewMode : undefined} data-tv-following={viewer ? !!focus : undefined}>
      {viewer ? <button data-tv-row="view" className="secondary view-button" aria-pressed={!focus && viewMode === 'canvas'} onFocus={() => chooseView('canvas')} onClick={() => chooseView('canvas')}>完整画布</button> : null}
      {!viewer ? <button className="icon-button" aria-label="缩小" onClick={() => engine.current?.zoom(0.8)}><Minus size={20}/></button> : null}

      {!viewer ? <span>{`${Math.round(camera.zoom * 100)}%`}</span> : null}
      {!viewer ? <button className="icon-button" aria-label="放大" onClick={() => engine.current?.zoom(1.25)}><Plus size={20}/></button> : null}
      {!viewer ? <span className="zoom-divider"/> : null}<button data-tv-row={viewer ? "view" : undefined} className={viewer ? "secondary view-button" : "icon-button"} aria-pressed={viewer ? !focus && viewMode === 'content' : undefined} aria-label="显示全部内容" title="显示全部内容 (F)" onFocus={viewer ? () => chooseView('content') : undefined} onClick={() => chooseView('content')}>{viewer ? '显示全部内容' : <Scan size={21}/>}</button>
    </div>
    {uploading ? <div className="tool-hint" role="status">正在压缩并上传图片…</div> : null}
    {imageError ? <div className="image-notice panel" role="alert"><span>{imageError}</span><button className="secondary" onClick={() => setImageError('')}>关闭</button></div> : null}
    {state.error ? <div className="error-banner" role="alert"><span>{state.error}</span>{state.pending && state.connection === 'online' ? <button onClick={session.retrySave}><RefreshCw size={16}/>重试保存</button> : null}</div> : null}
    {manage ? <RoomControls focus={focus} onFocus={id => { setFocus(id); engine.current?.focus(id); setManage(false); }} session={session} state={state} onClose={() => setManage(false)}/> : null}
    {invite && state.access && !state.access.paused && !state.access.ended ? <InviteDialog url={roomLink({ ...session.credentials, token: state.access.inviteToken })} viewer={false} onClose={() => setInvite(false)}/> : null}
  </main>;
}
function PencilMark() { return <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M9 34c8-18 16-25 18-20 2 5-18 23-10 22 6-1 13-13 16-10 3 3-2 7 5 6" stroke="#315EFB" strokeWidth="3" strokeLinecap="round"/></svg>; }
