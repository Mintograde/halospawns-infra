import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyGameplayMetrics} from '../runtime/gameplay-metrics.mjs';
import {addGameplayEstimates,bindEstimatedHostShots} from '../runtime/gameplay-estimates.mjs';

const weapon='weapons\\pistol\\pistol';
function fixture() {
  const events=[];
  for(let i=0;i<3;i++) {
    events.push({kind:0,clock:i*40,source_tick:i*40,slot:0,physical:2,weapon,weapon_tag:1,shot:i+1});
    events.push({kind:1,clock:i*40,source_tick:i*40,slot:0,physical:2,victim:1,unit:99,
      weapon,weapon_tag:1,relationship:0,deal:i+1,shot:0,
      before:i===0?[1,1]:i===1?[0.5,1]:[0,1],after:i===0?[0.5,1]:i===1?[0,1]:[0,0]});
  }
  events.push({kind:2,source_tick:80,slot:0,victim:1,weapon,relationship:0});
  return {events,slots:[0,1],deaths:[{source_tick:80,event_index:0,killer_slot:0,victim_slot:1}]};
}
function exact(args,original=null) {
  return classifyGameplayMetrics({...args,events:args.events.map(e=>e.kind===0?
    {...e,discharge:'local/'+e.shot,domain:'local'}:e.kind===1?
      {...e,discharge:original?'client/'+e.deal:null,remoteShot:original?
        {slot:e.slot,weapon:e.weapon,domain:'client',sequence:original[e.deal-1]}:undefined}:e)});
}
const player=product=>product.metrics[0].players[0];

test('estimates preserve exact unknown counts and expose distinct review examples',()=>{
  const args=fixture(),known=exact(args),before=structuredClone(known);
  const result=player(addGameplayEstimates(known,args));
  assert.deepEqual(known,before);
  assert.equal(result.value,null);assert.equal(result.observed_count,0);assert.equal(result.unknown_kills,1);
  assert.equal(result.estimates.count,1);assert.deepEqual(result.estimates.examples,[{
    kill_event_index:0,victim_slot:1,start_source_tick:0,end_source_tick:80}]);
});
test('host estimates cannot revive a known client miss or duplicate a verified kill',()=>{
  const args=fixture();
  assert.equal(player(addGameplayEstimates(exact(args,[1,3,4]),args)).estimates.count,0);
  const verified=player(addGameplayEstimates(exact(args,[1,2,3]),args));
  assert.equal(verified.value,1);assert.equal(verified.estimates.count,0);
});
test('intervening host misses and other weapon discharges exclude candidates',()=>{
  for(const firedWeapon of [weapon,'weapons\\shotgun\\shotgun']) {
    const args=fixture();args.events.splice(2,0,{...args.events[0],clock:20,source_tick:20,shot:9,weapon:firedWeapon});
    assert.equal(player(addGameplayEstimates(exact(args),args)).estimates.count,0);
  }
});
test('unknown weapons, assistance, damaged targets and recovery do not become estimates',()=>{
  for(const [index,change] of [[1,{before:[0.5,1]}],[3,{weapon:null}],[3,{relationship:1}],
    [3,{before:[0.75,1]}],[3,{slot:1,physical:1}]]) {
    const args=fixture();Object.assign(args.events[index],change);
    assert.equal(player(addGameplayEstimates(exact(args),args)).estimates.count,0);
  }
});
test('temporal ambiguity, distant or future fires and reused shots remain unresolved',()=>{
  for(const delay of [13,-1]) {
    const args=fixture();args.events[1].clock+=delay;
    assert.equal(player(addGameplayEstimates(exact(args),args)).estimates.count,0);
  }
  const args=fixture();args.events.splice(0,0,{...args.events[0],shot:9});
  assert.equal(player(addGameplayEstimates(exact(args),args)).estimates.count,0);
  const e=fixture().events;
  const bound=bindEstimatedHostShots([e[0],e[1],{...e[1],deal:99}]);
  assert(bound[1].discharge);assert.equal(bound[2].discharge,null);
});
test('duplicate damage callbacks reuse one discharge and other players do not break the sequence',()=>{
  const args=fixture();args.events.splice(2,0,{...args.events[1],before:[0.5,1],after:[0.5,1]},
    {...args.events[0],slot:1,physical:1,shot:9,source_tick:20,clock:20});
  assert.equal(player(addGameplayEstimates(exact(args),args)).estimates.count,1);
});

test('definition 2 estimates require a headshot and allow low-health targets',()=>{
  for(const headshot of [1,0,-1]) {
    const args=fixture();args.definitionVersion=2;args.events.at(-1).headshot=headshot;
    for(const e of args.events)if(e.kind===1){e.before[1]=0.01;e.after[1]=e.source_tick===80?0:0.01;}
    const product=addGameplayEstimates(exact(args),args);
    assert.equal(product.metrics[0].definition_version,2);
    assert.equal(player(product).estimates.count,headshot===1?1:0);
    assert.equal(player(product).unknown_kills,headshot===0?0:1);
  }
});
