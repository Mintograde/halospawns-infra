import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveSpawnMetrics} from '../runtime/spawn-metrics.mjs';
const encoding = {players:[0,1],source_ticks:100,source_first_clock:0,analytics:{match_end_source_tick:90}};
const event = (unit, ratings=[1,2], slot=0) => ({unit_handle:unit,ratings,slot_index:slot,spawn_index:0});
test('successful observed spawns reconcile with model counts and retain per-event odds', () => {
  const p = deriveSpawnMetrics([{source_tick:0,events:[event(1),event(2,[1,1],1)]}],encoding);
  assert.equal(p.improbable_count,1); assert.equal(p.non_highest_count,1);
  assert.equal(p.observed_spawns,2); assert.equal(p.coverage,'complete');
  assert.equal(p.events[0].chosen_probability,0.125);
  assert.equal(p.events[0].highest_probability,0.875);
  assert.equal(p.definition_version,2);
  assert.deepEqual(p.threshold,{positive_to_neutral_ratio_exclusive:2});
  assert.equal(p.events[0].neutral_probability,0.125);
});
test('missing ratings and partial recordings remain partial, zero stays measured', () => {
  const p=deriveSpawnMetrics([{source_tick:1,events:[event(1,null)]}],encoding);
  assert.equal(p.unknown_spawns,1); assert.equal(p.coverage,'partial');
  assert.equal(p.events[0].improbable,null);
  assert.equal(p.events[0].chosen_rating,null);
  assert.equal(p.events[0].neutral_probability,null);
  assert.equal(deriveSpawnMetrics([],encoding).improbable_count,0);
  assert.equal(deriveSpawnMetrics([],{...encoding,source_first_clock:12}).coverage,'partial');
  assert.equal(deriveSpawnMetrics([],{...encoding,analytics:{match_end_source_tick:0}}).coverage,'partial');
});

test('retained definition 1 keeps its classifications and exact event shape', () => {
  const frames = [{source_tick:0,events:[event(1,[0.5,2])]}];
  const old = deriveSpawnMetrics(frames,encoding,1);
  assert.equal(old.definition_version,1);
  assert.equal(old.improbable_count,1);
  assert.deepEqual(old.threshold,{maximum_ratio:0.5,minimum_gap:0.1});
  assert.equal('chosen_rating' in old.events[0],false);
  const current = deriveSpawnMetrics(frames,encoding);
  assert.equal(current.improbable_count,0);
  assert.equal(current.measured_spawns,1);
  assert.equal(current.coverage,'complete');
  assert.equal(current.events[0].neutral_probability,null);
});
test('duplicate units, unknown identities, invalid rating vectors and boundary events reject', () => {
  for (const frames of [
    [{source_tick:0,events:[event(1),event(1)]}],
    [{source_tick:0,events:[event(1,[1,2],8)]}],
    [{source_tick:0,events:[event(1,[])]}],
    [{source_tick:90,events:[event(1)]}],
  ]) assert.throws(()=>deriveSpawnMetrics(frames,encoding));
});
