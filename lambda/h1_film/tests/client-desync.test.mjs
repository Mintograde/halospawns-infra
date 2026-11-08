import assert from 'node:assert/strict';
import test from 'node:test';
import {completedClientDesync,ClientDesync,clientDesyncEvidence,canVerifyRejectedClient} from '../runtime/client-desync.mjs';
const envelope={ticks:25387,hash_samples:212,first_update:0,network:{applications:176520}};
const log=`[film] played 25387 ticks of "input.h1film"
[film] network changes put back: 176450, 70 refused (an object the replay does not have)
[film] self-check: 86 seed mismatches, 83 of 212 hash samples differed, 101548 control pushes
[film] VERDICT: DESYNCED, first at update 480`;

test('roster rejection permits only verification of new embedded clients, never publication',()=>{
  const profile={port:'beta6',exporter_revision:17};
  const values={'embedded-match':true,'client-view':true};
  const report={encoder_exit:{code:1}};
  const rejection='h1-film-encoder: film roster does not match engine export\n';
  assert.equal(canVerifyRejectedClient(profile,values,report,rejection),true);
  for(const p of [{...profile,port:'beta5'},{...profile,exporter_revision:15}])
    assert.equal(canVerifyRejectedClient(p,values,report,rejection),false);
  for(const v of [{...values,'embedded-match':false},{...values,'client-view':false}])
    assert.equal(canVerifyRejectedClient(profile,v,report,rejection),false);
  for(const r of [{},{encoder_exit:{code:0}},{encoder_exit:{code:null,signal:'SIGKILL'}}])
    assert.equal(canVerifyRejectedClient(profile,values,r,rejection),false);
  for(const error of ['other encoder error',rejection+'additional failure'])
    assert.equal(canVerifyRejectedClient(profile,values,report,error),false);
  assert.equal(clientDesyncEvidence(new Error(rejection)),null);
});
test('only completed client desyncs carry bounded failure evidence',()=>{
  const evidence=completedClientDesync(log,envelope);
  assert.equal(evidence.first_mismatch_update,480);assert.equal(evidence.network_refused,70);
  assert.deepEqual(clientDesyncEvidence(new Error('diagnostics',{cause:new ClientDesync(evidence)})),evidence);
  assert.equal(clientDesyncEvidence(new Error('Simulation diverged')),null);
  for(const bad of [log.replace('played 25387','played 25386'),log.replace('of 212','of 211'),
    log.replace('176450','176449'),log.replace('VERDICT: DESYNCED','VERDICT: clean'),
    log.replace('update 480','update 25387'),log+'\nRECORDED BY ANOTHER BUILD',log+'\nNOT ONE CONTROL PUSH'])
    assert.equal(completedClientDesync(bad,envelope),null);
});
