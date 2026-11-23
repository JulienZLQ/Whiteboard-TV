import { lazy, Suspense, useEffect, useState } from 'react';
import type { Credentials } from '@whiteboard/board-core';
import { androidTV, loadCredentials, saveCredentials, installTVNavigation } from './tv';
import { BoardSession } from './session';
const Board = lazy(() => import('./components/Board').then(module => ({ default: module.Board })));

function invitation(): Credentials | null {
  const url = new URL(location.href), roomId = url.searchParams.get('room');
  if (!roomId) return null;
  const role = url.searchParams.get('mode') === 'tv' ? 'viewer' : 'editor';
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  if (token) {
    const credentials: Credentials = { roomId, token, role };
    saveCredentials(credentials);
    url.hash = ''; history.replaceState(null, '', url);
    return credentials;
  }
  return loadCredentials(roomId, role);
}
export default function App() {
  const [credentials] = useState(invitation), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [session, setSession] = useState<BoardSession | null>(() => androidTV() && credentials?.role === 'viewer' ? new BoardSession(credentials, '电视') : null);
  const [createTv, setCreateTv] = useState(new URL(location.href).searchParams.get('mode') === 'tv');
  useEffect(installTVNavigation, []);
  const hasRoom = new URL(location.href).searchParams.has('room');
  useEffect(() => { if (!session) return; session.connect(); return () => session.close(); }, [session]);
  async function enter(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      let next = credentials;
      if (!next) {
        if (hasRoom) throw new Error('邀请凭证缺失，请重新打开完整的邀请链接');
        const response = await fetch(`/api/rooms${createTv ? '?mode=tv' : ''}`, { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } });
        if (!response.ok) throw new Error('暂时无法创建白板，请检查服务连接');
        next = await response.json() as Credentials;
        saveCredentials(next);
        history.replaceState(null, '', `/?room=${next.roomId}${next.role === 'viewer' ? '&mode=tv' : ''}${androidTV() ? '&tvShell=android' : ''}`);
      }
      setSession(new BoardSession(next, next.role === 'viewer' ? '电视' : name.trim() || '访客'));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  if (session) return <Suspense fallback={<main className="welcome">正在打开白板…</main>}><Board session={session}/></Suspense>;
  const viewer = credentials?.role === 'viewer' || (!hasRoom && createTv);
  return <main className="welcome">
    <div className="welcome-brand"><img className="brand-mark" src="/brand/co-write-icon-v1.svg" alt=""/><span>共创白板</span></div>
    <form className="welcome-form" onSubmit={enter}>
      <img className="welcome-symbol" src="/brand/co-write-icon-v1.svg" alt=""/>
      <h1>{viewer ? '让想法一起上屏' : credentials ? '加入这场共创' : '好想法，写在一起'}</h1>
      <p>{viewer ? '完整展示画布，实时看见每个人的创作' : '手机、Pad 与电视，共享一块白板'}</p>
      {!viewer ? <label>你的称呼<input value={name} onChange={event => setName(event.target.value)} placeholder="怎么称呼你？" maxLength={20} autoComplete="nickname" autoFocus/></label> : null}
      {!hasRoom && !androidTV() ? <label className="tv-choice"><input type="checkbox" checked={createTv} onChange={event => setCreateTv(event.target.checked)}/>在电视上创建，扫码加入编辑</label> : null}
      <button className="primary" disabled={busy} type="submit">{busy ? '正在准备白板…' : viewer ? credentials ? '打开电视总览' : '创建电视白板' : credentials ? '加入白板' : '创建白板'}</button>
      <span className="welcome-hint">{viewer ? androidTV() ? '方向键选择 · 确认键进入 · 返回键确认退出' : '电视视图仅用于观看' : '各自自由操作，内容实时同步'}</span>
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </form>
    <p className="welcome-footnote">共创白板 · 一起写，让想法发生</p>
  </main>;
}
