import assert from 'node:assert/strict';
import test from 'node:test';
import {observeDamageOwner,recoverInitialRoster,recoveryEngineValue} from '../runtime/roster-recovery.mjs';

function evidence(count=10) {
  const owners=new Map();
  for(let slot=8;slot<count;slot++) {
    const payload=Buffer.alloc(108);
    payload.writeInt32LE((0xec780000+slot*65536+slot)|0,32);
    payload.writeInt16LE(slot,40);
    observeDamageOwner(owners,payload,1);
    observeDamageOwner(owners,payload,119);
  }
  return {players:8,firstTick:0,ticks:120,localPlayers:1,initialMask:2**count-1,
    maskChanged:false,rosterChanged:false,observedMask:2**count-1,owners,
    teams:0x76543210,ffa:true,namesSize:196};
}

test('recovers only missing FFA slots, bounded through sixteen players',()=>{
  for(let count=9;count<=16;count++) {
    const proof=recoverInitialRoster(evidence(count));
    assert.equal(proof.initial_player_count,count);
    assert.equal(proof.recovered_players.length,count-8);
    assert.equal(proof.recovered_players[0].damage_record_count,2);
    assert.ok(!JSON.stringify(proof).includes('name'));
    assert.equal(recoveryEngineValue(proof).split(',').length,1+(count-8)*2);
  }
  assert.equal(recoverInitialRoster({...evidence(),initialMask:255}),undefined);
});

test('rejects ambiguous initial masks, roster changes, teams and incomplete evidence',()=>{
  for(const patch of [{players:7},{firstTick:1},{localPlayers:2},{ffa:false},{namesSize:0},
    {initialMask:767},{maskChanged:true},{rosterChanged:true},{observedMask:2047},
    {teams:0},{ticks:119},{owners:new Map()}]) {
    assert.throws(()=>recoverInitialRoster({...evidence(),...patch}));
  }
  for(const patch of [{conflict:true},{team:1},{player_handle:8}]) {
    const value=evidence();Object.assign(value.owners.get(8),patch);
    assert.throws(()=>recoverInitialRoster(value));
  }
});

test('damage evidence refuses changed handles or teams and ignores non-player owners',()=>{
  for(const changed of ['team','handle']) {
    const value=evidence(),payload=Buffer.alloc(108);
    payload.writeInt32LE(value.owners.get(8).player_handle+(changed==='handle'?65536:0),32);
    payload.writeInt16LE(changed==='team'?9:8,40);
    observeDamageOwner(value.owners,payload,119);
    assert.throws(()=>recoverInitialRoster(value));
  }
  const owners=new Map(),payload=Buffer.alloc(108);payload.writeInt32LE(-1,32);
  observeDamageOwner(owners,payload,1);assert.equal(owners.size,0);
});
