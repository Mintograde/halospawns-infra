import assert from 'node:assert/strict';
import test from 'node:test';
import {zstdCompressSync, zstdDecompressSync} from 'node:zlib';
import * as codec from '../../../halospawns-svelte/packages/viewer/src/lib/core/session/replayDeltaCodec.js';
import {cutClip, sha} from './cut.mjs';

function fixture(count) {
  const ticks = Array.from({length:count}, (_,i) => ({game_time:i,players:[{name:'Test',x:i}]}));
  let offset = 0;
  const parts = [], chunks = [];
  for (let firstTick=0; firstTick<count; firstTick+=2048) {
    const group = ticks.slice(firstTick,firstTick+2048);
    const raw = codec.encodeReplayDeltaChunk(group,{firstTick});
    const packed = zstdCompressSync(raw);
    chunks.push({index:parts.length,firstTick,tickCount:group.length,offset,
      rawBytes:raw.length,compressedBytes:packed.length,compressedSha256:sha(packed)});
    parts.push(packed);
    offset+=packed.length;
  }
  const raw = Buffer.from(JSON.stringify({keyframeInterval:2048,tickCount:count,chunks,
    replay:{game_meta:{map_name:'Fallout'},events:[]},sourceContract:{profile_revision:2,tick_count:count}}));
  const packed=zstdCompressSync(raw);
  const header=Buffer.alloc(32);
  header.write('HSRDC001');
  header.writeUInt16LE(32,8); header.writeUInt16LE(1,10);
  [1,packed.length,raw.length,32+packed.length+offset].forEach((n,i)=>header.writeUInt32LE(n,12+4*i));
  return {body:Buffer.concat([header,packed,...parts]),ticks};
}

test('exact independently decodable frames across both chunk boundaries', async () => {
  const {body,ticks}=fixture(7000), reads=[];
  const start=2020,end=4100;
  const job={id:'clip',source:{size_bytes:body.length,tick_count:ticks.length,world_revision:2},
    start,end,source_start:start,source_end:end,rate:30};
  const read=async (at,n)=>{ reads.push([at,n]); return body.subarray(at,at+n); };
  const clip=await cutClip(job,read,codec);
  const boundary=32+clip.body.readUInt32LE(16);
  const index=JSON.parse(zstdDecompressSync(clip.body.subarray(32,boundary)));
  assert.equal(index.replayId,job.id);
  assert.equal(index.tickCount,end-start);
  assert.equal(reads.length,5); // Header, index and three overlapping chunks.
  const decoded=index.chunks.flatMap(c=>{
    const bytes=clip.body.subarray(boundary+c.offset,boundary+c.offset+c.compressedBytes);
    assert.equal(sha(bytes),c.compressedSha256);
    return codec.decodeReplayDeltaChunk(zstdDecompressSync(bytes)).ticks;
  });
  assert.deepEqual(decoded,ticks.slice(start,end));
  assert.deepEqual(clip.body,(await cutClip(job,read,codec)).body);
  const last=reads[4];
  const corrupt=Buffer.from(body);
  corrupt[last[0]]^=1;
  await assert.rejects(cutClip(job,async (at,n)=>corrupt.subarray(at,at+n),codec));
});
