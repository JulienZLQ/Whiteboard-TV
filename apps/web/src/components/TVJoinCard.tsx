import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { AccessState, Credentials } from '@whiteboard/board-core';
import { roomLink } from '../session';

export function TVJoinCard({ access, credentials, hidden, onToggle }: { access: AccessState; credentials: Credentials; hidden: boolean; onToggle: () => void }) {
  const [qr, setQr] = useState(''), [now, setNow] = useState(Date.now());
  const url = roomLink({ ...credentials, token: access.inviteToken });
  useEffect(() => { let active = true; setQr(''); QRCode.toDataURL(url, { width: 180, margin: 2 }).then(value => { if (active) setQr(value); }).catch(() => {}); return () => { active = false; }; }, [url]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const unavailable = access.paused || access.ended || now >= access.expiresAt;
  return <aside className={`tv-join ${hidden ? 'collapsed' : ''}`} aria-label="扫码加入白板">
    <div id="tv-qr-content" className="tv-qr-content panel" aria-hidden={hidden}>
      <strong>扫码，一起写</strong>
      {unavailable ? <p>加入已暂停或邀请已过期</p> : qr ? <img width={180} height={180} src={qr} alt="电视编辑加入二维码"/> : <p>二维码准备中…</p>}
    </div>
    <button data-tv-row="join" className="secondary qr-toggle" aria-controls="tv-qr-content" aria-expanded={!hidden} onClick={onToggle}>{hidden ? '显示加入二维码' : '收起二维码'}</button>
  </aside>;
}
