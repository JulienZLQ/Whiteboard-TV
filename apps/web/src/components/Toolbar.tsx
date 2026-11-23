import { Hand, Pencil, Highlighter, Eraser, MousePointer2, Type, StickyNote, ImagePlus } from 'lucide-react';
import { COLORS } from '@whiteboard/board-core';
import type { Tool } from '../canvas/engine';

const tools = [{ id: 'select', label: '选择对象', icon: MousePointer2 }, { id: 'text', label: '添加文字', icon: Type }, { id: 'note', label: '添加便签', icon: StickyNote, ImagePlus }, { id: 'hand', label: '移动画布', icon: Hand }, { id: 'pen', label: '画笔', icon: Pencil }, { id: 'marker', label: '荧光笔', icon: Highlighter }, { id: 'eraser', label: '擦除整条笔迹', icon: Eraser }] as const;
export function Toolbar({ tool, color, onTool, onColor, onImage, uploading }: { tool: Tool; color: string; onTool: (tool: Tool) => void; onColor: (color: string) => void; onImage: () => void; uploading: boolean }) {
  return <div className="toolbar panel" role="toolbar" aria-label="白板工具">
    <div className="tools">{tools.map(({ id, label, icon: Icon }) => <button key={id} className={`icon-button ${tool === id ? 'selected' : ''}`} aria-label={label} title={label} aria-pressed={tool === id} onClick={() => onTool(id)}><Icon size={23}/></button>)}<button className="icon-button" aria-label="添加图片" title="添加图片" disabled={uploading} onClick={onImage}><ImagePlus size={23}/></button></div>
    <span className="divider"/>
    <div className="colors">{COLORS.map((value, i) => <button key={value} className={`color-button ${color === value ? 'active' : ''}`} style={{ '--swatch': value } as React.CSSProperties} aria-label={['蓝色', '紫色', '橙色'][i]} aria-pressed={color === value} onClick={() => onColor(value)}/>)}</div>
  </div>;
}
