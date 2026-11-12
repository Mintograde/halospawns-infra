import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveMeleeMetrics} from '../runtime/melee-metrics.mjs';

function fixture() {
  const event = (kind, tick, extra = {}) => ({kind, source_tick: tick, clock: tick + 400,
    slot: 0, victim: 1, unit: 200, melee: 0, category: 2, relationship: 0, backwhack: 0, ...extra});
  return {slots: [0, 1], deaths: [{event_index: 3, source_tick: 20, killer_slot: 0, victim_slot: 1}], events: [
    event(4, 1, {melee: 1, unit: 100, ready_clock: 441}),
    event(1, 8, {melee: 1, before: [1, 1], after: [0, 0.5]}),
    event(5, 9, {melee: 1, unit: 100}),
    event(4, 11, {melee: 2, unit: 100, ready_clock: 451}),
    event(1, 20, {melee: 2, before: [0, 0.5], after: [0, 0]}),
    event(2, 20, {melee: 2}),
  ]};
}
const counts = f => deriveMeleeMetrics(f).map(m => m.players[0]);

test('two damaging swings with a grenade cancellation and early lethal second impact', () => {
  const [back, double] = counts(fixture());
  assert.equal(back.value, 0); assert.equal(double.value, 1);
  assert.deepEqual(double.examples[0], {kill_event_index: 3, victim_slot: 1,
    start_source_tick: 1, end_source_tick: 20, melee_timing: {first_damage_source_tick: 8,
      grenade_source_tick: 9, second_action_source_tick: 11, cooldown_expiry_source_tick: 40}});
});

test('backwhack requires the lethal assassination branch, and can also finish a double melee', () => {
  const f = fixture(); f.events[4].backwhack = f.events[5].backwhack = 1;
  assert.deepEqual(counts(f).map(p => p.value), [1, 1]);
  f.events[4].backwhack = 0;
  assert.equal(counts(f)[0].value, null);
});

for (const [name, change] of [
  ['first swing misses', f => f.events.splice(1, 1)],
  ['first swing causes no damage', f => f.events[1].after = [1, 1]],
  ['second swing causes no damage', f => f.events[4].after = [0, 0.5]],
  ['no grenade cancellation', f => f.events.splice(2, 1)],
  ['first hit is a different target', f => f.events[1].unit = 201],
  ['attacker respawn', f => f.events[3].unit = 101],
  ['first hit is friendly', f => f.events[1].relationship = 1],
  ['second hit at cooldown expiry', f => f.events[0].ready_clock = 421],
  ['second hit after expiry despite early second start', f => f.events[0].ready_clock = 420],
  ['same swing duplicate callback', f => {f.events[4].melee = f.events[5].melee = 1;}],
  ['non-melee finisher', f => f.events[5].category = 1],
  ['betrayal', f => f.events[5].relationship = 1],
]) test(`does not count ${name}`, () => {
  const f = fixture(); change(f);
  assert.equal(counts(f)[1].observed_count, 0);
});

test('accepted remote damage preserves backwhacks but never borrows host animation timing', () => {
  const f = fixture(); f.events[4].melee = f.events[5].melee = 0;
  f.events[4].backwhack = f.events[5].backwhack = 1;
  const [back, double] = counts(f);
  assert.equal(back.value, 1); assert.equal(double.value, null);
  assert.equal(double.unknown_kills, 1);
  assert.equal(double.coverage.reason, 'missing_melee_evidence');
});

test('one tick before timer expiry qualifies, but expiry itself never does', () => {
  const f = fixture(); f.events[0].ready_clock = 422;
  assert.equal(counts(f)[1].value, 1);
  f.events[0].ready_clock = 421;
  assert.equal(counts(f)[1].value, 0);
});

test('partial recording retains observed examples without asserting complete totals', () => {
  const f = fixture(); f.partialRecording = true;
  const double = counts(f)[1];
  assert.equal(double.observed_count, 1); assert.equal(double.value, null);
  assert.equal(double.coverage.reason, 'partial_recording');
});

test('damage callbacks from one swing cannot multiply counts', () => {
  const f = fixture(); f.events.splice(2, 0, structuredClone(f.events[1]));
  assert.equal(counts(f)[1].value, 1);
});

test('unknown weapon attribution remains unknown for both metrics', () => {
  const f = fixture(); f.events[5].category = -1;
  assert.deepEqual(counts(f).map(p => p.value), [null, null]);
});

test('missing hooks, reordered events and mismatched combat deaths fail closed', () => {
  for (const change of [f => delete f.events[0].melee,
    f => f.events[2].source_tick = 1, f => f.deaths[0].victim_slot = 0,
    f => f.events[3].melee = 1, f => f.deaths.push({...f.deaths[0]})]) {
    const f = fixture(); change(f); assert.throws(() => counts(f));
  }
});
