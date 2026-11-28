import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants, zstdCompressSync, zstdDecompressSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {openMatchReplay} from '../h1_film/runtime/match-replay.mjs';
import {packRuns, slicePoseRuns} from './pose.mjs';
import {attachedTrack, clientInterval} from './perspective.mjs';
import {clipKillFeed} from './feed.mjs';

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

async function openWorld(read, worldSize, count, revision, indexHash) {
  const header = await read(0,32);
  const version = header.readUInt16LE(10), indexSize = header.readUInt32LE(16);
  assert.ok([1,2].includes(version) && header.toString('ascii',0,8) === 'HSRDC00'+version
    && header.readUInt16LE(8) === 32 && header.readUInt32LE(12) === 1
    && header.readUInt32LE(24) === worldSize && indexSize > 0 && indexSize <= 16*1024*1024);
  const packedIndex = await read(32,indexSize);
  if (indexHash) assert.equal(sha(Buffer.concat([header,packedIndex])), indexHash);
  const manifest = JSON.parse(unpack(packedIndex,header.readUInt32LE(20)));
  assert.ok(manifest.keyframeInterval === frames && manifest.tickCount === count
    && manifest.sourceContract.tick_count === count);
  assert.equal(manifest.sourceContract.profile_revision, revision);
  return {read, worldSize, header, version, indexSize, manifest};
}

async function playerNames(world, slots, decode) {
  const names = Object.fromEntries(Object.entries(world.manifest.replay.game_meta?.players ?? {})
    .map(([key, player]) => [key, player?.name]));
  if (slots.every(slot => names[slot])) return names;
  // Older worlds can expose the recorder only in the first snapshot.
  const chunk = world.manifest.chunks[0];
  const packed = await world.read(32 + world.indexSize + chunk.offset, chunk.compressedBytes);
  assert.equal(sha(packed), chunk.compressedSha256);
  const raw = unpack(packed, chunk.rawBytes);
  const base = world.version === 1 ? raw : unpack(raw.subarray(20, 20 + raw.readUInt32LE(8)), raw.readUInt32LE(4));
  for (const p of decode(base).ticks[0].players ?? []) {
    if (p.name) names[p.player_index] ??= p.name;
  }
  return names;
}

async function selectWorld(job, readSource, codec, readObject) {
  const {source} = job;
  let host, hostWorld, clients = [], openClient;
  if (source.manifest_sha256) {
    const match = await openMatchReplay(readSource, source);
    [host, ...clients] = match.manifest.tracks;
    assert.ok(host.id === match.manifest.authoritative_track && host.verification.played_ticks === source.tick_count);
    assert.equal(match.manifest.tick_rate, job.rate);
    openClient = track => {
      const entry = match.manifest.entries.find(e => e.id === track.world);
      const relativeRead = match.rangeReader(track.world);
      return openWorld(async (at,n) => Buffer.from(await relativeRead(at,n)),
        entry.size_bytes, track.frame_count, track.viewer_revision, entry.index_sha256);
    };
    hostWorld = await openClient(host);
  } else {
    hostWorld = await openWorld(readSource, source.size_bytes, source.tick_count, source.world_revision);
    if (job.views?.length) {
      host = job.views[0].host_track;
      for (const view of job.views) {
        assert.deepEqual(view.host_track, host);
        clients.push(await attachedTrack(view, job, readObject));
      }
      openClient = async track => openWorld(await readObject(track.artifact), track.artifact.size_bytes, track.frame_count, 5);
    }
  }
  const fallback = {world:hostWorld, hostWorld, track_id:'host', player_slot:job.player_slot, start:job.start, end:job.end};
  if (!job.player_name || !clients.length) return fallback;
  const isSubject = async (world, slot) => {
    const names = await playerNames(world, [slot], codec.decodeReplayDeltaChunk);
    return names[slot] === job.player_name && Object.values(names).filter(name => name === job.player_name).length === 1;
  };
  if (!await isSubject(hostWorld, job.player_slot)) return fallback;
  let selected;
  for (const track of clients) {
    if (track.status === 'unavailable') continue;
    const interval = clientInterval(host, track, job.start, job.end, 'feed_events' in job);
    if (!interval) continue;
    const world = await openClient(track);
    if (!await isSubject(world, track.recorded_own_player)) continue;
    if (selected) return fallback;
    selected = {world, hostWorld, track_id:track.id, player_slot:track.recorded_own_player, ...interval};
  }
  return selected ?? fallback;
}

export async function cutClip(job, readSource, codec, readObject) {
  const {rate} = job;
  assert.ok(Number.isInteger(job.start) && Number.isInteger(job.end) && job.start >= 0
    && job.start < job.end && job.end <= job.source.tick_count);
  const selected = await selectWorld(job, readSource, codec, readObject);
  const {world, track_id, player_slot, start, end} = selected;
  const perspective = job.player_name ? {pov:{track_id,player_slot,start_frame:start,end_frame:end,
    host_start_frame:job.start,host_end_frame:job.end}, view_attempts:(job.views ?? []).map(v => v.id)} : {};
  if ('feed_events' in job) {
    const slots = (job.feed_events ?? []).flatMap(e => [e.killer_slot, e.victim_slot]).filter(Number.isInteger);
    const names = await playerNames(selected.hostWorld, slots, codec.decodeReplayDeltaChunk);
    perspective.kill_feed = clipKillFeed(job, selected, names);
    // The existing clip pins this source and exact POV interval. Only its HUD
    // metadata needs publishing, so no frame chunks or screenshots are rewritten.
    if (job.previous && perspective.pov && isDeepStrictEqual(job.previous.pov, perspective.pov)
        && job.previous.tick_count === end - start) return {...job.previous, ...perspective};
  }
  const {read, worldSize, header, version, indexSize, manifest} = world;
  const {decodeReplayDeltaChunk, encodeReplayDeltaChunk} = codec;
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
      && c.tickCount === Math.min(frames, manifest.tickCount-c.firstTick)
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
      const eventStart = track_id === 'host' ? job.source_start : start;
      const eventEnd = track_id === 'host' ? job.source_end : end;
      return stamp && Number(stamp[1]) >= eventStart && Number(stamp[1]) < eventEnd;
    })};
  const index = {...manifest, replayId:job.id, tickCount:outputCount, chunks, replay,
    sourceContract:{...manifest.sourceContract,tick_count:outputCount}};
  const indexRaw = Buffer.from(JSON.stringify(index)), indexPacked = compress(indexRaw);
  const head = Buffer.from(header);
  head.writeUInt32LE(indexPacked.length,16);
  head.writeUInt32LE(indexRaw.length,20);
  head.writeUInt32LE(32+indexPacked.length+payloadSize,24);
  return {body:Buffer.concat([head,indexPacked,...parts]), raw_bytes:totalRaw,
    tick_count:outputCount, profile_revision:index.sourceContract.profile_revision,
    ...perspective};
}
