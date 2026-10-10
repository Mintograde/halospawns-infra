import assert from 'node:assert/strict';
import { open, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [oldPath, newPath, output] = process.argv.slice(2);
assert(oldPath && newPath && output, 'Use <old.hsrdc> <new.hsrdc> <report.json>');
const frontend = resolve(import.meta.dirname, '../../../../halospawns-svelte/packages/viewer/src/lib/core/session');
const { decodeReplayDeltaChunk } = await import(pathToFileURL(resolve(frontend, 'replayDeltaCodec.js')));
const { decodeReplayPoseChunkAsync } = await import(pathToFileURL(resolve(frontend, 'replayPoseCodec.js')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inflate = async (bytes, size) => {
  assert(size <= 64 * 1024 * 1024);
  const raw = zstdDecompressSync(bytes, { maxOutputLength: size });
  assert.equal(raw.length, size);
  return raw;
};
async function container(path) {
  const file = await open(path), header = Buffer.alloc(32);
  await file.read(header, 0, 32, 0);
  const size = header.readUInt32LE(16), packed = Buffer.alloc(size);
  await file.read(packed, 0, size, 32);
  const manifest = JSON.parse(await inflate(packed, header.readUInt32LE(20)));
  return { file, manifest, bytes: (await file.stat()).size, async chunk(index) {
    const c = manifest.chunks[index], bytes = Buffer.alloc(c.compressedBytes);
    await file.read(bytes, 0, bytes.length, 32 + size + c.offset);
    assert.equal(hash(bytes), c.compressedSha256);
    const raw = await inflate(bytes, c.rawBytes);
    if (c.rawSha256) assert.equal(hash(raw), c.rawSha256);
    return c.rawSha256 ? decodeReplayPoseChunkAsync(raw, { yieldToMainThread: async () => {} }, inflate) : decodeReplayDeltaChunk(raw);
  } };
}
function exact(a, b) {
  if (a && typeof a === 'object') {
    assert.equal(Array.isArray(a), Array.isArray(b));
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    for (const key of Object.keys(a)) exact(a[key], b[key]);
  } else assert(Object.is(a, b), `Changed non-pose value: ${a} / ${b}`);
}
const before = await container(oldPath), after = await container(newPath);
let nodes = 0, maxPosition = 0, maxBound = 0, sumSquared = 0;
const snapshots = {};
try {
  assert.equal(before.manifest.tickCount, after.manifest.tickCount);
  assert.deepEqual(before.manifest.replay, after.manifest.replay);
  for (let index = 0; index < before.manifest.chunks.length; index++) {
    const a = await before.chunk(index), b = await after.chunk(index);
    assert.equal(a.firstTick, b.firstTick);
    assert.equal(a.ticks.length, b.ticks.length);
    for (let frame = 0; frame < a.ticks.length; frame++) {
      const source = a.ticks[frame], decoded = b.ticks[frame];
      for (let pi = 0; pi < source.players.length; pi++) {
        const original = source.players[pi].model_nodes, restored = decoded.players[pi].model_nodes;
        if (!original) { assert.equal(restored, original); continue; }
        assert.equal(original.length, restored.length);
        for (let bone = 0; bone < original.length; bone++) {
          const x = original[bone], y = restored[bone];
          const pos = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
          const matrix = Math.hypot(...x.slice(4).map((v, j) => v * x[3] - y[j + 4] * y[3]));
          const bound = pos + matrix;
          assert(Number.isFinite(bound) && bound <= 0.0002, `Pose exceeds bound at ${a.firstTick + frame}`);
          maxPosition = Math.max(maxPosition, pos); maxBound = Math.max(maxBound, bound);
          sumSquared += pos * pos; nodes++;
        }
        decoded.players[pi] = { ...decoded.players[pi], model_nodes: original };
      }
      exact(source, decoded);
    }
    if (index % 10 === 0) console.log(JSON.stringify({ chunks: index + 1, nodes, maxBound }));
  }
  for (const tick of [0, 1, 2047, 2048, 2235, 2236, 4097, 5701, Math.floor(after.manifest.tickCount / 2), after.manifest.tickCount - 1]) {
    const chunk = await after.chunk(Math.floor(tick / 2048));
    snapshots[tick] = chunk.ticks[tick - chunk.firstTick];
  }
  const report = { status: 'verified', ticks: after.manifest.tickCount, nodes, maxPosition, rmsPosition: Math.sqrt(sumSquared / nodes),
    maxPointBoundRadius1: maxBound, beforeBytes: before.bytes, afterBytes: after.bytes, ratio: before.bytes / after.bytes, snapshots };
  await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...report, snapshots: Object.keys(snapshots) }));
} finally { await before.file.close(); await after.file.close(); }
