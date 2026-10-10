import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPoseDecoder } from './decode-pose.mjs';

const [viewer, originalPath, packedPath, output, indicesArg = 'sample', expandedPath] = process.argv.slice(2);
if (!output) throw new Error('Usage: node verify-js.mjs VIEWER_REPO ORIGINAL EXPERIMENT NEW_REPORT [sample|all|indices] [EXPANDED]');
const require = createRequire(path.resolve(viewer, 'packages/viewer/package.json'));
const three = require('three');
const { decodeReplayDeltaChunk } = await import(pathToFileURL(path.resolve(viewer, 'packages/viewer/src/lib/core/session/replayDeltaCodec.js')));
const decode = createPoseDecoder({ ...three, decodeBase: decodeReplayDeltaChunk, decompress: zstdDecompressSync });
const sha = b => createHash('sha256').update(b).digest('hex');
async function container(filename, magic) {
  const bytes = await readFile(filename);
  assert.equal(bytes.toString('ascii', 0, 8), magic);
  assert.equal(bytes.readUInt32LE(24), bytes.length);
  const size = bytes.readUInt32LE(16), base = 32 + size;
  const manifest = JSON.parse(zstdDecompressSync(bytes.subarray(32, base)));
  return { bytes, manifest, chunk(i) {
    const c = manifest.chunks[i], compressed = bytes.subarray(base + c.offset, base + c.offset + c.compressedBytes);
    assert.equal(sha(compressed), c.compressedSha256);
    const raw = zstdDecompressSync(compressed); assert.equal(raw.length, c.rawBytes); return raw;
  } };
}
const original = await container(originalPath, 'HSRDC001');
const candidate = await container(packedPath, 'H1POSE01');
const expanded = expandedPath ? await container(expandedPath, 'HSRDC001') : null;
assert.equal(candidate.manifest.sourceSha256, sha(original.bytes));
assert.deepEqual(candidate.manifest.sourceManifest, original.manifest);
const last = candidate.manifest.chunks.length - 1;
const indices = indicesArg === 'all' ? Array.from({ length: last + 1 }, (_, i) => last - i)
  : indicesArg === 'sample' ? [...new Set([last, Math.floor(last / 2), 0])] : indicesArg.split(',').map(Number);
let maxPosition = 0, maxBound = 0, maxRustDifference = 0, nodes = 0, ticks = 0;
const worstPoses = [];
const previewFrames = [];
const timings = [];
function same(a, b) {
  if (Array.isArray(a)) { assert.ok(Array.isArray(b)); assert.equal(a.length, b.length); a.forEach((v, i) => same(v, b[i])); }
  else if (a && typeof a === 'object') { assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort()); for (const k of Object.keys(a)) same(a[k], b[k]); }
  else assert.ok(Object.is(a, b), `Value changed: ${a} / ${b}`);
}
for (const index of indices) {
  const start = performance.now();
  const a = decodeReplayDeltaChunk(original.chunk(index));
  const before = performance.now(), b = decode(candidate.chunk(index), candidate.manifest.settings);
  const after = performance.now();
  const rust = expanded ? decodeReplayDeltaChunk(expanded.chunk(index)) : null;
  assert.equal(a.firstTick, b.firstTick); assert.equal(a.ticks.length, b.ticks.length);
  for (let ti = 0; ti < a.ticks.length; ti++) {
    const at = a.ticks[ti], bt = b.ticks[ti];
    assert.deepEqual(Object.keys(at).sort(), Object.keys(bt).sort()); assert.equal(at.players.length, bt.players.length);
    for (const key of Object.keys(at)) if (key !== 'players') same(at[key], bt[key]);
    for (let pi = 0; pi < at.players.length; pi++) {
      const ap = at.players[pi], bp = bt.players[pi];
      assert.deepEqual(Object.keys(ap).sort(), Object.keys(bp).sort());
      for (const key of Object.keys(ap)) if (key !== 'model_nodes') same(ap[key], bp[key]);
      if (!ap.model_nodes?.length) { same(ap.model_nodes, bp.model_nodes); continue; }
      assert.equal(ap.model_nodes.length, bp.model_nodes.length);
      if (index === Math.floor(last / 2) && ti >= 256 && ti < 512 && pi === 0) {
        previewFrames.push({ tick: a.firstTick + ti, player: pi, tag: ap.player_object_data.tag_name,
          original: ap.model_nodes, decoded: bp.model_nodes });
      }
      let poseBound = 0;
      ap.model_nodes.forEach((an, ni) => {
        const bn = bp.model_nodes[ni]; assert.equal(an.length, bn.length);
        const position = Math.hypot(...an.slice(0, 3).map((v, i) => v - bn[i]));
        const matrix = Math.hypot(...an.slice(4).map((v, i) => v * an[3] - bn[i + 4] * bn[3]));
        const bound = position + candidate.manifest.settings.point_radius * matrix;
        assert.ok(bound <= candidate.manifest.settings.point_error_limit * (1 + 1e-6));
        maxPosition = Math.max(maxPosition, position); maxBound = Math.max(maxBound, bound); poseBound = Math.max(poseBound, bound); nodes++;
        if (rust) an.forEach((_, c) => { maxRustDifference = Math.max(maxRustDifference, Math.abs(bn[c] - rust.ticks[ti].players[pi].model_nodes[ni][c])); });
      });
      if (worstPoses.length < 12 || poseBound > worstPoses.at(-1).bound) {
        worstPoses.push({ tick: a.firstTick + ti, player: pi, tag: ap.player_object_data.tag_name, bound: poseBound, original: ap.model_nodes, decoded: bp.model_nodes });
        worstPoses.sort((a, b) => b.bound - a.bound); worstPoses.length = Math.min(12, worstPoses.length);
      }
    }
    ticks++;
  }
  timings.push({ index, ticks: b.ticks.length, decode_ms: after - before, total_ms: performance.now() - start });
  console.log(JSON.stringify(timings.at(-1)));
}
if (expanded) assert.ok(maxRustDifference < 1e-6, `Rust/JS reconstruction differs: ${maxRustDifference}`);
const report = { schema: 'halospawns.poseCodecJsVerification.v1', original: originalPath, experiment: packedPath,
  indices, ticks, nodes, all_non_pose_fields_exact: true, max_position: maxPosition, max_point_bound: maxBound,
  rust_cross_check: Boolean(expanded), max_rust_component_difference: maxRustDifference, timings,
  worst_poses: worstPoses, preview_frames: previewFrames };
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
