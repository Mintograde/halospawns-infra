import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeMatchReplay} from '../runtime/pack-match-replay.mjs';
import {openMatchReplay,validateMatchReplay,ROSTER_MATCH_PROJECTION,COMPACT_MATCH_PROJECTION} from '../runtime/match-replay.mjs';

test('roster failures preserve the verified host and recorded sections without a client world',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'h1-roster-match-'));
  try {
    const world=Buffer.alloc(40);world.write('HSRDC002');world.writeUInt32LE(1,16);
    const host={id:'host',role:'host',status:'available',source_film_sha256:'1'.repeat(64),frame_count:2,first_update:0,
      viewer_revision:5,world:'host/world',verification:{played_ticks:2,seed_mismatches:0,hash_mismatches:0,hash_checks:1}};
    const client={id:'client-0',role:'client',status:'unavailable',source_film_sha256:'2'.repeat(64),frame_count:2,first_update:0,
      recorded_own_player:1,ends_early:false,recorded_trust:{inputs:1,messages:1},clocks:[{frame:0,game_tick:1}],
      alignment:{method:'unavailable',reason:'client_account_not_recorded'},recorded_sections:{roster:'client-0/recorded/roster'},
      failure:{reason:'roster_mismatch',played_ticks:2,seed_mismatches:0,hash_mismatches:0,hash_checks:1,
        control_pushes:8,network_applied:5,network_refused:0,recorded_player_count:4,exported_player_indices:[0,1,2,3,4]}};
    const identity={sourceContract:{schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:9,
      projection_sha256:ROSTER_MATCH_PROJECTION,tick_count:2},source_film_sha256:'3'.repeat(64),raw_map_sha256:'4'.repeat(64),
      engine_profile:'h1-performance-beta6-p9839-wasm-v1',wasm_sha256:'5'.repeat(64),glue_sha256:'6'.repeat(64),match_id:'1234567890123456'};
    const recorded=Buffer.from('retained original roster');
    const entries=[{id:'host/world',kind:'world',compression:'identity',bytes:world},
      {id:'client-0/recorded/roster',kind:'recorded-section',compression:'identity',bytes:recorded}];
    const path=join(dir,'match.hsrv');await writeMatchReplay(path,identity,[host,client],entries);
    const bytes=await readFile(path),opened=await openMatchReplay(async(at,n)=>bytes.subarray(at,at+n));
    assert.equal(opened.header.version,4);
    assert.deepEqual(opened.manifest.tracks[1],client);
    assert.deepEqual(Buffer.from(await opened.readEntry('host/world')),world);
    assert.deepEqual(Buffer.from(await opened.readEntry('client-0/recorded/roster')),recorded);
    for(const mutate of [
      m=>m.tracks[0]={...client,id:'host',role:'host'},
      m=>m.tracks[1].world='host/world',m=>m.tracks[1].failure.seed_mismatches=1,
      m=>m.tracks[1].failure.played_ticks=1,m=>m.tracks[1].failure.network_refused=1,
      m=>m.tracks[1].failure.exported_player_indices=[0,1,2,3],
      m=>m.tracks[1].failure.exported_player_indices=[0,0],
      m=>m.tracks[1].failure.exported_player_indices=[0,16],
      m=>m.tracks[1].failure.first_mismatch_update=0,
    ]){const bad=structuredClone(opened.manifest);mutate(bad);assert.throws(()=>validateMatchReplay(bad,opened.header));}
    await assert.rejects(writeMatchReplay(join(dir,'old.hsrv'),{...identity,sourceContract:{...identity.sourceContract,
      profile_revision:8,projection_sha256:COMPACT_MATCH_PROJECTION}},[host,client],entries),/desync evidence/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
