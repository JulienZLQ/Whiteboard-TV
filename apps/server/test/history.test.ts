import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { applyHistory, recordHistory, historyState } from '../src/history';
import type { BoardObject } from '@whiteboard/board-core';

test('history guards new connector references and never deletes peer work; new edit clears redo', () => {
  const doc = new Y.Doc();
  const edit = (who: string, id: string, change: (next: Y.Doc) => void) => {
    const next = new Y.Doc(); Y.applyUpdate(next, Y.encodeStateAsUpdate(doc)); change(next);
    recordHistory(doc, next, who, id); Y.applyUpdate(doc, Y.encodeStateAsUpdate(next)); next.destroy();
  };
  edit('a', 'create-a', d => d.getMap<BoardObject>('objects').set('shape-one', { id: 'shape-one', kind: 'shape', shape: 'rectangle', x: 0, y: 0, width: 100, height: 100, color: '#315EFB' }));
  edit('b', 'connect-b', d => d.getMap<BoardObject>('objects').set('line-two', { id: 'line-two', kind: 'connector', x: 50, y: 50, dx: 100, dy: 100, fromId: 'shape-one', toId: null, arrow: true, color: '#315EFB' }));
  assert.match(applyHistory(doc, 'a', 'undo')!, /已跳过/);
  assert.equal(doc.getMap('objects').size, 2);
  assert.equal(applyHistory(doc, 'b', 'undo'), undefined);
  assert.equal(historyState(doc, 'b').redo, 1);
  edit('b', 'new-b', d => d.getMap('strokes').set('stroke-new', { id: 'stroke-new', kind: 'pen', width: 3, points: [0,0], color: '#315EFB' }));
  assert.equal(historyState(doc, 'b').redo, 0); doc.destroy();
});
