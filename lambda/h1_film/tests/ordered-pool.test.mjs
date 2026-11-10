import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedPool} from '../runtime/ordered-pool.mjs';

test('bounds active tasks and preserves input order', async () => {
  let active = 0, peak = 0;
  const result = await orderedPool([30, 5, 1, 2], 2, async (delay, index) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, delay));
    --active;
    return index;
  });
  assert.deepEqual(result, [0, 1, 2, 3]);
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('failure stops scheduling and drains active work', async () => {
  const failure = new Error('conversion failed');
  const started = [];
  let drained = false;
  await assert.rejects(orderedPool([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (value === 0) throw failure;
    await new Promise(resolve => setTimeout(resolve, 10));
    drained = true;
  }), error => error === failure);
  assert.deepEqual(started, [0, 1]);
  assert.equal(drained, true);
});

test('rejects invalid concurrency even for empty input', async () => {
  for (const value of [0, -1, 1.5, NaN, 17]) {
    await assert.rejects(orderedPool([], value, () => {}));
  }
  assert.deepEqual(await orderedPool([], 1, () => {}), []);
});
