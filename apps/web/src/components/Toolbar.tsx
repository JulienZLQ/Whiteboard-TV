import { useEffect, useState } from 'react';
import { Shapes, Square, Circle, ArrowUpRight, Minus, X, Hand, Pencil, Highlighter, Eraser, MousePointer2, Type, StickyNote, ImagePlus } from 'lucide-react';
import { COLORS } from '@whiteboard/board-core';
import type { Tool } from '../canvas/engine';

const tools = [{ id: 'select', label: '选择对象', icon: MousePointer2 }, { id: 'text', label: '添加文字', icon: Type }, { id: 'note', label: '添加便签', icon: StickyNote }, { id: 'hand', label: '移动画布', icon: Hand }, { id: 'pen', label: '画笔', icon: Pencil }, { id: 'marker', label: '荧光笔', icon: Highlighter }, { id: 'eraser', label: '擦除整条笔迹', icon: Eraser }] as const;
export function Toolbar({ tool, color, onTool, onColor, onImage, uploading, onPaletteChange }: { tool: Tool; color: string; onTool: (tool: Tool) => void; onColor: (color: string) => void; onImage: () => void; uploading: boolean; onPaletteChange: (open: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const expand = (open: boolean) => { setExpanded(open); onPaletteChange(open); };
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setExpanded(false); onPaletteChange(false); } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onPaletteChange]);
  const shapes = [{ id: 'rectangle', label: '矩形', icon: Square }, { id: 'ellipse', label: '椭圆', icon: Circle }, { id: 'arrow', label: '箭头', icon: ArrowUpRight }, { id: 'line', label: '连线', icon: Minus }] as const;
  return <><div className="toolbar panel" role="toolbar" aria-label="白板工具">
    <div className="tools">{tools.map(({ id, label, icon: Icon }) => <button key={id} className={`icon-button ${tool === id ? 'selected' : ''}`} aria-label={label} title={label} aria-pressed={tool === id} onClick={() => { expand(false); onTool(id); }}><Icon size={23}/></button>)}<button className="icon-button" aria-label="添加图片" title="添加图片" disabled={uploading} onClick={() => { expand(false); onImage(); }}><ImagePlus size={23}/></button></div>
    <span className="divider"/>
    <div className="colors">{COLORS.map((value, i) => <button key={value} className={`color-button ${color === value ? 'active' : ''}`} style={{ '--swatch': value } as React.CSSProperties} aria-label={['蓝色', '紫色', '橙色'][i]} aria-pressed={color === value} onClick={() => onColor(value)}/>)}<button className={`icon-button shape-toggle ${shapes.some(s => s.id === tool) ? 'selected' : ''}`} aria-label="形状与连线" aria-expanded={expanded} aria-controls="shape-tools" onClick={() => expand(!expanded)}><Shapes size={22}/></button></div>
  </div>
  {expanded ? <div id="shape-tools" className="shape-tools panel" role="group" aria-label="选择形状与连线"><div className="shape-title"><strong>形状与连线</strong><button className="icon-button" aria-label="收起形状工具" onClick={() => expand(false)}><X size={18}/></button></div><div className="shape-grid">{shapes.map(({id, label, icon: Icon}) => <button key={id} className={tool === id ? 'active' : ''} aria-pressed={tool === id} onClick={() => { onTool(id); expand(false); }}><Icon size={28}/><span>{label}</span></button>)}</div><p>拖动绘制 · 连线自动吸附对象</p></div> : null}</>;

}
