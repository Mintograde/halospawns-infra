import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readEnvelope } from '../runtime/film.mjs';
import { verifyPlayback } from '../runtime/adapters/film-v2-120.mjs';

function fixture() {
  const b = Buffer.alloc(536);
  const fields = { 0: 0x314d4c46, 1: 2, 2: 45, 3: 120, 4: 32, 5: 32, 6: 4,
    11: 1, 12: 512, 13: 120, 14: 2, 15: 100, 16: 448, 17: 484, 18: 448, 19: 480, 20: 4, 25: 4 };
  for (const [i, v] of Object.entries(fields)) b.writeUInt32LE(v, Number(i) * 4);
  b.write('downrush', 128); b.writeUInt32LE(0x314c5254, 512); b.writeUInt32LE(1, 516);
  return b;
}

test('envelope accepts valid input and rejects malformed bounds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h1-wasm-envelope-'));
  try {
    const path = join(root, 'test.h1film');
    await writeFile(path, fixture());
    assert.equal((await readEnvelope(path)).map, 'downrush');
    for (const [word, value] of [[0, 0], [3, 30], [11, 432001], [12, 0], [16, 100],
      [19, 449], [20, 1000], [25, 5], [26, 450]]) {
      const b = fixture(); b.writeUInt32LE(value, word * 4); await writeFile(path, b);
      await assert.rejects(readEnvelope(path), `word ${word}`);
    }
    const traversal = fixture(); traversal.write('../other\0', 128);
    await writeFile(path, traversal); await assert.rejects(readEnvelope(path), /map name/);
    await writeFile(path, fixture().subarray(0, 535)); await assert.rejects(readEnvelope(path), /Truncated/);
  } finally { await rm(root, { recursive: true }); }
});

test('playback requires complete clean samples and controls', () => {
  const log = '[film] played 1200 ticks of input\n' +
    '[film] self-check: 0 seed mismatches, 0 of 10 hash samples differed, 4800 control pushes\n' +
    '[film] VERDICT: clean';
  const envelope = { ticks: 1200, hash_samples: 10 };
  assert.equal(verifyPlayback(log, envelope).control_pushes, 4800);
  for (const bad of [log.replace('1200', '100'), log.replace('0 seed', '1 seed'),
    log.replace('of 10', 'of 0'), log.replace('4800', '0'), log + '\nDESYNC',
    log + '\nRECORDED BY ANOTHER BUILD', log.replace('VERDICT: clean', 'incomplete')]) {
    assert.throws(() => verifyPlayback(bad, envelope));
  }
});
