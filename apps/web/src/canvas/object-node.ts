import Konva from 'konva';
import { resolveObject, objectLayout, type BoardObject } from '@whiteboard/board-core';
export function objectNode(object: BoardObject, objects: BoardObject[], imageFor: (id: string) => HTMLImageElement | null, draft = false) {
    object = resolveObject(object, objects);
    const layout = objectLayout(object), node = new Konva.Group({ x: object.x, y: object.y, opacity: draft ? .82 : 1 });
    if (object.kind === 'shape') {
      const common = { stroke: object.color, strokeWidth: 3, fill: object.color + '12' };
      if (object.shape === 'ellipse') node.add(new Konva.Ellipse({ ...common, x: object.width / 2, y: object.height / 2, radiusX: object.width / 2, radiusY: object.height / 2 }));
      else node.add(new Konva.Rect({ ...common, width: object.width, height: object.height, cornerRadius: 12 }));
      return node;
    }
    if (object.kind === 'connector') {
      const attrs = { points: [0, 0, object.dx, object.dy], stroke: object.color, fill: object.color, strokeWidth: 3, lineCap: 'round' as const, lineJoin: 'round' as const };
      node.add(object.arrow ? new Konva.Arrow({ ...attrs, pointerLength: 14, pointerWidth: 12 }) : new Konva.Line(attrs));
      return node;
    }
    if (object.kind === 'image') {
      const image = imageFor(object.assetId);
      node.add(new Konva.Rect({ width: layout.width, height: layout.height, fill: '#e9edf5', stroke: '#d0d8e7', strokeWidth: 1 }));
      if (image) node.add(new Konva.Image({ image, width: layout.width, height: layout.height }));
      else node.add(new Konva.Text({ x: 12, y: 12, text: '图片加载中…', fontSize: 16, fill: '#667085' }));
      return node;
    }
    if (object.kind === 'note') {
      node.add(new Konva.Rect({ width: layout.width, height: layout.height, fill: '#FFF1AD', cornerRadius: 6, shadowColor: '#493d13', shadowOpacity: .12, shadowBlur: 10, shadowOffsetY: 4 }));
      node.add(new Konva.Rect({ width: layout.width, height: 6, fill: '#E9CF6D', cornerRadius: [6, 6, 0, 0] }));
    }
    node.add(new Konva.Text({ x: 24, y: 24, width: 272, text: layout.lines.join('\n'), fontSize: 24, lineHeight: 34 / 24, wrap: 'none', fontFamily: 'monospace', fill: object.kind === 'note' ? '#3B3525' : object.color }));
    return node;
  }
