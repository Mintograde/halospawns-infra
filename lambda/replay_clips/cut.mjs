import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants, zstdCompressSync, zstdDecompressSync} from 'node:zlib';
import {openMatchReplay} from '../h1_film/runtime/match-replay.mjs';
import {packRuns, slicePoseRuns} from './pose.mjs';

const limit = 64 * 1024 * 1024;
const frames = 2048;
export const sha = input => createHash('sha256').update(input).digest('hex');
const compress = bytes => zstdCompressSync(bytes, {params: {
  [constants.ZSTD_c_compressionLevel]: 5, [constants.ZSTD_c_checksumFlag]: 1
}});
function unpack(bytes, size) {
  assert.ok(Number.isSafeInteger(size) && size > 0 && size <= limit, 'Invalid decoded size');
  const raw = zstdDecompressSync(bytes, {maxOutputLength: size});
  assert.equal(raw.length, size);
  return raw;
}
function tickHash(ticks) {
  const hash = createHash('sha256');
  for (const tick of ticks) {
    const text = Buffer.from(JSON.stringify(tick));
    hash.update(String(text.length) + ':').update(text);
  }
  return hash.digest('hex');
}
function poseBlock(base, runs) {
  const pose = packRuns(runs), a = compress(base), b = compress(pose);
  const h = Buffer.alloc(20);
  h.write('PC01');
  [base.length, a.length, pose.length, b.length].forEach((n,i) => h.writeUInt32LE(n,4+i*4));
  return Buffer.concat([h,a,b]);
}

