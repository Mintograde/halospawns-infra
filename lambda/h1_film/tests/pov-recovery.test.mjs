import assert from 'node:assert/strict';
import test from 'node:test';
import {TABLES} from '../runtime/diagnostics-codec.mjs';
import {preparePovRecovery,finishPovRecovery,IncompletePovRecovery} from '../runtime/pov-recovery.mjs';

function fixture({duplicate=false,capped=false}={}) {
  const rosterOffset=512, optionsOffset=600, optionsSize=13860;
  function film(pistol,sniper) {
    const bytes=Buffer.alloc(optionsOffset+optionsSize);
    bytes.writeUInt32LE(optionsOffset,72);bytes.writeUInt32LE(optionsSize,76);
    bytes.writeUInt32LE(rosterOffset,456);bytes.writeUInt32LE(48,460);
    bytes.writeUInt32LE(1,rosterOffset+4);bytes.write('Recorder',rosterOffset+20,'utf16le');
    bytes.writeFloatLE(pistol,optionsOffset+13228);bytes.writeFloatLE(sniper,optionsOffset+13244);
    return bytes;
  }
  const host=film(-1,-1),client=film(4,1.5),rows=duplicate?2:1;
  const acc=Buffer.alloc(160+48*rows);
  acc.write('LDC1');acc.writeUInt32LE(12,4);acc.writeUInt32LE(160,8);acc.writeUInt32LE(14,20);
  for(const [i,[name,stride]] of [...TABLES.client,['packed',1]].entries()) {
    acc.writeUInt32LE(stride,52+i*8);
    if(name==='pulls') {
      acc.writeUInt32LE(rows,48+i*8);
      if(capped)acc.writeUInt32LE(1<<i,12);
    }
  }
  for(let i=0;i<rows;i++)acc.writeFloatLE(1,160+i*48+28);
  const raw=Buffer.concat([host,acc]),match={host_offset:0,host_size:host.length,host:{match_id:'1234'}};
  const track={source_film_sha256:'a'.repeat(64),part:{account_offset:host.length,account_size:acc.length,player:0},
    envelope:{protocol_revision:9844,match_id:'1234',recorded_own_player:0,recorded_local_player_mask:1,
      network:{applications:12}}};
  const failure={reason:'simulation_desync'};
  return {raw,client,match,track,failure,plan:()=>preparePovRecovery(raw,match,track,client,failure)};
}

test('recovery binds the recorded player, match, tuning values and complete unique rounds',()=>{
  const valid=fixture(),plan=valid.plan();
  assert.equal(plan.rounds,1);
  assert.deepEqual(plan.receipt.client_autoaim_degrees,[4,1.5]);
  assert.deepEqual(plan.receipt.host_autoaim_degrees,[-1,-1]);
  for(const edit of [
    f=>{f.track.envelope.recorded_local_player_mask=0;},
    f=>{f.track.envelope.match_id='0000';},
    f=>{f.failure.reason='roster_mismatch';},
    f=>{f.track.part.account_size=0;},
    f=>{f.client.write('Different',532,'utf16le');},
    f=>{f.client.writeFloatLE(-1,13828);f.client.writeFloatLE(-1,13844);},
    f=>{f.raw.writeFloatLE(NaN,f.track.part.account_offset+188);},
  ]) {
    const f=fixture();edit(f);assert.equal(f.plan(),null);
  }
  assert.equal(fixture({duplicate:true}).plan(),null);
  assert.equal(fixture({capped:true}).plan(),null);
});

test('a verified engine run must apply the host rules and bind every round exactly once',()=>{
  const plan=fixture().plan();
  const summary=(rules,matched,changed,rejected)=>`[pov-recovery] rules=${rules} rounds=1 matched=${matched} changed=${changed} rejected=${rejected}`;
  assert.equal(finishPovRecovery(summary(1,1,0,0),plan).method,'host_rules');
  assert.equal(finishPovRecovery(summary(2,1,1,0),plan).method,'host_rules_and_recorded_directions');
  for(const args of [[0,1,0,0],[1,0,0,0],[1,1,1,1],[1,1,2,0]])
    assert.throws(()=>finishPovRecovery(summary(...args),plan),IncompletePovRecovery);
  assert.throws(()=>finishPovRecovery('',plan),/summary/);
});
