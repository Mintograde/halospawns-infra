import assert from 'node:assert/strict';

// Drain active work before propagating failure; never publish a partial result.
export async function orderedPool(items, concurrency, task) {
  assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 16,
    'Concurrency must be an integer between 1 and 16');
  const results = new Array(items.length);
  let next = 0, failed = false, failure;
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await task(items[index], index); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
  return results;
}
