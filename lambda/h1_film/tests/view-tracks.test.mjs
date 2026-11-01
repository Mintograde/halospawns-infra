import test from 'node:test';
import assert from 'node:assert/strict';
import {VIEW_TRACKS_SCHEMA,validateViewTracks,mapViewFrame,mapRecordedClock,bindViewTimelines} from '../runtime/view-tracks.mjs';
import {createHash} from 'node:crypto';
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),id='client-'+b;
function manifest() {
  const track=(role,source,frames)=>({id:role==='host'?'host':id,role,source_film_sha256:source,
    frame_count:frames,first_update:0,exporter_revision:13,wasm_sha256:a,glue_sha256:b,
    artifact:{path:(role==='host'?'host':id)+'/replay.120hz.hsrdc',sha256:c,size_bytes:100,viewer_revision:5}});
  return {schema:VIEW_TRACKS_SCHEMA,match_id:'134c2a61fc9fa7dd',engine_profile:'h1-performance-beta5-p9818-wasm-v1',raw_map_sha256:c,
    tick_rate:120,authoritative_track:'host',tracks:[track('host',a,1000),{...track('client',b,100),
      recorded_own_player:2,clocks:[{frame:0,game_tick:500}],
      alignment:{method:'beta5-client-clock-v1',source_film_sha256:a,rows:[[500,510],[550,560],[599,609]]}}]};
}
test('late client coverage aligns both directions and never clamps outside the track',()=>{
  const m=validateViewTracks(manifest());
  assert.equal(mapViewFrame(m,'host',id,509),0);
  assert.equal(mapViewFrame(m,id,'host',0),509);
  assert.equal(mapViewFrame(m,'host',id,529),20);
  for(const frame of [0,508,609,999,1000,-1,0.5])assert.equal(mapViewFrame(m,'host',id,frame),null);
  assert.equal(mapViewFrame(m,id,'host',100),null);
});
test('forward clock jumps leave unavailable ranges; repeated time is ambiguous',()=>{
  const m=manifest();m.tracks[1].clocks.push({frame:50,game_tick:575});validateViewTracks(m);
  assert.equal(mapViewFrame(m,'host',id,569),null);
  assert.equal(mapViewFrame(m,'host',id,584),50);
  m.tracks[1].clocks[1].game_tick=525;
  assert.equal(mapViewFrame(m,'host',id,539),null);
});
test('unknown clock samples do not become identity mapping or extrapolated coverage',()=>{
  assert.equal(mapRecordedClock([],40,true),null);
  assert.equal(mapRecordedClock([[10,12],[20,30]],11,true),null);
  assert.equal(mapRecordedClock([[10,12],[20,30]],31,true),null);
  assert.equal(mapRecordedClock([[10,12],[20,30]],29,true),20);
});
test('manifest binds artifacts and clock evidence to their source tracks',()=>{
  const lateJoin=manifest();lateJoin.tracks[1].recorded_own_player=15;
  validateViewTracks(lateJoin);
  for(const mutate of [
    m=>m.tracks[1].artifact.path='../host/replay.120hz.hsrdc',
    m=>m.tracks[1].alignment.source_film_sha256=b,
    m=>m.tracks[1].clocks[0].frame=1,
    m=>m.tracks[1].clocks.push({frame:0,game_tick:510}),
    m=>m.tracks[1].exporter_revision=12,
    m=>m.tracks[1].recorded_own_player=16,
    m=>m.tracks[1].source_film_sha256=a,
    m=>m.authoritative_track=id,
  ]) {const m=manifest();mutate(m);assert.throws(()=>validateViewTracks(m));}
});

function hosted() {
  const m=manifest(),generation='11111111-1111-4111-8111-111111111111',attempt='22222222-2222-4222-8222-222222222222';
  Object.assign(m,{available:true,package_id:a,replay_id:attempt,host_artifact_id:generation});
  for(const t of m.tracks) {
    t.generation_id=t.role==='host'?generation:attempt;
    delete t.artifact.path;
    Object.assign(t.artifact,{url:'https://example.com/world?versionId=immutable',method:'GET',type:'cloudfront',expires_at:null});
  }
  const t=m.tracks[1];
  // A client's independently verified recording-machine host may differ from the displayed host.
  t.alignment.source_film_sha256=c;
  const timeline={contract:'halospawns.h1ClientViewTimeline.v1',attempt_id:attempt,host_artifact_id:generation,
    source_film_sha256:b,clock_source_film_sha256:c,frame_count:t.frame_count,first_update:t.first_update,
    clocks:t.clocks,alignment_method:t.alignment.method,alignment_rows:t.alignment.rows};
  delete t.clocks;delete t.alignment.rows;
  const bytes=new TextEncoder().encode(JSON.stringify(timeline));
  t.timeline={schema:timeline.contract,sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length,
    url:'https://example.com/timeline?versionId=immutable',method:'GET',type:'cloudfront',expires_at:null};
  return {m,bytes};
}
test('hosted clocks require original hashed timeline bytes and bind independent clock sources',async()=>{
  const {m,bytes}=hosted();validateViewTracks(m);
  assert.equal(mapViewFrame(m,'host',id,509),null);
  const ready=await bindViewTimelines(m,{[id]:bytes});
  assert.equal(mapViewFrame(ready,'host',id,509),0);
  assert.equal(mapViewFrame(ready,id,'host',99),608);
  assert.equal(mapViewFrame(ready,'host',id,999),null);
  assert.equal(m.tracks[1].clocks,undefined);
  for(const mutate of [
    m=>m.tracks[1].generation_id=m.host_artifact_id,
    m=>m.tracks[1].alignment.source_film_sha256=a,
    m=>m.tracks[1].timeline.sha256=a,
    m=>m.tracks[1].frame_count++,
  ]) {const changed=structuredClone(m);mutate(changed);await assert.rejects(bindViewTimelines(changed,{[id]:bytes}));}
});
