import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { OBJECT_LIMITS, type TextObject } from '@whiteboard/board-core';
import { BoardSession } from '../session';

export function ObjectEditor({ session, object, onClose, onSaved }: { session: BoardSession; object: TextObject; onClose: () => void; onSaved: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(object.text), [removed, setRemoved] = useState(false);
  const existing = useRef(session.getObjects().some(o => o.id === object.id)).current;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const blocked = removed || state.connection === 'denied';
  useEffect(() => {
    dialog.current?.showModal(); input.current?.focus();
    const check = () => setRemoved(existing && !session.getObjects().some(o => o.id === object.id));
    const unsubscribe = session.subscribeCanvas(check); check();
    return () => { unsubscribe(); session.previewObject(null); };
  }, [session, object.id, existing]);
  useEffect(() => {
    if (blocked) { session.previewObject(null); return; }
    const preview = () => {
      const latest = session.getObjects().find(o => o.id === object.id) ?? object;
      if (latest.kind !== 'image') session.previewObject({ ...latest, text });
    };
    const timeout = setTimeout(preview, 100), heartbeat = setInterval(preview, 2000);
    return () => { clearTimeout(timeout); clearInterval(heartbeat); };
  }, [text, session, object, blocked]);
  function save() {
    if (!text.trim() || blocked) return;
    if (existing) session.updateObject(object.id, { text });
    else session.createObject({ ...object, text });
    session.previewObject(null); onSaved(object.id);
  }
  return <dialog ref={dialog} className="invite-dialog object-editor" aria-labelledby="object-editor-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <button className="icon-button close-dialog" aria-label="取消编辑" onClick={onClose}><X size={20}/></button>
    <h2 id="object-editor-title">{existing ? '编辑' : '添加'}{object.kind === 'note' ? '便签' : '文字'}</h2>
    <p>支持多行中文输入，伙伴可以实时看到你的输入过程。</p>
    <label className="sr-only" htmlFor="object-text">内容</label>
    <textarea ref={input} id="object-text" value={text} maxLength={OBJECT_LIMITS.text} placeholder={object.kind === 'note' ? '记下一个想法…' : '输入文字…'} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); save(); } }}/>
    <div className="editor-meta"><span>{blocked ? removed ? '对象已被其他成员删除，可复制内容后关闭' : '会话不可用，可复制内容后关闭' : '换行用 Enter · 完成后保存'} </span><span>{text.length}/{OBJECT_LIMITS.text}</span></div>
    <div className="editor-actions"><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!text.trim() || blocked} onClick={save}>保存内容</button></div>
  </dialog>;
}
