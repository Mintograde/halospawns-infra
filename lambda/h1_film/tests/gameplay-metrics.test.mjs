import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveGameplayMetrics} from '../runtime/gameplay-metrics.mjs';

const weapon='weapons\\pistol\\pistol';
function fixture() {
  const events=[];
  for(let i=0;i<3;i++) {
    events.push({kind:0,source_tick:i*20,slot:0,weapon,discharge:`s${i}`,domain:'local'});
    events.push({kind:1,source_tick:i*20,slot:0,victim:1,unit:100,weapon,relationship:0,
      discharge:`s${i}`,before:i===0?[1,1]:i===1?[0.5,1]:[0,1],after:i===0?[0.5,1]:i===1?[0,1]:[0,0]});
  }
  events.push({kind:2,source_tick:40,slot:0,victim:1,weapon,relationship:0});
  return {events,slots:[0,1,2],deaths:[{source_tick:40,event_index:0,killer_slot:0,victim_slot:1}]};
}
const result=f=>deriveGameplayMetrics(f).metrics[0].players[0];
test('fresh unassisted consecutive pistol three-shot kill with replay evidence',()=>{
  assert.deepEqual(result(fixture()),{slot_index:0,value:1,observed_count:1,evaluated_kills:1,
    unknown_kills:0,coverage:{status:'complete',reason:null},
    examples:[{kill_event_index:0,victim_slot:1,start_source_tick:0,end_source_tick:40}]});
});
test('an intervening miss disqualifies, a shot before the first hit does not',()=>{
  const f=fixture();f.events.splice(2,0,{kind:0,source_tick:10,slot:0,weapon,discharge:'miss',domain:'local'});
  assert.equal(result(f).value,0);
  f.events.splice(2,1);f.events.unshift({kind:0,source_tick:0,slot:0,weapon,discharge:'prior',domain:'local'});
  assert.equal(result(f).value,1);
});
test('other players firing does not break the killer sequence',()=>{
  const f=fixture();f.events.splice(2,0,{kind:0,source_tick:10,slot:2,weapon,discharge:'other',domain:'local'});
  assert.equal(result(f).value,1);
});
test('assistance, self/environment damage, other weapons and recovery disqualify',()=>{
  for(const changes of [{slot:2},{slot:-1,relationship:3},{relationship:2,slot:1},
    {weapon:'weapons\\assault rifle\\assault rifle'},{before:[0.6,1]},{unit:101}]) {
    const f=fixture();Object.assign(f.events[3],changes);assert.equal(result(f).value,0);
  }
});
test('damaged or overshielded targets are not fresh',()=>{
  for(const before of [[0.99,1],[1,0.99],[2,1]]) {
    const f=fixture();f.events[1].before=before;assert.equal(result(f).value,0);
  }
});
test('missing exact shot links produce unknown, not zero',()=>{
  const f=fixture();f.events[3].discharge=null;
  assert.equal(result(f).value,null);assert.equal(result(f).unknown_kills,1);
  assert.equal(result(f).observed_count,0);
});
test('partial recordings retain observed examples but do not publish complete totals',()=>{
  const f=fixture();f.partialRecording=true;
  assert.equal(result(f).value,null);assert.equal(result(f).observed_count,1);
});
test('missing weapon or relationship evidence cannot masquerade as a known non-qualifying kill',()=>{
  for(const change of [{weapon:null},{slot:-1,relationship:4}]) {
    const f=fixture();Object.assign(f.events[1],change);assert.equal(result(f).value,null);
  }
  const f=fixture();f.events.at(-1).weapon=null;assert.equal(result(f).value,null);
});
test('duplicate callbacks for the same discharge count once',()=>{
  const f=fixture();f.events.splice(2,0,{...f.events[1],before:[0.5,1],after:[0.5,1]});
  assert.equal(result(f).value,1);
});
test('a prior damaged life does not contaminate a new fresh target',()=>{
  const f=fixture();f.events.unshift({...f.events[1],slot:2,discharge:null,before:[0.5,1],after:[0.4,1]});
  assert.equal(result(f).value,1);
});
test('death mismatch fails closed',()=>{
  const f=fixture();f.deaths[0].victim_slot=2;assert.throws(()=>result(f),/differ/);
});

function headshotFixture(health=1,headshot=1) {
  const f=fixture();f.definitionVersion=2;f.events.at(-1).headshot=headshot;
  for(const e of f.events)if(e.kind===1){e.before[1]=health;e.after[1]=e.after[0]===0&&e.source_tick===40?0:health;}
  return f;
}

test('definition 2 admits partial-health and critically low-health headshot finishers',()=>{
  for(const health of [1,0.75,0.25,0.001]) {
    const f=headshotFixture(health);assert.equal(result(f).value,1);
    assert.equal(deriveGameplayMetrics(f).metrics[0].definition_version,2);
    assert.equal(result({...f,definitionVersion:1}).value,health===1?1:0);
  }
});

test('definition 2 excludes body finishers even when shot evidence is missing',()=>{
  for(const health of [1,0.25,0.001]) {
    const f=headshotFixture(health,0);assert.equal(result(f).value,0);
    f.events[3].discharge=null;assert.equal(result(f).value,0);
    assert.equal(result(f).unknown_kills,0);
  }
});

test('definition 2 never invents a headshot from missing finisher evidence',()=>{
  for(const flag of [-1,null,undefined]) {
    const f=headshotFixture(0.25,flag);f.events.at(-1).headshot=flag;
    assert.equal(result(f).value,null);assert.equal(result(f).unknown_kills,1);
    assert.equal(result(f).observed_count,0);
  }
});

test('definition 2 retains full-normal-shield, consecutive-shot and unassisted requirements',()=>{
  for(const shield of [0.99,2]) {
    const f=headshotFixture(0.25);f.events[1].before[0]=shield;assert.equal(result(f).value,0);
  }
  for(const change of [{slot:2},{relationship:3,slot:-1},{before:[0.6,0.25]},{before:[0.5,0.3]},{unit:101}]) {
    const f=headshotFixture(0.25);Object.assign(f.events[3],change);assert.equal(result(f).value,0);
  }
  const f=headshotFixture(0.25);f.events.splice(2,0,{kind:0,source_tick:10,slot:0,weapon,discharge:'miss',domain:'local'});
  assert.equal(result(f).value,0);
});

test('retained definition 1 does not acquire the new headshot gate',()=>{
  const f=headshotFixture(1,0);f.definitionVersion=1;assert.equal(result(f).value,1);
  assert.deepEqual(deriveGameplayMetrics(f),deriveGameplayMetrics(fixture()));
  assert.throws(()=>deriveGameplayMetrics({...f,definitionVersion:3}),/definition/);
});
