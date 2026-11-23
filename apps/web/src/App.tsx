import { lazy, Suspense, useEffect, useState } from 'react';
import { Pencil, Monitor } from 'lucide-react';
import type { Credentials } from '@whiteboard/board-core';
import { BoardSession } from './session';
const Board = lazy(() => import('./components/Board').then(module => ({ default: module.Board })));

function invitation(): Credentials | null {
  const url = new URL(location.href), roomId = url.searchParams.get('room');
  if (!roomId) return null;
  const role = url.searchParams.get('mode') === 'tv' ? 'viewer' : 'editor';
  const key = `whiteboard.credentials.${roomId}.${role}`;
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  if (token) {
    const credentials: Credentials = { roomId, token, role };
    try { sessionStorage.setItem(key, JSON.stringify(credentials)); } catch { /* Private mode */ }
    url.hash = ''; history.replaceState(null, '', url);
    return credentials;
  }
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; }
}
export default function App() {
  const [credentials] = useState(invitation), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [session, setSession] = useState<BoardSession | null>(null);
  const hasRoom = new URL(location.href).searchParams.has('room');
  useEffect(() => { if (!session) return; session.connect(); return () => session.close(); }, [session]);
  async function enter(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      let next = credentials;
      if (!next) {
        if (hasRoom) throw new Error('邀请凭证缺失，请重新打开完整的邀请链接');
        const response = await fetch('/api/rooms', { method: 'POST', headers: { 'X-Whiteboard-Client': '1' } });
        if (!response.ok) throw new Error('暂时无法创建白板，请检查服务连接');
        next = await response.json() as Credentials;
        sessionStorage.setItem(`whiteboard.credentials.${next.roomId}.editor`, JSON.stringify(next));
        history.replaceState(null, '', `/?room=${next.roomId}`);
      }
      setSession(new BoardSession(next, next.role === 'viewer' ? '电视' : name.trim() || '访客'));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  if (session) return <Suspense fallback={<main className="welcome">正在打开白板…</main>}><Board session={session}/></Suspense>;
  const viewer = credentials?.role === 'viewer';
  return <main className="welcome">
    <div className="welcome-brand"><span className="brand-mark">W</span><span>共创白板</span></div>
    <form className="welcome-form" onSubmit={enter}>
      <div className="welcome-symbol">{viewer ? <Monitor size={32}/> : <Pencil size={32}/>}</div>
      <h1>{viewer ? '让想法一起上屏' : credentials ? '加入这场共创' : '好想法，写在一起'}</h1>
      <p>{viewer ? '完整展示画布，实时看见每个人的创作' : '手机、Pad 与电视，共享一块白板'}</p>
      {!viewer ? <label>你的称呼<input value={name} onChange={event => setName(event.target.value)} placeholder="怎么称呼你？" maxLength={20} autoComplete="nickname" autoFocus/></label> : null}
      <button className="primary" disabled={busy} type="submit">{busy ? '正在准备白板…' : viewer ? '打开电视总览' : credentials ? '加入白板' : '创建白板'}</button>
      <span className="welcome-hint">{viewer ? '电视视图仅用于观看' : '各自自由操作，内容实时同步'}</span>
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </form>
    <p className="welcome-footnote">Whiteboard TV · M1 协作实验版</p>
  </main>;
}
