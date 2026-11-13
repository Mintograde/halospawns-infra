import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnProbabilities, classifySpawn} from '../runtime/spawn-probabilities.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-11, `${a} != ${b}`);
test('three unequal weights integrate each interval and cutoff equality qualifies', () => {
  const p = spawnProbabilities([1,2,3]);
  close(p[0],1/108); close(p[1],47/216); close(p[2],167/216);
  assert.equal(classifySpawn([Math.sqrt(2/3),1],0).improbable,true);
});
test('two-point closed form is not normalized ratings', () => {
  const p = spawnProbabilities([1, 2]);
  close(p[0], 1 / 8);
  close(p[1], 7 / 8);
  assert.equal(classifySpawn([1, 2], 0).improbable, true);
  assert.equal(classifySpawn([1, 2], 1).non_highest, false);
});
test('ties, vetoed points, and no valid selection', () => {
  assert.deepEqual(spawnProbabilities([0, -1, 2]), [0, 0, 1]);
  assert.equal(spawnProbabilities([0, -1]), null);
  assert.equal(classifySpawn([0, 2], 0), null);
  for (const p of spawnProbabilities([3, 3, 3])) close(p, 1 / 3);
  assert.equal(classifySpawn([3, 3, 3], 0).non_highest, false);
});
test('mass, ordering, and scale invariance across varied distributions', () => {
  for (let n = 1; n <= 100; n++) {
    const ratings = Array.from({length: n}, (_, i) => 1 + ((i * 37) % 101));
    const p = spawnProbabilities(ratings);
    const scaled = spawnProbabilities(ratings.map(r => r * 1e100));
    close(p.reduce((a, b) => a + b, 0), 1);
    p.forEach((v, i) => { close(v, scaled[i]); assert.ok(v >= 0 && v <= 1); });
  }
});
test('relative and absolute cutoffs both apply', () => {
  assert.equal(classifySpawn([1, 1.01], 0).non_highest, true);
  assert.equal(classifySpawn([1, 1.01], 0).improbable, false);
  const many = [0.5, ...Array(100).fill(1)];
  assert.equal(classifySpawn(many, 0).improbable, false);
  assert.equal(classifySpawn([1, 2], 0, {maximum_ratio: 0.1, minimum_gap: 0}).improbable, false);
});
test('invalid observations cannot become measured zero counts', () => {
  for (const input of [[], [NaN], [Infinity], ['1']]) {
    assert.throws(() => spawnProbabilities(input), TypeError);
  }
  assert.throws(() => classifySpawn([1], 2), RangeError);
  assert.throws(() => classifySpawn([1], 0, {maximum_ratio: 1, minimum_gap: 0}), RangeError);
});
