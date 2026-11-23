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
