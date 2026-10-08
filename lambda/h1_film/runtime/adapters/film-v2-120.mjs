// Frozen format-2 / 120 Hz adapter. New wire formats get a separate adapter.
import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';

export async function readEnvelope(path) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    assert.ok(size >= 448 && size <= 512 * 1024 * 1024, 'Invalid film size');
    const head = Buffer.alloc(448);
    assert.equal((await file.read(head, 0, head.length, 0)).bytesRead, head.length);
    const w = Array.from({ length: 32 }, (_, i) => head.readUInt32LE(i * 4));
    assert.ok(w[0] === 0x314d4c46 && w[1] === 2, 'Expected format-2 FLM1');
    assert.ok(w[3] === 120 && w[5] === 32 && w[6] === 4, 'Expected 120 Hz / 32-byte actions / four seats');
    assert.ok(w[11] > 0 && w[11] <= 432000, 'Invalid tick count');
    assert.ok(w[25] > 0 && w[25] <= 4 && w[16] === 448, 'Invalid header or seat count');
    const stream = w[17], trailer = w[12];
    assert.ok(stream >= 448 && stream < trailer && trailer <= size - 8 && [1, 2].includes(w[14]),
      'A closed film with a trailer is required');
    const spans = [[0, 448], [stream, trailer]];
    for (const [offset, length, before] of [
      [w[18], w[4], true], [w[19], w[20], true], [w[21], w[22], true],
      [w[23], w[24], true], [w[26], w[27], false], [w[28], w[29], false],
    ]) {
      if (!length) { assert.equal(offset, 0, 'Empty section has an offset'); continue; }
      assert.ok(offset >= 448 && offset + length <= (before ? stream : size), 'Section outside permitted range');
      spans.push([offset, offset + length]);
    }
    const tail = Buffer.alloc(8);
    assert.equal((await file.read(tail, 0, 8, trailer)).bytesRead, 8);
    const samples = tail.readUInt32LE(4);
    assert.ok(tail.readUInt32LE(0) === 0x314c5254 && samples > 0 && samples <= 40000, 'Invalid hash trailer');
    const end = trailer + 8 + samples * 16;
    assert.ok(end <= size, 'Truncated hash samples');
    spans.push([trailer, end]);
    spans.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i - 1][1] <= spans[i][0], 'Overlapping sections');
    const str = (a, b) => head.subarray(a, b).toString('utf8').split('\0')[0];
    const map = str(128, 256);
    assert.match(map, /^[a-zA-Z0-9_-]+$/, 'Invalid map name');
    return { format: 2, protocol_revision: w[2], tick_rate: w[3], ticks: w[11], players: w[25], map,
      map_bytes: w[15], hash_samples: samples, hash_period: w[13], first_update: w[10],
      end_reason: w[14], gametype: str(256, 384), build: str(384, 448) };
  } finally { await file.close(); }
}

export function verifyPlayback(log, envelope) {
  assert.ok(!/DESYNC|NOT ONE CONTROL PUSH|RECORDED BY ANOTHER BUILD|the gametype is resolved by NAME/.test(log),
    'Simulation diverged or recorded build/settings differ');
  const played = [...log.matchAll(/\[film\] played (\d+) ticks? of/g)].at(-1);
  const checks = [...log.matchAll(/self-check: (\d+) seed mismatch(?:es)?, (\d+) of (\d+) hash samples? differed, (\d+) control push(?:es)?/g)].at(-1);
  assert.ok(played && checks && log.includes('[film] VERDICT: clean'), 'Missing simulation completion record');
  const result = { played_ticks: Number(played[1]), seed_mismatches: Number(checks[1]),
    hash_mismatches: Number(checks[2]), hash_checks: Number(checks[3]), control_pushes: Number(checks[4]) };
  assert.equal(result.played_ticks, envelope.ticks, 'Incomplete playback');
  assert.equal(result.hash_checks, envelope.hash_samples, 'Incomplete hash checks');
  assert.equal(result.seed_mismatches, 0, 'Seed mismatch');
  assert.equal(result.hash_mismatches, 0, 'Hash mismatch');
  assert.ok(result.control_pushes > 0, 'No control pushes');
  return result;
}
