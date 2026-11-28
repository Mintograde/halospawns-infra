import assert from 'node:assert/strict';
import test from 'node:test';
import {zstdCompressSync, zstdDecompressSync} from 'node:zlib';
import * as codec from '../../../halospawns-svelte/packages/viewer/src/lib/core/session/replayDeltaCodec.js';
import {cutClip, sha} from './cut.mjs';
import {packRuns, slicePoseRuns} from './pose.mjs';
import {clientInterval} from './perspective.mjs';
import {clipKillFeed} from './feed.mjs';
import {mapViewFrame} from '../../../halospawns-svelte/packages/viewer/src/lib/core/session/viewTrackAlignment.js';

test('trimming a pose run restarts both predictors and preserves a literal fallback', () => {
  function short(value) {
    const bytes=Buffer.alloc(2);
    bytes.writeUInt16LE(value);
    return bytes;
  }
  function channel(mode,initial,residuals=[]) {
    const header=Buffer.alloc(5);
    header[0]=mode;
    header.writeInt32LE(initial,1);
    return Buffer.concat([header,Buffer.from(residuals.map(n=>n<0 ? -2*n-1 : 2*n))]);
  }
  const matrices=Buffer.alloc(13*8);
  for(let i=0;i<13;i++) matrices.writeDoubleLE(i===0?-0:i/3,i*8);
  const constants=Array.from({length:6},()=>channel(0,42));
  // One bone on player 1. The second-order track reconstructs 5, 7, 12, 20, 31.
  function run(start,count,tracks,literals) {
    return Buffer.concat([short(start),Buffer.from([1]),short(count),Buffer.from([1,0]),
      ...tracks,...constants,short(literals.length),...literals.flatMap(frame=>[short(frame),matrices])]);
  }
  const source=packRuns([run(0,5,[channel(2,5,[2,3,3,3]),channel(1,6,[-1,-1,-1,-1])],[1,3])]);
  assert.deepEqual(slicePoseRuns(source,5,2,5,9),[
    run(9,3,[channel(2,12,[8,3]),channel(1,4,[-1,-1])],[1])
  ]);
});

function fixture(count, players = {}, marker = 0, revision = 2) {
  const ticks = Array.from({length:count}, (_,i) => ({game_time:i,players:[{name:'Test',x:i + marker}]}));
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
    replay:{game_meta:{map_name:'Fallout',players},events:['11: outside','13: inside','25: outside']},
    sourceContract:{profile_revision:revision,tick_count:count}}));
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

test('aligned cuts agree with full replay seeks including gaps, clock corrections and ambiguous times', () => {
  const host = {id:'host',role:'host',frame_count:350,first_update:0};
  const client = {id:'client-0',role:'client',frame_count:100,clocks:[{frame:0,game_tick:50}],
    alignment:{rows:[[-1,-1],[50,100],[70,121],[71,121],[94,145],[93,144],[145,199]]}};
  for (const clocks of [client.clocks, [{frame:0,game_tick:50},{frame:38,game_tick:101}],
    [{frame:0,game_tick:50},{frame:38,game_tick:75}]]) {
    const track = {...client, clocks};
    for (let start = 95; start <= 201; start++) {
      const end = start + 8;
      const mapped = Array.from({length:end-start}, (_,i) => mapViewFrame({tracks:[host,track]},host.id,track.id,start+i));
      const valid = mapped.every((n,i) => n !== null && (!i || n >= mapped[i-1]));
      assert.deepEqual(clientInterval(host,track,start,end),valid ? {start:mapped[0],end:mapped.at(-1)+1} : null);
      if (valid) assert.deepEqual(clientInterval(host,track,start,end,true).hostFrames,mapped);
    }
  }
});

