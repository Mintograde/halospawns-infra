import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeMatchReplay} from '../runtime/pack-match-replay.mjs';
import {openMatchReplay,validateMatchReplay,readMatchReplayHeader,PARTIAL_MATCH_PROJECTION} from '../runtime/match-replay.mjs';

const identity={sourceContract:{schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:6,
  projection_sha256:'17891e012b67f5b7e998cf1cc724a1728d18b3df5556559e90fc4ee47c0dc2c2',tick_count:2},
  source_film_sha256:'1'.repeat(64),raw_map_sha256:'2'.repeat(64),engine_profile:'h1-performance-beta6-p9839-wasm-v1',
  wasm_sha256:'3'.repeat(64),glue_sha256:'4'.repeat(64),match_id:'0123456789abcdef'};
function tracks() {
  return Array.from({length:17},(_,i)=>({id:i?`client-${i-1}`:'host',role:i?'client':'host',source_film_sha256:'5'.repeat(64),
    frame_count:2,first_update:0,viewer_revision:5,world:`${i?`client-${i-1}`:'host'}/world`,
    verification:{seed_mismatches:0,hash_mismatches:0,hash_checks:1,played_ticks:2,control_pushes:2},
    ...(i?{recorded_own_player:i-1,ends_early:i===16,recorded_trust:{inputs:i%3,messages:1,reason:'recorded'},
      clocks:[{frame:0,game_tick:30}],alignment:{method:'unavailable',reason:'client_account_not_recorded'}}:{})}));
}

test('one file retains all sixteen independently identified clients and bounds every range',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'h1-match-'));
  try {
    const world=Buffer.alloc(40);world.write('HSRDC002');world.writeUInt32LE(1,16);
    const ts=tracks(),path=join(dir,'match.hsrv');
    const packed=await writeMatchReplay(path,identity,ts,ts.map(t=>({id:t.world,kind:'world',compression:'identity',bytes:world})));
    const bytes=await readFile(path),requests=[];
    const reader=await openMatchReplay(async(start,length)=>{requests.push([start,length]);return bytes.subarray(start,start+length);},
      {size_bytes:bytes.length,manifest_sha256:packed.manifest_sha256});
    assert.equal(reader.manifest.tracks.length,17);
    assert.equal(reader.manifest.tracks[16].ends_early,true);
    assert.equal(reader.manifest.tracks[2].recorded_trust.inputs,2);
    assert.deepEqual(await reader.readEntry('client-15/world'),world);
    assert.deepEqual(await reader.rangeReader('client-0/world')(2,5),world.subarray(2,7));
    await assert.rejects(reader.rangeReader('client-0/world')(39,2),/outside entry/);
    await assert.rejects(openMatchReplay(async(start,length)=>bytes.subarray(start,start+length),{manifest_sha256:'0'.repeat(64)}),/descriptor/);
    const h=readMatchReplayHeader(bytes.subarray(0,64));
    for(const mutate of [
      m=>m.tracks[1].verification.hash_mismatches=1,
      m=>m.tracks[1].world='host/world',
      m=>m.sourceContract.tick_count=3,
      m=>m.entries[1].offset++,
      m=>delete m.entries[0].index_sha256,
      m=>m.tracks[1].clocks[0].frame=1,
      m=>m.tracks[1].tables=[{kind:'client',name:'aim',count:1,stride:28,capped:false,entry:'host/world',chunks:[]}],
    ]) {const bad=structuredClone(packed.manifest);mutate(bad);assert.throws(()=>validateMatchReplay(bad,h));}
    bytes[64]^=1;
    await assert.rejects(openMatchReplay(async(start,length)=>bytes.subarray(start,start+length)),/manifest hash/);
    assert.equal(requests[0][1],64);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('unavailable clients retain stable identities without publishing a failed world',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'h1-partial-'));
  try {
    const ts=tracks().slice(0,3).map(t=>({...t,status:'available'}));
    const t=ts[1];t.status='unavailable';delete t.world;delete t.verification;delete t.viewer_revision;
    t.failure={reason:'simulation_desync',played_ticks:2,seed_mismatches:1,hash_mismatches:0,hash_checks:1,
      control_pushes:8,first_mismatch_update:1,network_applied:3,network_refused:1};
    const world=Buffer.alloc(40);world.write('HSRDC002');world.writeUInt32LE(1,16);
    const packed=await writeMatchReplay(join(dir,'match.hsrv'),{...identity,sourceContract:{...identity.sourceContract,
      profile_revision:7,projection_sha256:PARTIAL_MATCH_PROJECTION}},ts,
      ts.filter(t=>t.world).map(t=>({id:t.world,kind:'world',compression:'identity',bytes:world})));
    const bytes=await readFile(join(dir,'match.hsrv')),h=readMatchReplayHeader(bytes.subarray(0,64));
    const opened=await openMatchReplay(async(start,n)=>bytes.subarray(start,start+n));
    assert.equal(opened.manifest.tracks[2].id,'client-1');assert.equal(opened.manifest.entries.length,2);
    for(const mutate of [m=>m.tracks[0]= {...m.tracks[1],id:'host',role:'host'},
      m=>m.tracks[1].world='client-0/world',m=>m.tracks[1].failure.played_ticks=1,
      m=>m.tracks[1].failure.seed_mismatches=0,m=>m.tracks[2].verification.hash_mismatches=1,
      m=>m.schema='halospawns.h1MatchReplay.v1']) {
      const bad=structuredClone(packed.manifest);mutate(bad);assert.throws(()=>validateMatchReplay(bad,h));
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
