import test from 'node:test';
import assert from 'node:assert/strict';
import {bindGameplayShots,gameplayVerdicts} from '../runtime/gameplay-source.mjs';
import {deriveGameplayMetrics} from '../runtime/gameplay-metrics.mjs';

const weapon='weapons\\pistol\\pistol', tag=0x12345678;
function table(name,records) {
  const stride=name==='pulls'?48:88, bytes=Buffer.alloc(stride*records.length);
  for(const [i,r] of records.entries()) {
    const b=bytes.subarray(i*stride,(i+1)*stride);
    if(name==='pulls') {
      b.writeInt32LE(r.tick,0);b.writeUInt32LE(tag,8);b[42]=2;
    } else if(name==='shots') {
      b.writeInt32LE(r.tick,0);b.writeInt32LE(r.tick,4);b.writeUInt16LE(r.id,8);
      b[10]=2;b[11]=8;b.writeInt32LE(99,12);b.writeUInt16LE(r.pull,82);
    } else {
      b.writeUInt32LE(r.tick,0);b[5]=1;b[6]=2;b.writeInt32LE(99,8);
      b.writeInt32LE(r.sent??r.tick,16);b.writeUInt32LE(r.id,20);
    }
  }
  return {name,stride,count:records.length,bytes,capped:false};
}
function fixture({miss=false,ledger=true}={}) {
  const reports=[0,1,2].map(i=>({tick:100+20*i,id:i,pull:i+(miss&&i>0?1:0)}));
  const pulls=reports.map(r=>({tick:r.tick}));if(miss)pulls.splice(1,0,{tick:110});
  const account={hash:'account-a',own_machine_slot:1,tables:[table('pulls',pulls),
    table('shots',reports),table('host_verdicts',reports)]};
  const events=[];
  for(let i=0;i<3;i++) {
    events.push({kind:3,clock:100+20*i,source_tick:20*i,physical:2,unit:99,deal:i+1});
    events.push({kind:1,source_tick:20*i,clock:100+20*i,slot:0,physical:2,victim:1,unit:99,
      weapon,weapon_tag:tag,relationship:0,deal:i+1,shot:0,
      before:i===0?[1,1]:i===1?[0.5,1]:[0,1],after:i===0?[0.5,1]:i===1?[0,1]:[0,0]});
  }
  events.push({kind:2,source_tick:40,slot:0,victim:1,weapon,relationship:0});
  return {source:{ledger:ledger?{tables:[table('verdicts',reports)]}:null,accounts:[account]},events};
}
function result(f) {
  return deriveGameplayMetrics({events:bindGameplayShots(f.events,f.source),slots:[0,1],
    deaths:[{source_tick:40,event_index:0,killer_slot:0,victim_slot:1}]}).metrics[0].players[0];
}

test('ordered host verdicts bind exact remote reports and every intervening pull',()=>{
  assert.equal(result(fixture()).value,1);
  assert.equal(result(fixture({miss:true})).value,0);
});
test('client copies without a host ledger preserve exact identity and misses',()=>{
  assert.equal(result(fixture({ledger:false})).value,1);
  assert.equal(result(fixture({ledger:false,miss:true})).value,0);
});
test('ordered binding requires the whole DEAL/verdict bijection, including non-damaging calls',()=>{
  const f=fixture();f.events.unshift({...f.events[0],deal:100});
  assert.equal(result(f).value,null);
  const g=fixture();g.events[0].unit=100;assert.equal(result(g).value,null);
});
test('simultaneous same-owner same-target client reports cannot be guessed',()=>{
  const f=fixture({ledger:false});f.events.unshift({...f.events[0],deal:100});
  assert.equal(result(f).value,null);
});
test('capped shots/pulls and duplicate accounts cannot prove a count',()=>{
  for(const name of ['shots','pulls']) {
    const f=fixture();f.source.accounts[0].tables.find(t=>t.name===name).capped=true;
    assert.equal(result(f).value,null);
  }
  const f=fixture();f.source.accounts.push(structuredClone(f.source.accounts[0]));
  assert.equal(result(f).value,null);
});
test('copied verdicts deduplicate only identical records; conflicting copies remain unknown',()=>{
  const f=fixture({ledger:false}),account=f.source.accounts[0];
  f.source.accounts.push({tables:[table('host_verdicts',[{tick:100,id:0}])]});
  assert.equal(gameplayVerdicts(f.source).verdicts.length,3);
  assert.equal(result(f).value,1);
  f.source.accounts[1].tables[0].bytes.writeUInt32LE(101,0);
  assert.equal(gameplayVerdicts(f.source).verdicts.length,2);
  assert.equal(result(f).value,null);
  assert.equal(account.tables[0].count,3);
});
test('wrong weapon tag and mismatched report identity fail closed',()=>{
  const f=fixture();f.events[1].weapon_tag=123;assert.equal(result(f).value,null);
  const g=fixture();g.source.accounts[0].tables.find(t=>t.name==='shots').bytes.writeInt32LE(101,4);
  assert.equal(result(g).value,null);
});
