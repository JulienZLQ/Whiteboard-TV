import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { BoardSession, roomLink, type SessionState } from '../session';
import { InviteDialog } from './InviteDialog';

export function RoomControls({ session, state, onClose }: { session: BoardSession; state: SessionState; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [claim, setClaim] = useState(false), [ending, setEnding] = useState(false);
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  const access = state.access;
  const disabled = state.connection !== 'online' || access?.ended;
  return <dialog ref={dialog} className="invite-dialog room-controls" onCancel={onClose}>
    <button className="icon-button close-dialog" aria-label="关闭管理" onClick={onClose}><X size={22}/></button>
    <h2>会话管理</h2><p>控制加入方式，管理当前共创成员</p>
    <div className="management-actions">
      <button disabled={disabled} className="secondary" onClick={() => session.manage(access?.paused ? 'resume' : 'pause')}>{access?.paused ? '恢复加入' : '暂停加入'}</button>
      <button disabled={disabled} className="secondary" onClick={() => session.manage('rotate')}>更新邀请二维码</button>
      {access?.claimToken ? <button disabled={disabled || access.paused} className="secondary" onClick={() => setClaim(true)}>手机认领主持权限</button> : null}
    </div>
    <p className="subtle">邀请有效期 12 小时。更新后旧二维码失效，已加入成员不受影响。</p>
    <ul className="member-list">{state.members.map(member => <li key={member.id}><span><i style={{ background: member.color }}/>{member.name}<small>{member.host ? '主持人' : member.role === 'viewer' ? '观看中' : '编辑中'}</small></span>{!member.host && member.role === 'editor' ? <button disabled={disabled} className="secondary" onClick={() => session.manage('remove', member.id)}>移除</button> : null}</li>)}</ul>
    {ending ? <div className="end-confirm"><p>结束后所有设备将断开，旧邀请无法再次加入。白板快照仍保留。</p><button className="danger" disabled={disabled} onClick={() => session.manage('end')}>确认结束会话</button><button className="secondary" onClick={() => setEnding(false)}>取消</button></div> : <button disabled={disabled} className="danger" onClick={() => setEnding(true)}>结束会话</button>}
    {claim && access?.claimToken && !access.paused && !access.ended ? <InviteDialog url={roomLink({ ...session.credentials, token: access.claimToken })} viewer={false} hostClaim onClose={() => setClaim(false)}/> : null}
  </dialog>;
}
