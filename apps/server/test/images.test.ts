import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pngSize, ImageStore } from '../src/images';
import { png } from './image-fixture';

test('image decoder boundary rejects damaged data, oversized rasters and non-PNG payloads', () => {
  assert.deepEqual(pngSize(png()), { width: 32, height: 24 });
  assert.throws(() => pngSize(Buffer.from('<svg onload="alert(1)"/>')));
  assert.throws(() => pngSize(png(1281, 1)));
  assert.throws(() => pngSize(png().subarray(0, -5)));
  const damaged = png(); damaged[45] ^= 1; assert.throws(() => pngSize(damaged));
  assert.throws(() => pngSize(Buffer.alloc(1024 * 1024 + 1)));
});
test('room asset quota deduplicates bytes and survives ImageStore restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whiteboard-images-'));
  try {
    const store = new ImageStore(directory), room = 'a'.repeat(24);
    const first = await store.put(room, png());
    for (let i = 0; i < 19; i++) await store.put(room, png(32, 24, i));
    assert.deepEqual(await store.put(room, png()), first);
    await assert.rejects(() => store.put(room, png(32, 24, 100)), /20/);
    assert.deepEqual(await new ImageStore(directory).get(room, first.assetId), png());
    assert.equal(await store.exists('b'.repeat(24), first.assetId), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
