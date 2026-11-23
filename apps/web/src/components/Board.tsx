import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Monitor, UserPlus, Minus, Plus, Scan, Download, RefreshCw, WifiOff } from 'lucide-react';
import { androidTV } from '../tv';
import { COLORS, type Camera } from '@whiteboard/board-core';
import { BoardEngine, type Tool } from '../canvas/engine';
import { BoardSession, roomLink } from '../session';
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
  const [focus, setFocus] = useState('');
  const [manage, setManage] = useState(false);
  const [invite, setInvite] = useState(false), [empty, setEmpty] = useState(true);
  useEffect(() => {
    const instance = new BoardEngine(container.current!, session, viewer, setCamera); engine.current = instance;
    const check = () => setEmpty(session.getStrokes().length === 0 && session.getPreviews().length === 0);
    const unsubscribe = session.subscribeCanvas(check); check();
    return () => { unsubscribe(); instance.destroy(); engine.current = null; };
  }, [session, viewer]);
  useEffect(() => { if (engine.current) { engine.current.tool = tool; engine.current.color = color; } }, [tool, color, viewer]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || invite || manage) return;
      if (event.key.toLowerCase() === 'f') engine.current?.fit();
      if (event.key.toLowerCase() === 'p' && !viewer) setTool('pen');
      if (event.key.toLowerCase() === 'h' && !viewer) setTool('hand');
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [viewer, invite, manage]);
  useEffect(() => { if (focus && !state.members.some(m => m.id === focus)) { setFocus(''); engine.current?.focus(''); } }, [focus, state.members]);
  function exportCopy() {
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, roomId: session.credentials.roomId, strokes: session.getStrokes() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'whiteboard-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const status = state.connection === 'denied' ? '无法连接' : state.connection === 'offline' ? '连接中断' : state.connection === 'connecting' ? '正在连接' : '实时连接';
  return <main className={`board ${viewer ? 'tv-mode' : ''}`}>
    <div ref={container} className="canvas" data-testid="canvas" aria-label={viewer ? '电视白板总览' : '白板绘图区'} style={{ cursor: viewer ? 'default' : tool === 'hand' ? 'grab' : 'crosshair' }}/>
    <header className="brand panel"><div className="brand-mark" aria-hidden="true">W</div><div><h1>共创白板</h1><p>{viewer ? '电视总览 · 全部内容' : '每个人的想法，都在这里'}</p></div></header>
    <div className="collaboration panel">
      <div className="avatars" aria-label={`${state.members.length} 台设备在线`}>{state.members.slice(0, 3).map(member => <span key={member.id} title={`${member.name}${member.role === 'viewer' ? ' · 观看' : ''}`} style={{ backgroundColor: member.color }}>{member.role === 'viewer' ? <Monitor size={17}/> : member.name.slice(0, 1)}</span>)}</div>
      <span className={`connection ${state.connection}`} role="status"><i/>{status}</span>
      <span className="header-divider"/>
      {!viewer && state.connection === 'online' ? <a className="secondary tv-link" href={roomLink(session.credentials, true)} target="_blank" rel="noreferrer"><Monitor size={19}/><span>电视视图</span></a> : null}
      {state.host ? <button className="secondary manage-button" onClick={() => setManage(true)}>管理</button> : null}
      <button disabled={state.connection !== 'online' || !state.access || state.access.paused || state.access.ended} className="primary invite-button" onClick={() => setInvite(true)}><UserPlus size={19}/><span>{state.access?.paused ? '加入已暂停' : '邀请加入'}</span></button>
    </div>
    {viewer && state.access && state.connection === 'online' ? <TVJoinCard access={state.access} credentials={session.credentials}/> : null}
    {empty ? <div className="empty-state"><PencilMark/><h2>{viewer ? '等待第一个想法' : '从一笔开始'}</h2><p>{viewer ? '编辑端的每一笔，都会出现在这里' : '自由书写，或邀请伙伴一起创作'}</p><span>{viewer ? '画面自动适配全部内容' : '双指移动与缩放 · 每个人都有独立视角'}</span></div> : null}
    {!viewer ? <Toolbar tool={tool} color={color} onTool={setTool} onColor={setColor}/> : null}
    <footer className="save-status panel" aria-live="polite">{state.connection !== 'online' ? <WifiOff size={18}/> : <Check size={18}/>}<span>{state.pending ? `${state.pending} 项待保存` : state.connection === 'online' ? '已保存' : '等待连接'}</span>{!androidTV() ? <button className="icon-button export" aria-label="导出本地副本" title="导出本地副本" onClick={exportCopy}><Download size={17}/></button> : null}</footer>
    <div className="zoom-controls panel" aria-label="画布视角">
      {!viewer ? <button className="icon-button" aria-label="缩小" onClick={() => engine.current?.zoom(0.8)}><Minus size={20}/></button> : null}
      {viewer ? <select aria-label="电视关注成员" value={focus} onChange={event => { setFocus(event.target.value); engine.current?.focus(event.target.value); }}><option value="">完整画布</option>{state.members.filter(m => m.role === 'editor').map(m => <option key={m.id} value={m.id}>关注 {m.name}</option>)}</select> : null}
      <span>{viewer ? focus ? '关注中' : '总览' : `${Math.round(camera.zoom * 100)}%`}</span>
      {!viewer ? <button className="icon-button" aria-label="放大" onClick={() => engine.current?.zoom(1.25)}><Plus size={20}/></button> : null}
      <span className="zoom-divider"/><button className="icon-button" aria-label="适配全部内容" title="适配全部内容 (F)" onClick={() => { setFocus(''); engine.current?.fit(); }}><Scan size={21}/></button>
    </div>
    {state.error ? <div className="error-banner" role="alert"><span>{state.error}</span>{state.pending && state.connection === 'online' ? <button onClick={session.retrySave}><RefreshCw size={16}/>重试保存</button> : null}</div> : null}
    {manage ? <RoomControls session={session} state={state} onClose={() => setManage(false)}/> : null}
    {invite && state.access && !state.access.paused && !state.access.ended ? <InviteDialog url={roomLink({ ...session.credentials, token: state.access.inviteToken })} viewer={false} onClose={() => setInvite(false)}/> : null}
  </main>;
}
function PencilMark() { return <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M9 34c8-18 16-25 18-20 2 5-18 23-10 22 6-1 13-13 16-10 3 3-2 7 5 6" stroke="#315EFB" strokeWidth="3" strokeLinecap="round"/></svg>; }
