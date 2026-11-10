import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyNetworkHost} from '../runtime/network-host.mjs';

const classify=(change={})=>classifyNetworkHost({players:6,localPlayers:1,initialDropMask:49,
  observedRemoteMask:113,firstTick:0,initialRosterChanged:false,initialMaskChanged:false,...change});
const start=bots=>({start:{kind:'start_item_v1',bot_count:bots,world_hash:'1234567890abcdef'}});

test('remote first player proves neutral with bots and a later viewing client',()=>{
  const host=classify();
  assert.deepEqual(host.host_slots,[]);assert.deepEqual(host.bot_slots,[1,2,3]);
  assert.equal(host.local_player_count,0);
  assert.deepEqual(host.roster_evidence,{kind:'initial_remote_player_v1'});
});

test('actual starting bots distinguish dedicated and player-hosted games at every seat count',()=>{
  for(let locals=0;locals<=4;locals++)for(let bots=0;bots<=15-locals;bots++) {
    const players=locals+bots+1,remote=1<<(players-1);
    const h=classify({players,localPlayers:locals||1,initialDropMask:remote,
      observedRemoteMask:remote,rosterEvidence:start(bots)});
    assert.ok(h,`${locals} humans/${bots} bots`);
    assert.deepEqual(h.host_slots,Array.from({length:locals},(_,i)=>i));
    assert.deepEqual(h.bot_slots,Array.from({length:bots},(_,i)=>i+locals));
  }
  const onlyBots=classify({players:3,initialDropMask:0,observedRemoteMask:0,rosterEvidence:start(3)});
  assert.deepEqual(onlyBots.host_slots,[]);assert.deepEqual(onlyBots.bot_slots,[0,1,2]);
});

test('host rounds identify humans without marking bots as hosts',()=>{
  const h=classify({players:5,initialDropMask:16,observedRemoteMask:16,
    rosterEvidence:{rounds:{kind:'host_rounds_v1',local_player_mask:1}}});
  assert.deepEqual(h.host_slots,[0]);assert.deepEqual(h.bot_slots,[1,2,3]);
});

test('ambiguous or contradictory bot and host evidence never guesses',()=>{
  for(const change of [
    {players:2,initialDropMask:2,observedRemoteMask:2}, // dedicated one bot vs listen host
    {firstTick:1},{initialRosterChanged:true},{initialMaskChanged:true},
    {initialDropMask:undefined},{initialDropMask:64},{rosterEvidence:start(4)},
    {initialDropMask:48,rosterEvidence:start(2)}, // derived two locals contradict one seat
    {initialDropMask:48,observedRemoteMask:49,rosterEvidence:start(3)},
    {rosterEvidence:{rounds:{kind:'host_rounds_v1',local_player_mask:2}}},
    {rosterEvidence:{...start(3),rounds:{kind:'host_rounds_v1',local_player_mask:1}}},
  ])assert.equal(classify(change),undefined,JSON.stringify(change));
});
