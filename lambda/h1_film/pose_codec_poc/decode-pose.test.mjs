import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { createPoseDecoder } from './decode-pose.mjs';

const require = createRequire(path.resolve(process.env.HALOSPAWNS_VIEWER_REPO ?? '../halospawns-svelte', 'packages/viewer/package.json'));
const settings = { translation_step: 1 / 65536, scale_step: 1 / 65536, quaternion_levels: 131071,
  smallest_three: true, closed_loop: false, point_error_limit: 0.0002, point_radius: 1 };
function fixture({ fallback = false, parent = -1 } = {}) {
  const pieces = [];
  const put = (n, method, value) => { const b = Buffer.alloc(n); b[method](value); pieces.push(b); };
  const u8 = v => put(1, 'writeUInt8', v), u16 = v => put(2, 'writeUInt16LE', v), i32 = v => put(4, 'writeInt32LE', v);
  u16(1); u16(0); u8(0); u16(2); u8(1); u8(parent + 1);
  for (const value of [0, 0, 0, 65536, 0, 0, 0, 3]) { u8(0); i32(value); }
  const raw = [20, 1, 2, 1, -1, 0, 0, 0, 1, 0, 0, 0, 1];
  u16(fallback ? 1 : 0);
  if (fallback) { u16(1); for (const v of raw) put(8, 'writeDoubleLE', v); }
  const poses = Buffer.concat(pieces), base = Buffer.from([1]), bp = zstdCompressSync(base), pp = zstdCompressSync(poses);
  const h = Buffer.alloc(20); h.write('PC01'); [base.length, bp.length, poses.length, pp.length].forEach((v, i) => h.writeUInt32LE(v, 4 + i * 4));
  return { block: Buffer.concat([h, bp, pp]), raw };
}
function decoder() {
  const shared = { player_object_data: { x: 10, y: 0, z: 0 }, identity: 42 };
  const base = { firstTick: 2048, ticks: [{ players: [shared] }, { players: [shared] }] };
  return { base, decode: createPoseDecoder({ ...require('three'), decompress: zstdDecompressSync, decodeBase: () => base }) };
}
test('independent frames do not mutate the shared legacy delta objects', () => {
  const { base, decode } = decoder(); const { block, raw } = fixture({ fallback: true });
  const result = decode(block, settings);
  assert.equal(result.firstTick, 2048);
  assert.deepEqual(result.ticks[0].players[0].model_nodes, [[10, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1]]);
  assert.deepEqual(result.ticks[1].players[0].model_nodes, [raw]);
  assert.ok(!('model_nodes' in base.ticks[0].players[0]));
  assert.notEqual(result.ticks[0].players[0], result.ticks[1].players[0]);
});
test('rejects malformed, truncated and cyclic chunks', () => {
  const { decode } = decoder(), { block } = fixture();
  for (const length of [0, 1, 4, 12, block.length - 1]) assert.throws(() => decode(block.subarray(0, length), settings));
  assert.throws(() => decode(fixture({ parent: 0 }).block, settings), /parent/);
  assert.throws(() => decode(block, { ...settings, translation_step: 0 }), /settings/);
});
