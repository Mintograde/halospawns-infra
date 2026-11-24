import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inflateRawSync,zstdDecompressSync} from 'node:zlib';
import {openMatchReplay} from '../h1_film/runtime/match-replay.mjs';
import {readRawPad} from '../h1_film/runtime/format3-pad.mjs';
import {decodeDiagnosticRow} from '../h1_film/runtime/diagnostics-codec.mjs';
import {screenActions} from './screen.mjs';
import {quietWindows} from './input.mjs';

const codecs = {
  decompressZstd:(bytes,n) => zstdDecompressSync(bytes,{maxOutputLength:n}),
  inflateRaw(bytes,dictionary,n) {
    const out = inflateRawSync(bytes,{dictionary,maxOutputLength:n,info:true});
    assert.equal(out.engine.bytesWritten,bytes.length);
    return out.buffer;
  }
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const completeProof = t => t?.verification?.hash_checks > 0 && t.verification.hash_mismatches === 0
  && t.verification.seed_mismatches === 0 && t.verification.played_ticks === t.frame_count;
const localSlots = mask => Array.from({length:16},(_,i)=>i).filter(i => mask & (1<<i));

async function networkSilence(match, host, inputs, job) {
  const remote = inputs.filter(v => v.track !== host);
  if (!remote.length) return new Map();
  const table = host.tables?.find(t => t.kind === 'ledger' && t.name === 'inputs');
  if (!table || table.capped) return null;
  const gaps = new Map(remote.map(({p}) => [p.slot,new Uint8Array(job.end-job.start)]));
  if (!table.count) return gaps;
  const bytes = await match.readEntry(table.entry);
  assert.ok(table.stride === 16 && bytes.length === table.count*table.stride);
  for (let i=0;i<table.count;i++) {
    const row = decodeDiagnosticRow('ledger','inputs',bytes.subarray(i*16,(i+1)*16),i);
    const a = row.host_tick-host.first_update-1-job.start, b = a+Math.max(1,row.span);
    if (row.kind === 3 && b>0 && a<job.end-job.start)
      gaps.get(row.player)?.fill(1,Math.max(0,a),Math.min(job.end-job.start,b));
  }
  return gaps;
}

async function livingTicks(read, job, candidates, decodeChunk) {
  const h = await read(0,32), size = h.readUInt32LE(16), rawSize = h.readUInt32LE(20);
  assert.ok(['HSRDC001','HSRDC002'].includes(h.toString('ascii',0,8)) && h.readUInt32LE(12) === 1
    && size > 0 && size <= 16<<20 && rawSize > 0 && rawSize <= 64<<20);
  const meta = JSON.parse(codecs.decompressZstd(await read(32,size),rawSize));
  const stride = job.rate / job.viewer.playback.tick_rate;
  assert.ok(Number.isInteger(stride) && stride >= 1);
  const counts = new Map(candidates.map(p => [p.slot,new Int32Array(job.end-job.start+1)]));
  let complete = stride === 1;
  let first = 0;
  for (const c of meta.chunks) {
    assert.ok(c.firstTick === first && c.tickCount > 0);
    first += c.tickCount;
    if (!candidates.some(p => p.windows.some(([a,b]) => c.firstTick*stride < b && first*stride > a))) continue;
    assert.ok(c.compressedBytes > 0 && c.compressedBytes <= 64<<20 && c.rawBytes > 0 && c.rawBytes <= 128<<20);
    const packed = await read(32+size+c.offset,c.compressedBytes);
    assert.equal(digest(packed),c.compressedSha256);
    let bytes = codecs.decompressZstd(packed,c.rawBytes);
    assert.equal(bytes.length,c.rawBytes);
    if (bytes.toString('ascii',0,4) === 'PC01') {
      const raw = bytes.readUInt32LE(4), n = bytes.readUInt32LE(8);
      assert.ok(raw > 0 && raw <= 64<<20 && bytes.length === 20+n+bytes.readUInt32LE(16));
      bytes = codecs.decompressZstd(bytes.subarray(20,20+n),raw);
    }
    const chunk = decodeChunk(bytes);
    assert.equal(chunk.firstTick,c.firstTick);
    assert.equal(chunk.ticks.length,c.tickCount);
    for (const [i,tick] of chunk.ticks.entries()) {
      const f = (c.firstTick+i)*stride;
      if (f < job.start || f >= job.end) continue;
      for (const p of candidates) {
        const player = tick.players?.find(v => v.player_index === p.slot);
        if (!player) { complete = false; continue; }
        const rawRef = player.object_ref ?? player.player_object_id ?? player.player_object_data?.object_id;
        const obj = rawRef == null ? null : Number(rawRef);
        const hp = player.player_object_data?.health;
        const hasBody = Number.isInteger(obj) && obj !== -1 && obj !== 0xffffffff;
        if (hasBody && Number.isFinite(hp) && hp > 0)
          counts.get(p.slot)[f-job.start+1] = 1;
        else if (hasBody && !Number.isFinite(hp) || !hasBody && hp > 0) complete = false;
      }
    }
  }
  if (first*stride < job.end) complete = false;
  for (const values of counts.values()) for (let i=1;i<values.length;i++) values[i] += values[i-1];
  return {complete,counts};
}

export async function audit(job,film,viewer,decodeChunk) {
  const result = {coverage:'complete',windows:[]};
  if (job.start === job.end) return result;
  const {complete,candidates,head,frames} = await screenActions(job,film);
  if (!complete) result.coverage = 'partial';
  if (!candidates.length) return result;
  if (!job.stable) return {...result,coverage:'partial'};
  let host, match, world = viewer, standalonePad;
  if (job.viewer.manifest_sha256) {
    match = await openMatchReplay(viewer,{size_bytes:job.viewer.size_bytes,
      manifest_sha256:job.viewer.manifest_sha256,source_film_sha256:job.sha256},codecs);
    host = match.manifest.tracks.find(t => t.id === 'host');
    assert.ok(completeProof(host) && host.frame_count === frames && host.first_update === head.readUInt32LE(40));
    world = async (at,n) => Buffer.from(await match.rangeReader(host.world)(at,n));
  } else {
    host = {id:'host',role:'host',first_update:head.readUInt32LE(40),frame_count:frames};
    const n = head.readUInt32LE(108);
    if (n) standalonePad = readRawPad(await film(head.readUInt32LE(104),n));
  }
  const manifest = match?.manifest ?? {tracks:[host]};
  const inputs = [];
  for (const p of candidates) {
    const own = manifest.tracks.find(t => t.role === 'client' && t.recorded_own_player === p.slot
      && completeProof(t) && t.pad?.original && !(t.pad.flags & 19) && t.pad.locals & (1<<p.slot));
    const track = own ?? host;
    let pad = track === host ? standalonePad : null;
    if (!pad && track.pad?.original && track.pad.locals & (1<<p.slot) && !(track.pad.flags & 19))
      pad = readRawPad(Buffer.from(await match.readEntry(track.pad.original)));
    const slots = pad ? localSlots(pad.locals) : [];
    if (!pad || !(pad.flags & 4) || pad.flags & 19 || slots.length !== pad.seats
        || !slots.includes(p.slot) || !pad.count) { result.coverage = 'partial'; continue; }
    inputs.push({p,track,pad,seat:slots.indexOf(p.slot)});
  }
  if (!inputs.length) return result;
  const gaps = await networkSilence(match,host,inputs,job);
  const life = await livingTicks(world,job,inputs.map(i=>i.p),decodeChunk);
  if (!life.complete) result.coverage = 'partial';
  for (const {p,track,pad,seat} of inputs) {
    if (track !== host && !gaps) { result.coverage = 'partial'; continue; }
    const counts = life.counts.get(p.slot);
    const reviewed = quietWindows(job,p,manifest,track,pad,seat,f => counts[f-job.start],gaps?.get(p.slot));
    if (!reviewed.complete) result.coverage = 'partial';
    if (reviewed.best) result.windows.push(reviewed.best);
  }
  return result;
}
