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
