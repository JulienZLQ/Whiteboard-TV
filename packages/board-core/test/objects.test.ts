import test from 'node:test';
import assert from 'node:assert/strict';
import { validObject, validObjectPatch, objectLayout, contentBounds, type BoardObject } from '../src/index';
const object: BoardObject = { id: 'note-0001', kind: 'note', x: -100, y: 200, text: '中文与多行\n一起写', color: '#315EFB' };
test('object validation rejects unsafe coordinates, unsupported fields and overlong input', () => {
  assert.ok(validObject(object));
  assert.equal(validObject({ ...object, text: 'a'.repeat(501) }), false);
  assert.equal(validObject({ ...object, x: Infinity }), false);
  assert.equal(validObjectPatch({ text: '新内容' }), true);
  assert.equal(validObjectPatch({ x: 10, y: 20 }), true);
  assert.equal(validObjectPatch({ x: 10 }), false);
  assert.equal(validObjectPatch({ text: '新内容', kind: 'note' }), false);
  assert.equal(validObjectPatch({ text: '新内容', x: 10, y: 20 }), false);
});
test('text wrapping preserves newlines and emoji, and complete object bounds enter TV overview', () => {
  const layout = objectLayout({ ...object, text: '思考🧠'.repeat(20) + '\n第二行' });
  assert.equal(layout.lines.join('').replaceAll('第二行', ''), '思考🧠'.repeat(20));
  assert.ok(layout.height > 200);
  assert.deepEqual(contentBounds([], [object]), { left: -100, top: 200, right: 220, bottom: 400 });
});

test('image objects use bounded geometry and cannot carry arbitrary external URLs', () => {
  const image = { id: 'image-0001', kind: 'image' as const, assetId: 'a'.repeat(64), x: -300, y: 10, width: 600, height: 400 };
  assert.ok(validObject(image)); assert.ok(validObjectPatch({ width: 300, height: 200 }));
  assert.equal(validObject({ ...image, assetId: 'https://example.com/image.png' }), false);
  assert.equal(validObject({ ...image, width: 4001 }), false);
  assert.equal(validObject({ ...image, height: 0 }), false);
  assert.equal(validObjectPatch({ width: 300 }), false);
  assert.deepEqual(contentBounds([], [image]), { left: -300, top: 10, right: 300, bottom: 410 });
});

test('default canvas retains blank space and grows by whole tiles around outlying content', async () => {
  const { canvasBounds, DEFAULT_CANVAS } = await import('../src/index');
  const small = contentBounds([], [{ ...object, x: 400, y: 200 }]);
  assert.deepEqual(canvasBounds(small), DEFAULT_CANVAS);
  assert.notDeepEqual(canvasBounds(small), small);
  const outside = contentBounds([], [{ ...object, x: -200, y: 900 }]);
  const frame = canvasBounds(outside);
  assert.ok(frame.left <= outside!.left && frame.bottom >= outside!.bottom);
  assert.ok(frame.right >= DEFAULT_CANVAS.right && frame.top <= DEFAULT_CANVAS.top);
});

test('shapes and connectors validate dimensions, endpoint geometry and kind-specific patches', async () => {
  const { patchObject } = await import('../src/index');
  const shape = { id: 'shape-0001', kind: 'shape' as const, shape: 'rectangle' as const, x: 0, y: 0, width: 200, height: 100, color: '#315EFB' };
  const link = { id: 'connector-01', kind: 'connector' as const, x: 100, y: 50, dx: -200, dy: 0, fromId: null, toId: null, arrow: true, color: '#315EFB' };
  assert.ok(validObject(shape)); assert.ok(validObject(link));
  assert.equal(validObject({ ...shape, width: 0 }), false);
  assert.equal(validObject({ ...link, dx: Infinity }), false);
  assert.equal(validObject({ ...link, fromId: shape.id, toId: shape.id }), false);
  assert.equal(validObject({ ...link, x: 100000, dx: 20 }), false);
  assert.equal(patchObject(shape, { text: 'wrong kind' }), null);
  assert.equal(patchObject(link, { x: 20, y: 30 }), null);
  assert.equal(validObjectPatch({ x: 0, y: 0, dx: 20, dy: 40, fromId: null, toId: null }), true);
});

test('connections follow rectangle and ellipse boundaries, negative directions and preview targets', async () => {
  const { resolveObject, hitObject } = await import('../src/index');
  const a = { id: 'shape-0001', kind: 'shape' as const, shape: 'rectangle' as const, x: 0, y: 0, width: 200, height: 100, color: '#315EFB' };
  const b = { ...a, id: 'shape-0002', shape: 'ellipse' as const, x: 400 };
  const link = { id: 'connector-01', kind: 'connector' as const, x: 100, y: 50, dx: 400, dy: 0, fromId: a.id, toId: b.id, arrow: true, color: '#315EFB' };
  assert.deepEqual(resolveObject(link, [a, b]), { ...link, x: 200, y: 50, dx: 200, dy: 0 });
  assert.deepEqual(resolveObject(link, [a, { ...b, x: 600 }]), { ...link, x: 200, y: 50, dx: 400, dy: 0 });
  assert.equal(hitObject({ ...link, fromId: null, toId: null, x: 400, dx: -200 }, { x: 300, y: 54 }), true);
  assert.equal(hitObject({ ...link, dx: 200, dy: 200 }, { x: 100, y: 200 }), false);
  assert.equal(hitObject(b, { x: 400, y: 0 }, 0), false);
  const bounds = contentBounds([], [a, b, link])!;
  assert.ok(bounds.left <= 0 && bounds.right >= 600);
});
