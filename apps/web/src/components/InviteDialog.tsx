import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, X } from 'lucide-react';

export function InviteDialog({ url, viewer, hostClaim = false, onClose }: { url: string; viewer: boolean; hostClaim?: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [qr, setQr] = useState(''), [copied, setCopied] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const el = dialog.current!; el.showModal();
    if (!url) { setQr(''); return () => el.close(); }
    QRCode.toDataURL(url, { width: 256, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#172033', light: '#ffffff' } }).then(setQr).catch(() => setError('二维码生成失败，请复制链接'));
    return () => el.close();
  }, [url]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { input.current?.select(); setError('请长按或使用复制快捷键复制链接'); }
  }
  const loopback = !url || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  return <dialog className="invite-dialog" ref={dialog} onCancel={event => { event.stopPropagation(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="icon-button close-dialog" aria-label="关闭邀请" onClick={onClose}><X size={22}/></button>
    <h2>{hostClaim ? '认领主持权限' : viewer ? '邀请大家观看' : '一起写下好想法'}</h2>
    <p>{hostClaim ? '仅供主持人扫码，成功认领一次后失效' : viewer ? '扫码查看这块白板' : '手机或 Pad 扫码，即可独立编辑'}</p>
    {!url ? <p>电视连接 Wi-Fi 或网线后即可扫码加入</p> : qr ? <img src={qr} width={256} height={256} alt={viewer ? '白板观看二维码' : '白板编辑二维码'}/> : <div className="qr-loading">正在生成二维码…</div>}
    {loopback ? <p className="notice">当前是本机地址，手机暂时无法访问。跨设备试用需使用同一网络可访问的服务地址。</p> : <p className="subtle">请确保设备能访问此服务地址</p>}
    <label className="sr-only" htmlFor="invite-link">邀请链接</label><input ref={input} id="invite-link" value={url} readOnly onFocus={event => event.target.select()}/>
    <button className="primary copy-button" onClick={copy}>{copied ? <Check size={18}/> : <Copy size={18}/>} {copied ? '已复制链接' : '复制邀请链接'}</button>
    {error ? <p role="status" className="notice">{error}</p> : null}
  </dialog>;
}
