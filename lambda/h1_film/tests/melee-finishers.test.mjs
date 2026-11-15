import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveMeleeMetrics} from '../runtime/melee-metrics.mjs';

const source=JSON.parse(readFileSync(new URL('./fixtures/melee-finishers-fallout.json',import.meta.url)));
const classify=(tick,enabled)=>deriveMeleeMetrics({...source.cases.find(c=>c.tick===tick),
  partialRecording:true,doubleMeleeDefinition:2,resolveNonMeleeFinishers:enabled,
  resolveBackwhackFinishers:enabled});

test('real Player 2 backwhack is confirmed by host damage without a client account or local action',()=>{
  const example=source.cases.find(c=>c.tick===7861),hit=example.events[0];
  assert(hit.deal>0);assert.equal(hit.melee,0);
  assert.equal(hit.backwhack,1);assert.equal(example.events[1].backwhack,1);
  for(const enabled of [false,true]) {
    const back=classify(7861,enabled)[0].players.find(p=>p.slot_index===1);
    assert.equal(back.observed_count,1);assert.equal(back.unknown_kills,0);
    assert.equal(back.examples[0].end_source_tick,7861);
  }
});

test('real self-grenade kill credited to dstny resolves both melee classifications',()=>{
  const example=source.cases.find(c=>c.tick===54051),[hit,death]=example.events;
  assert.equal(hit.category,1);assert.equal(hit.slot,3);assert.equal(hit.relationship,2);
  assert.equal(death.category,-1);assert.equal(death.slot,0);
  for(const enabled of [false,true])for(const metric of classify(54051,enabled)) {
    const player=metric.players.find(p=>p.slot_index===0);
    assert.equal(player.observed_count,0);assert.equal(player.unknown_kills,enabled?0:1);
    assert.equal(player.coverage.reason,enabled?'partial_recording':'missing_melee_evidence');
  }
});
