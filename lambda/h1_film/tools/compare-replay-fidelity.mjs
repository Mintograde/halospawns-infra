// Compare the complete downloaded products using the viewer's delta and range readers.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inflateRawSync, zstdDecompressSync} from 'node:zlib';

const [beforePath, afterPath, viewerRepository, checkWorker] = process.argv.slice(2);
assert.ok(beforePath && afterPath && viewerRepository && (!checkWorker || checkWorker === '--worker-products'),
  'Expected BASELINE.hsrv CANDIDATE.hsrv VIEWER_REPO [--worker-products]');
const session = resolve(viewerRepository, 'packages/viewer/src/lib/core/session');
const {decodeReplayDeltaChunk} = await import(pathToFileURL(join(session, 'replayDeltaCodec.js')));
const {openMatchReplay} = await import(pathToFileURL(join(session, 'h1MatchReplay.mjs')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const codecs = {
  decompressZstd: (bytes, length) => zstdDecompressSync(bytes, {maxOutputLength:length}),
  inflateRaw: (bytes, dictionary, wanted) => inflateRawSync(bytes, {dictionary, maxOutputLength:wanted}),
};
const totals = {worlds:0, ticks:0, chunks:0, diagnosticEntries:0};

// Delta decoders share unchanged subtrees. Cache only pairs already verified
// in this chunk. Object.is distinguishes signed zeros.
function sameValue(a, b, seen) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (seen.get(a) === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length || !keys.every(key => Object.hasOwn(b,key) && sameValue(a[key], b[key], seen))) return false;
  seen.set(a,b);
  return true;
}

function world(bytes) {
  assert.equal(bytes.toString('ascii',0,8), 'HSRDC002');
  const start = 32 + bytes.readUInt32LE(16);
  const {chunks, ...metadata} = JSON.parse(codecs.decompressZstd(bytes.subarray(32,start), bytes.readUInt32LE(20)));
  return {chunks, metadata, payload:bytes.subarray(start)};
}
function decodeBlock(file, chunk) {
  const bytes = file.payload.subarray(chunk.offset,chunk.offset+chunk.compressedBytes);
  assert.equal(hash(bytes),chunk.compressedSha256);
  const raw = codecs.decompressZstd(bytes,chunk.rawBytes);
  assert.equal(hash(raw),chunk.rawSha256);
  assert.equal(raw.toString('ascii',0,4),'PC01');
  const split = 20 + raw.readUInt32LE(8);
  assert.equal(split + raw.readUInt32LE(16),raw.length);
  const base = decodeReplayDeltaChunk(codecs.decompressZstd(raw.subarray(20,split),raw.readUInt32LE(4)));
  assert.equal(base.firstTick,chunk.firstTick);
  assert.equal(base.ticks.length,chunk.tickCount);
  return {ticks:base.ticks, poses:codecs.decompressZstd(raw.subarray(split),raw.readUInt32LE(12))};
}
function compareWorld(a, b) {
  const left = world(a), right = world(b);
  assert.deepEqual(left.metadata,right.metadata);
  assert.equal(left.chunks.length,right.chunks.length);
  let ticks = 0;
  // Reverse-order cold seeks also check every independent chunk boundary.
  for (let i = left.chunks.length - 1; i >= 0; i--) {
    const p = left.chunks[i], q = right.chunks[i];
    for (const key of ['index','firstTick','tickCount']) assert.equal(p[key],q[key],key);
    const old = decodeBlock(left,p), updated = decodeBlock(right,q);
    assert.ok(old.poses.equals(updated.poses), `Skeletal channel bytes differ at ${p.firstTick}`);
    const seen = new WeakMap();
    for (let j=0; j<p.tickCount; j++)
      assert.ok(sameValue(old.ticks[j],updated.ticks[j],seen), `World differs at tick ${p.firstTick+j}`);
    ticks += p.tickCount;
    totals.chunks++;
  }
  assert.equal(ticks,left.metadata.tickCount);
  totals.ticks += ticks;
  totals.worlds++;
}
const [a,b] = await Promise.all([readFile(beforePath),readFile(afterPath)]);
if (a.toString('ascii',0,4) === 'H1MV') {
  const [left,right] = await Promise.all([a,b].map(bytes =>
    openMatchReplay((at,n) => bytes.subarray(at,at+n),{size_bytes:bytes.length},codecs)));
  const {entries,logical_size_bytes, ...identity} = left.manifest;
  const {entries:updated,logical_size_bytes:updatedLength, ...other} = right.manifest;
  assert.deepEqual(identity,other);
  assert.deepEqual(entries.map(e=>e.id),updated.map(e=>e.id));
  for (let i=entries.length-1;i>=0;i--) {
    const entry = entries[i], other = updated[i];
    const [x,y] = await Promise.all([left.readEntry(entry.id), right.readEntry(entry.id)]);
    assert.equal(entry.kind,other.kind);
    assert.equal(entry.compression,other.compression);
    if (entry.kind === 'world') compareWorld(Buffer.from(x.buffer,x.byteOffset,x.byteLength),Buffer.from(y.buffer,y.byteOffset,y.byteLength));
    else {
      assert.equal(entry.sha256,other.sha256,entry.id);
      assert.equal(Buffer.compare(x,y),0,entry.id);
      totals.diagnosticEntries++;
    }
  }
} else compareWorld(a,b);

if (checkWorker) {
  async function workerProduct(path, bytes) {
    const read = async name => JSON.parse(await readFile(join(dirname(path), name)));
    const product = await read('finalization.json'), report = await read('report.json');
    const viewer = product.viewer_artifact;
    assert.equal(viewer.sha256, hash(bytes));
    assert.equal(viewer.size_bytes, bytes.length);
    // Physical pins, producer identity and performance telemetry vary per generation.
    // Compare every other field in the completion, including stats and spatial hashes.
    for (const key of ['sha256','s3_key','size_bytes','uncompressed_size_bytes']) delete viewer[key];
    for (const key of Object.keys(viewer.metadata.metrics)) {
      if (key.endsWith('_duration_ms') || key.endsWith('_bytes') || key.endsWith('_rss_kib')
          || key === 'artifact_source_ratio' || key === 'compression_ratio') delete viewer.metadata.metrics[key];
    }
    for (const key of ['parse_duration_ms','process_peak_rss_kib']) delete product.spatial_artifact.metadata[key];
    delete product.h1film.producer;
    delete product.h1film.exporter_revision;
    const match = product.h1film.match_replay;
    if (match) {
      delete match.manifest_sha256;
      for (const track of match.tracks) delete track.world_sha256;
    }
    const hashChecks = match ? match.tracks.reduce((n,t) => n + (t.verified_hash_count ?? 0),0) : product.h1film.hash_checks;
    return {product, simulation:report.simulation, clientDiagnostics:report.client_diagnostics, hashChecks};
  }
  const [old, updated] = await Promise.all([workerProduct(beforePath,a),workerProduct(afterPath,b)]);
  assert.deepEqual(updated,old);
  totals.recordedHashChecks = old.hashChecks;
  totals.separateDiagnosticBytes = old.clientDiagnostics?.size_bytes ?? 0;
}
console.log(JSON.stringify(totals));
