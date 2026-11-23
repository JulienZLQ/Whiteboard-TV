import test from 'node:test';
import assert from 'node:assert/strict';
import { screenToWorld, worldToScreen, zoomAt, fitCamera, strokeBounds, validStroke, type Stroke } from '../src/index';
const stroke: Stroke = { id: 'stroke-0001', points: [-800, -300, 4000, 2000], color: '#315EFB', width: 4, kind: 'pen' };
test('world coordinates round trip for independent cameras', () => {
  for (const camera of [{ x: -1024, y: 400, zoom: 0.1 }, { x: 450, y: -700, zoom: 4 }]) {
    const world = { x: -300, y: 800 };
    assert.deepEqual(screenToWorld(worldToScreen(world, camera), camera), world);
  }
});
test('zoom preserves the world point under its anchor', () => {
  const camera = { x: 30, y: 80, zoom: 1 }, anchor = { x: 400, y: 300 };
  assert.deepEqual(screenToWorld(anchor, zoomAt(camera, anchor, 2)), screenToWorld(anchor, camera));
});
test('TV fit includes all geometry and brush width in portrait and landscape', () => {
  for (const size of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    const camera = fitCamera([stroke], size), bounds = strokeBounds([stroke])!;
    const first = worldToScreen({ x: bounds.left, y: bounds.top }, camera), last = worldToScreen({ x: bounds.right, y: bounds.bottom }, camera);
    assert.ok(first.x >= 0 && first.y >= 0 && last.x <= size.width && last.y <= size.height);
  }
});
test('empty and single-point boards have finite fit transforms', () => {
  for (const strokes of [[], [{ ...stroke, points: [42, 42] }]]) {
    const camera = fitCamera(strokes, { width: 390, height: 844 });
    assert.ok(Object.values(camera).every(Number.isFinite));
  }
});
test('stroke validation rejects oversized, non-finite and malformed geometry', () => {
  assert.equal(validStroke(stroke), true);
  assert.equal(validStroke({ ...stroke, points: [1, 2, 3] }), false);
  assert.equal(validStroke({ ...stroke, points: [NaN, 2] }), false);
  assert.equal(validStroke({ ...stroke, points: [1e6, 2] }), false);
  assert.equal(validStroke({ ...stroke, points: Array(8002).fill(0) }), false);
});