test('a separately recorded client uses its own clock, roster slot, events and original frames', async () => {
  const host = fixture(100, {0:{name:'Other'},2:{name:'Subject'}}, 0, 5);
  const client = fixture(100, {0:{name:'Subject'},2:{name:'Other'}}, 500, 5);
  const id = 'id', hostId = 'host-id', digest = '1'.repeat(64), clockDigest = '2'.repeat(64);
  const timeline = {contract:'halospawns.h1ClientViewTimeline.v1',attempt_id:id,host_artifact_id:hostId,
    source_film_sha256:digest,clock_source_film_sha256:clockDigest,frame_count:100,first_update:10,
    alignment_method:'beta5-client-clock-v1',clocks:[{frame:0,game_tick:11}],alignment_rows:[[11,30],[39,59],[80,100]]};
  const bytes = Buffer.from(JSON.stringify(timeline));
  const source = {size_bytes:host.body.length,tick_count:100,world_revision:5,sha256:sha(host.body)};
  const view = {id,source_film_sha256:digest,clock_source_film_sha256:clockDigest,frame_count:100,
    first_update:10,recorded_own_player:0,tick_rate:120,timeline:{size_bytes:bytes.length,sha256:sha(bytes)},
    artifact:{size_bytes:client.body.length},host_track:{id:'host',generation_id:hostId,frame_count:100,
      first_update:0,artifact:{sha256:source.sha256}}};
  const job = {id:'clip',artifact_id:hostId,player_slot:2,player_name:'Subject',start:41,end:51,
    source_start:41,source_end:51,rate:120,source,views:[view]};
  const read = buf => async (at,n) => buf.subarray(at,at+n);
  const objectReader = async ref => read(ref === view.artifact ? client.body : bytes);
  const cut = args => cutClip(args,read(host.body),codec,objectReader);
  const result = await cut(job);
  assert.deepEqual(result.pov,{track_id:'client-'+digest,player_slot:0,start_frame:12,end_frame:22,
    host_start_frame:41,host_end_frame:51});
  assert.deepEqual(result.view_attempts,[id]);
  const payload = 32 + result.body.readUInt32LE(16);
  const index = JSON.parse(zstdDecompressSync(result.body.subarray(32,payload)));
  assert.deepEqual(index.replay.events,['13: inside']);
  assert.deepEqual(codec.decodeReplayDeltaChunk(zstdDecompressSync(result.body.subarray(payload))).ticks, client.ticks.slice(12,22));
  const feedJob = {...job, source_stride:1, feed_events:[{source_tick:42, kind:'kill', killer_slot:2, victim_slot:0},
    {source_tick:49, kind:'kill', killer_slot:0, victim_slot:2}]};
  const withFeed = await cut(feedJob);
  assert.deepEqual(withFeed.kill_feed,[{frame:1,text:'Subject killed Other'},{frame:8,text:'Other killed Subject'}]);
  assert.deepEqual(withFeed.body,result.body);
  const previous = {pov:result.pov, tick_count:result.tick_count, sha256:sha(result.body)};
  const refresh = await cut({...feedJob, previous});
  assert.equal(refresh.body,undefined);
  assert.equal(refresh.sha256,previous.sha256);
  assert.deepEqual(refresh.kill_feed,withFeed.kill_feed);
  assert.equal((await cut({...job,views:[{...view,recorded_own_player:2}]})).pov.track_id,'host');
  assert.equal((await cut({...job,views:[view,view]})).pov.track_id,'host');
  assert.equal((await cut({...job,start:10})).pov.track_id,'host');
  await assert.rejects(cut({...job,artifact_id:'another generation'}));
  await assert.rejects(cut({...job,views:[{...view,clock_source_film_sha256:digest}]}));
});

test('feed uses the first recorded frame at or after each death and preserves callback order', () => {
  const names = {0:'Cupid',1:'Dasher',2:'Prancer'};
  const death = (source_tick,kind,killer_slot,victim_slot,multikill) =>
    ({source_tick,kind,killer_slot,victim_slot,multikill});
  const job = {source_stride:4,start:10,end:15,feed_events:[
    death(40,'kill',0,1),death(41,'kill',0,2,2),death(41,'betrayal',1,0),
    death(48,'suicide',0,0),death(51,'environment',null,2),death(56,'unknown',null,0),death(57,'kill',0,1)]};
  const selected = {start:20,end:26,hostFrames:[20,20,22,24,25]};
  assert.deepEqual(clipKillFeed(job,selected,names),[
    {frame:0,text:'Cupid killed Dasher'},{frame:0,text:'Cupid killed Prancer'},{frame:0,text:'Double Kill!'},
    {frame:0,text:'Dasher betrayed Cupid'},{frame:2,text:'Cupid committed suicide'},
    {frame:4,text:'Prancer died'},{frame:5,text:'Cupid died'}]);
});

test('a recording without a native ledger retains explicit obituaries and lone deaths', () => {
  const job = {source_stride:1,start:10,end:14,source_start:10,source_end:14,feed_events:null};
  const selected = {start:10,end:14,hostWorld:{manifest:{replay:{events:[
    '9: Old died (1)','10: Cupid got a kill (2)','10: Dasher died (3)','11: Prancer threw a frag grenade',
    '12: Comet killed Vixen','14: Late died (7)']}}}};
  assert.deepEqual(clipKillFeed(job,selected,{}),[{frame:0,text:'Dasher died'},{frame:2,text:'Comet killed Vixen'}]);
});
