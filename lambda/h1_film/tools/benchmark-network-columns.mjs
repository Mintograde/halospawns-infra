// Decoder-only comparison using every columnar network block in a retained
// conversion. Run in the released image; mounts match benchmark-match-packing.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inspectMatchFilm} from '../runtime/match-film.mjs';
import {unpackMszip} from '../runtime/adapters/beta5-v2-120.mjs';
import {unpackNetworkColumns as baseline} from '/baseline/runtime/format3-codec.mjs';
import {unpackNetworkColumns as candidate} from '../runtime/format3-codec.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const original=await readFile('/input/work/input.h1film'),match=inspectMatchFilm(original);
const tracks=JSON.parse(await readFile('/input/match-tracks.json','utf8')).tracks;
const worlds=[original.subarray(match.host_offset,match.host_offset+match.host_size),
  ...await Promise.all(tracks.map(t=>readFile('/input/'+t.id+'.h1film')))];
const blocks=[];
for(const world of worlds) {
  const start=world.readUInt32LE(448),size=world.readUInt32LE(452);if(!size)continue;
  const bytes=world.subarray(start,start+size);let at=32;
  for(let i=0;i<bytes.readUInt32LE(24);i++) {
    const [size,packed,,,count,flags]=Array.from({length:6},(_,j)=>bytes.readUInt32LE(at+j*4));at+=24;
    const payload=bytes.subarray(at,at+packed);at+=packed;
    if(flags&2) {
      const expanded=flags&1?unpackMszip(payload,size):payload;
      blocks.push({bytes:expanded,count,sha256:hash(baseline(expanded,count))});
    }
  }
}
assert.ok(blocks.length);const runs=[];
for(let round=0;round<4;round++)for(const variant of round%2?['candidate','baseline']:['baseline','candidate']) {
  const decode=variant==='baseline'?baseline:candidate,started=performance.now();
  const decoded=blocks.map(b=>decode(b.bytes,b.count)),seconds=(performance.now()-started)/1000;
  for(let i=0;i<blocks.length;i++)assert.equal(hash(decoded[i]),blocks[i].sha256,'Decoded bytes changed');
  const run={variant,round,warmup:round===0,seconds};runs.push(run);console.log(JSON.stringify(run));
}
await writeFile('/evidence/network-columns.json',JSON.stringify({scope:'decoder only; inflate and hashing excluded',
  blocks:blocks.length,records:blocks.reduce((sum,b)=>sum+b.count,0),bytes:blocks.reduce((sum,b)=>sum+b.bytes.length,0),runs},null,2));
