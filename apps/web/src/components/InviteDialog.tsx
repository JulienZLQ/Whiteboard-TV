import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, X } from 'lucide-react';

export function InviteDialog({ url, viewer, onClose }: { url: string; viewer: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [qr, setQr] = useState(''), [copied, setCopied] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const el = dialog.current!; el.showModal();
    QRCode.toDataURL(url, { width: 256, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#172033', light: '#ffffff' } }).then(setQr).catch(() => setError('二维码生成失败，请复制链接'));
    return () => el.close();
  }, [url]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { input.current?.select(); setError('请长按或使用复制快捷键复制链接'); }
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  return <dialog className="invite-dialog" ref={dialog} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="icon-button close-dialog" aria-label="关闭邀请" onClick={onClose}><X size={22}/></button>
    <h2>{viewer ? '邀请大家观看' : '一起写下好想法'}</h2>
    <p>{viewer ? '扫码查看这块白板' : '手机或 Pad 扫码，即可独立编辑'}</p>
    {qr ? <img src={qr} width={256} height={256} alt={viewer ? '白板观看二维码' : '白板编辑二维码'}/> : <div className="qr-loading">正在生成二维码…</div>}
    {loopback ? <p className="notice">当前是本机地址，手机暂时无法访问。跨设备试用需使用同一网络可访问的服务地址。</p> : <p className="subtle">请确保设备能访问此服务地址</p>}
    <label className="sr-only" htmlFor="invite-link">邀请链接</label><input ref={input} id="invite-link" value={url} readOnly onFocus={event => event.target.select()}/>
    <button className="primary copy-button" onClick={copy}>{copied ? <Check size={18}/> : <Copy size={18}/>} {copied ? '已复制链接' : '复制邀请链接'}</button>
    {error ? <p role="status" className="notice">{error}</p> : null}
  </dialog>;
}
