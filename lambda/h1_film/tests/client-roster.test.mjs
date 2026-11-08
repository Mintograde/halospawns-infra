import assert from 'node:assert/strict';
import test from 'node:test';
import {completedClientRosterMismatch,ClientRosterMismatch,clientRosterEvidence,rejectedClientRoster} from '../runtime/client-roster.mjs';
import {canVerifyRejectedClient,completedClientDesync} from '../runtime/client-desync.mjs';
const envelope={ticks:48778,players:4,hash_samples:407,first_update:0,network:{records:295720,applications:295717}};
const roster={recorded_player_count:4,exported_player_indices:[0,1,2,3,4]};
const encode=value=>'h1-film-encoder: client initial roster mismatch: '+JSON.stringify(value)+'\n';
const log=`[film] played 48778 ticks of "input.h1film"
[film] network changes put back: 295717, 0 refused (an object the replay does not have)
[film] self-check: 0 seed mismatches, 0 of 407 hash samples differed, 195112 control pushes
[film] VERDICT: clean -- every replayed tick matched the recording`;

test('initial roster mismatch is separate from desync and requires full clean verification',()=>{
  const evidence=completedClientRosterMismatch(log,envelope,encode(roster));
  assert.deepEqual(evidence,{reason:'roster_mismatch',played_ticks:48778,seed_mismatches:0,hash_mismatches:0,
    hash_checks:407,control_pushes:195112,network_applied:295717,network_refused:0,...roster});
  assert.equal(completedClientDesync(log,envelope),null);
  assert.deepEqual(clientRosterEvidence(new Error('context',{cause:new ClientRosterMismatch(evidence)})),evidence);
  assert.equal(clientRosterEvidence(new Error(encode(roster))),null);
  for(const bad of [log.replace('48778','48777'),log.replace('of 407','of 406'),log.replace('295717','295716'),
    log.replace('0 refused','1 refused'),log.replace('0 seed','1 seed'),log.replace('0 of','1 of'),
    log.replace('195112 control','0 control'),log.replace('VERDICT: clean','VERDICT: DESYNCED'),log+'\nRECORDED BY ANOTHER BUILD'])
    assert.equal(completedClientRosterMismatch(bad,envelope,encode(roster)),null);
  assert.equal(completedClientRosterMismatch(log,{...envelope,players:3},encode(roster)),null);
});

test('roster evidence cannot bypass old recipes or classify another encoder error',()=>{
  const p={port:'beta6',exporter_revision:18},v={'embedded-match':true,'client-view':true},r={encoder_exit:{code:1}};
  assert.equal(canVerifyRejectedClient(p,v,r,encode(roster)),true);
  for(const old of [14,15,16,17])assert.equal(canVerifyRejectedClient({...p,exporter_revision:old},v,r,encode(roster)),false);
  for(const values of [{},{'embedded-match':true},{'client-view':true}])assert.equal(canVerifyRejectedClient(p,values,r,encode(roster)),false);
  for(const report of [{},{encoder_exit:{code:null,signal:'SIGKILL'}},{encoder_exit:{code:0}}])
    assert.equal(canVerifyRejectedClient(p,v,report,encode(roster)),false);
  for(const change of [{recorded_player_count:0},{exported_player_indices:[]},{exported_player_indices:[0,1,2,3]},
    {exported_player_indices:[0,0]},{exported_player_indices:[0,16]},{exported_player_indices:[true,2]},
    {exported_player_indices:Array.from({length:17},(_,i)=>i)},{extra:'ignored'}])assert.equal(rejectedClientRoster(encode({...roster,...change})),null);
  for(const bad of ['unrelated error',encode(roster)+'other failure',encode(null)])assert.equal(rejectedClientRoster(bad),null);
});
