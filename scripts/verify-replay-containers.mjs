import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const reportPath = resolve(process.argv[2]);
const viewerRoot = resolve(process.argv[3] ?? '../halospawns-svelte');
const requireViewer = createRequire(resolve(viewerRoot, 'packages/viewer/package.json'));
const { decompress } = requireViewer('fzstd');
const { decodeReplayDeltaChunk } = await import(pathToFileURL(resolve(
  viewerRoot, 'packages/viewer/src/lib/core/session/replayDeltaCodec.js'
)));
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Every chunk is decoded in isolation, in reverse order, with frontend code.
for (const fixture of report.fixtures) {
  for (const revision of [1, 2]) {
    const result = fixture.revisions[String(revision)];
    const bytes = await readFile(resolve(dirname(reportPath), result.container_file));
    assert.equal(sha256(bytes), result.sha256);
    assert.equal(bytes.subarray(0, 8).toString(), 'HSRDC001');
    assert.equal(bytes.readUInt16LE(8), 32);
    assert.equal(bytes.readUInt16LE(10), 1);
    assert.equal(bytes.readUInt32LE(12), 1);
    assert.equal(bytes.readUInt32LE(24), bytes.length);
    assert.equal(bytes.readUInt32LE(28), 0);
    const manifestEnd = 32 + bytes.readUInt32LE(16);
    const manifestRaw = decompress(bytes.subarray(32, manifestEnd));
    assert.equal(manifestRaw.length, bytes.readUInt32LE(20));
    const manifest = JSON.parse(Buffer.from(manifestRaw).toString());
    assert.equal(manifest.sourceContract.profile_revision, revision);
    assert.equal(manifest.sourceContract.tick_count, result.tick_count);
    let offset = 0;
    let tickCount = 0;
    for (const [index, chunk] of manifest.chunks.entries()) {
      assert.equal(chunk.index, index);
      assert.equal(chunk.offset, offset);
      assert.equal(chunk.firstTick, tickCount);
      offset += chunk.compressedBytes;
      tickCount += chunk.tickCount;
    }
    assert.equal(tickCount, manifest.tickCount);
    assert.equal(tickCount, result.tick_count);
    assert.equal(manifestEnd + offset, bytes.length);
    const started = performance.now();
    for (const chunk of [...manifest.chunks].reverse()) {
      const compressed = bytes.subarray(manifestEnd + chunk.offset, manifestEnd + chunk.offset + chunk.compressedBytes);
      assert.equal(sha256(compressed), chunk.compressedSha256);
      const raw = decompress(compressed);
      assert.equal(raw.length, chunk.rawBytes);
      const decoded = decodeReplayDeltaChunk(raw);
      assert.equal(decoded.firstTick, chunk.firstTick);
      assert.equal(decoded.ticks.length, chunk.tickCount);
      const tickDigest = createHash('sha256');
      for (const tick of decoded.ticks) {
        const serialized = Buffer.from(JSON.stringify(tick));
        tickDigest.update(`${serialized.length}:`);
        tickDigest.update(serialized);
      }
      assert.equal(tickDigest.digest('hex'), chunk.tickSha256);
    }
    result.frontend_codec_validation = {
      cold_reverse_chunks: manifest.chunks.length,
      ticks: tickCount,
      decode_and_hash_ms: Math.round(performance.now() - started),
    };
    console.log(JSON.stringify({ role: fixture.role, revision, ...result.frontend_codec_validation }));
  }
}
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
