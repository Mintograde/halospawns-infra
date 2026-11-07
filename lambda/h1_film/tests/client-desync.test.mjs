import assert from 'node:assert/strict';
import test from 'node:test';
import {completedClientDesync,ClientDesync,clientDesyncEvidence} from '../runtime/client-desync.mjs';
const envelope={ticks:25387,hash_samples:212,first_update:0,network:{applications:176520}};
const log=`[film] played 25387 ticks of "input.h1film"
[film] network changes put back: 176450, 70 refused (an object the replay does not have)
[film] self-check: 86 seed mismatches, 83 of 212 hash samples differed, 101548 control pushes
[film] VERDICT: DESYNCED, first at update 480`;
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