export async function cutClip(job, readSource, {decodeReplayDeltaChunk, encodeReplayDeltaChunk}) {
  const {source, start, end, rate} = job;
  let read = readSource, worldSize = source.size_bytes, indexHash;
  if (source.manifest_sha256) {
    const match = await openMatchReplay(read, {size_bytes:worldSize, manifest_sha256:source.manifest_sha256});
    const host = match.manifest.tracks.find(t => t.id === match.manifest.authoritative_track);
    assert.ok(host.role === 'host' && host.verification.played_ticks === source.tick_count);
    assert.equal(match.manifest.tick_rate, rate);
    const world = match.manifest.entries.find(e => e.id === host.world);
    const relativeRead = match.rangeReader(host.world);
    read = async (at,n) => Buffer.from(await relativeRead(at,n));
    worldSize = world.size_bytes;
    indexHash = world.index_sha256;
  }
  const header = await read(0,32);
  const version = header.readUInt16LE(10), indexSize = header.readUInt32LE(16);
  assert.ok([1,2].includes(version) && header.toString('ascii',0,8) === 'HSRDC00'+version
    && header.readUInt16LE(8) === 32 && header.readUInt32LE(12) === 1
    && header.readUInt32LE(24) === worldSize && indexSize > 0 && indexSize <= 16*1024*1024);
  const packedIndex = await read(32,indexSize);
  if (indexHash) assert.equal(sha(Buffer.concat([header,packedIndex])), indexHash);
  const manifest = JSON.parse(unpack(packedIndex,header.readUInt32LE(20)));
  assert.ok(manifest.keyframeInterval === frames && manifest.tickCount === source.tick_count
    && manifest.sourceContract.tick_count === source.tick_count && Number.isInteger(start)
    && Number.isInteger(end) && start >= 0 && start < end && end <= source.tick_count);
  assert.equal(manifest.sourceContract.profile_revision, source.world_revision);
  let payloadSize = 0, consumed = 0;
  const parts = [], chunks = [];
  let ticks = [], runs = [], outputCount = 0, totalRaw = 0;
  function flush() {
    const base = Buffer.from(encodeReplayDeltaChunk(ticks, {firstTick:outputCount}));
    const raw = version === 2 ? poseBlock(base, runs) : base, packed = compress(raw);
    assert.ok(raw.length <= limit && packed.length <= limit);
    chunks.push({index:chunks.length, firstTick:outputCount, tickCount:ticks.length,
      offset:payloadSize, rawBytes:raw.length, compressedBytes:packed.length,
      compressedSha256:sha(packed), ...(version === 2 ? {rawSha256:sha(raw)}
        : {tickSha256:tickHash(decodeReplayDeltaChunk(base).ticks)})});
    parts.push(packed);
    outputCount += ticks.length;
    payloadSize += packed.length;
    totalRaw += raw.length;
    ticks = [];
    runs = [];
  }
  for (const [i,c] of manifest.chunks.entries()) {
    assert.ok(c.index === i && c.firstTick === i*frames && c.offset === consumed
      && c.tickCount === Math.min(frames, source.tick_count-c.firstTick)
      && Number.isSafeInteger(c.compressedBytes) && c.compressedBytes > 0 && c.compressedBytes <= limit);
    consumed += c.compressedBytes;
    let lo = Math.max(0,start-c.firstTick);
    const hi = Math.min(c.tickCount,end-c.firstTick);
    if (lo >= hi) continue;
    const packed = await read(32+indexSize+c.offset,c.compressedBytes);
    assert.equal(sha(packed),c.compressedSha256);
    const raw = unpack(packed,c.rawBytes);
    let base = raw, poses;
    if (version === 2) {
      assert.equal(sha(raw),c.rawSha256);
      assert.equal(raw.toString('ascii',0,4),'PC01');
      const boundary = 20+raw.readUInt32LE(8);
      assert.equal(boundary+raw.readUInt32LE(16),raw.length);
      base = unpack(raw.subarray(20,boundary),raw.readUInt32LE(4));
      poses = unpack(raw.subarray(boundary),raw.readUInt32LE(12));
    }
    const decoded = decodeReplayDeltaChunk(base);
    assert.equal(decoded.firstTick,c.firstTick);
    assert.equal(decoded.ticks.length,c.tickCount);
    while (lo < hi) {
      const stop = Math.min(hi,lo+frames-ticks.length);
      if (poses) runs.push(...slicePoseRuns(poses,c.tickCount,lo,stop,ticks.length));
      ticks.push(...decoded.ticks.slice(lo,stop));
      lo = stop;
      if (ticks.length === frames) flush();
    }
  }
  if (ticks.length) flush();
  assert.equal(consumed+32+indexSize,worldSize);
  assert.equal(outputCount,end-start);
  const {game_meta:meta={},events=[]} = manifest.replay;
  // Whole-match statistics and event histories would both expose off-clip
  // data and inflate the index. Original snapshot clocks stay in every frame.
  const players = Object.fromEntries(Object.entries(meta.players ?? {}).map(([slot,p]) =>
    [slot, Object.fromEntries(Object.entries(p ?? {}).filter(([k]) => ['name','team','player_index'].includes(k)))]));
  const gameMeta = Object.fromEntries(['map_name','game_type','has_teams'].filter(k=>k in meta).map(k=>[k,meta[k]]));
  const replay = {game_meta:{...gameMeta,players}, summary:{is_full_game:false,
    recording_duration:outputCount/rate, ticks_elapsed:outputCount, ticks_recorded:outputCount, ticks_dropped:0},
    events:events.filter(e => {
      const stamp = typeof e === 'string' && /^(\d+):/u.exec(e);
      return stamp && Number(stamp[1]) >= job.source_start && Number(stamp[1]) < job.source_end;
    })};
  const index = {...manifest, replayId:job.id, tickCount:outputCount, chunks, replay,
    sourceContract:{...manifest.sourceContract,tick_count:outputCount}};
  const indexRaw = Buffer.from(JSON.stringify(index)), indexPacked = compress(indexRaw);
  const head = Buffer.from(header);
  head.writeUInt32LE(indexPacked.length,16);
  head.writeUInt32LE(indexRaw.length,20);
  head.writeUInt32LE(32+indexPacked.length+payloadSize,24);
  return {body:Buffer.concat([head,indexPacked,...parts]), raw_bytes:totalRaw,
    tick_count:outputCount, profile_revision:index.sourceContract.profile_revision};
}
