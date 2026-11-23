import Konva from 'konva';
import { canvasBounds, contentBounds, DEFAULT_CANVAS, type Stroke, type BoardObject, type Credentials } from '@whiteboard/board-core';
import { imageBlob } from '../images';
import { objectNode } from './object-node';

// Snapshot rendering excludes selection, collaborators, transient previews and all application chrome.
export async function exportPNG(strokes: Stroke[], objects: BoardObject[], credentials: Credentials, mode: 'canvas' | 'content'): Promise<Blob> {
  const content = contentBounds(strokes, objects), bounds = mode === 'canvas' ? canvasBounds(content) : content ?? DEFAULT_CANVAS;
  const width = Math.max(1, bounds.right - bounds.left), height = Math.max(1, bounds.bottom - bounds.top);
  const scale = Math.min(2, 4096 / Math.max(width, height), Math.sqrt(8_000_000 / (width * height)));
  const urls: string[] = [], images = new Map<string, HTMLImageElement>();
  const container = document.createElement('div'); let stage: Konva.Stage | undefined;
  try {
    for (const id of new Set(objects.flatMap(o => o.kind === 'image' ? [o.assetId] : []))) {
      const url = URL.createObjectURL(await imageBlob(credentials, id)); urls.push(url);
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = url; }); images.set(id, image);
    }
    await document.fonts.ready;
    stage = new Konva.Stage({ container, width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)) });
    const layer = new Konva.Layer({ listening: false }); stage.add(layer);
    layer.add(new Konva.Rect({ width: stage.width(), height: stage.height(), fill: '#ffffff' }));
    const group = new Konva.Group({ x: -bounds.left * scale, y: -bounds.top * scale, scaleX: scale, scaleY: scale }); layer.add(group);
    for (const object of objects) group.add(objectNode(object, objects, id => images.get(id) ?? null));
    for (const stroke of strokes) group.add(new Konva.Line({ points: stroke.points.length === 2 ? [...stroke.points, stroke.points[0] + .01, stroke.points[1] + .01] : stroke.points, stroke: stroke.color, strokeWidth: stroke.width, lineCap: 'round', lineJoin: 'round', opacity: stroke.kind === 'marker' ? .3 : 1 }));
    layer.draw();
    const blob = await stage.toBlob({ pixelRatio: 1, mimeType: 'image/png' });
    if (!blob) throw new Error('图片生成失败'); return blob;
  } finally { stage?.destroy(); container.remove(); urls.forEach(url => URL.revokeObjectURL(url)); }
}
