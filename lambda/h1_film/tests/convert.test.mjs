import assert from 'node:assert/strict';
import test from 'node:test';
import { convertFilm } from '../runtime/convert.mjs';

test('the reusable runner has no CLI side effects and still requires an explicit trust mode', async () => {
  const options = { film: 'unused.h1film', assets: '.', encoder: 'unused-encoder', output: 'unused-output' };
  await assert.rejects(convertFilm(options), /exactly one/);
  await assert.rejects(convertFilm({ ...options, reference: '.', 'trusted-local': true }), /exactly one/);
  assert.equal(options.film, 'unused.h1film');
});
