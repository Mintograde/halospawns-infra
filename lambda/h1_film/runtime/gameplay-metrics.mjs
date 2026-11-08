import assert from 'node:assert/strict';

export const GAMEPLAY_SCHEMA = 'halospawns.h1GameplayMetrics.v1';
export const THREE_SHOT_ID = 'pistol_three_shot_kills';
const pistol = weapon => weapon?.replaceAll('\\','/').toLowerCase() === 'weapons/pistol/pistol';
const fresh = vitality => vitality.every(n => n === 1);
const finitePair = v => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

// A versioned reducer over ordered, source-bound observations. A source adapter
// resolves discharge identity; this layer never guesses links from time/distance.
export function deriveGameplayMetrics({events, slots, deaths, partialRecording = false}) {
  const players = new Map(slots.map(slot => [slot, {slot_index:slot, value:0, observed_count:0,
    evaluated_kills:0, unknown_kills:0, coverage:{status:'complete',reason:null}, examples:[]} ]));
  const shots = new Map(), sequences = new Map(), encounters = new Map();
  let deathIndex = 0, lastTick = -1;
  for (const e of events) {
    assert.ok(Number.isSafeInteger(e.source_tick) && e.source_tick >= lastTick, 'Unordered gameplay events');
    lastTick = e.source_tick;
    if (e.kind === 0) {
      assert.ok(players.has(e.slot) && typeof e.discharge === 'string' && !shots.has(e.discharge), 'Invalid gameplay discharge');
      const sequence = (sequences.get(e.slot) ?? 0) + 1;
      sequences.set(e.slot, sequence);
      shots.set(e.discharge, {...e, sequence});
    } else if (e.kind === 1) {
      assert.ok(players.has(e.victim) && finitePair(e.before) && finitePair(e.after), 'Invalid gameplay damage');
      let encounter = encounters.get(e.victim);
      const starts = fresh(e.before);
      if (starts) {
        encounter = {slot:e.slot, unit:e.unit, start:e.source_tick, after:e.after,
          valid:true, unknown:false, hits:[], lastSequence:null, domain:null};
        encounters.set(e.victim, encounter);
      }
      if (!encounter) continue; // Known non-fresh / partial life, not a qualifying kill.
      if (encounter.unit !== e.unit || (encounter.slot >= 0 && e.slot >= 0 && encounter.slot !== e.slot)
        || (e.relationship !== 0 && e.relationship !== 4) || (e.weapon && !pistol(e.weapon))
        || (!starts && e.before.some((v,i) => v > encounter.after[i]))) encounter.valid = false;
      if (!e.weapon || e.relationship === 4 || e.slot < 0) encounter.unknown = true;
      if (encounter.slot < 0 && e.slot >= 0) encounter.slot = e.slot;
      encounter.after = e.after;
      if (!e.discharge) { encounter.unknown = true; encounter.lastSequence = null; continue; }
      const shot = e.remoteShot ?? shots.get(e.discharge);
      if (!shot || shot.slot !== e.slot || !pistol(shot.weapon)) { encounter.unknown = true; encounter.lastSequence = null; continue; }
      if (encounter.hits.includes(e.discharge)) {
        // A single projectile can cause several damage callbacks. Count its fire once.
        if (encounter.hits.at(-1) !== e.discharge) encounter.valid = false;
        continue;
      }
      if (encounter.lastSequence !== null && (shot.sequence !== encounter.lastSequence + 1
        || shot.domain !== encounter.domain)) encounter.valid = false;
      encounter.hits.push(e.discharge); encounter.lastSequence = shot.sequence; encounter.domain = shot.domain;
    } else if (e.kind === 2) {
      const death = deaths[deathIndex];
      assert.ok(death && death.source_tick === e.source_tick && death.victim_slot === e.victim
        && (death.killer_slot ?? -1) === e.slot, 'Gameplay deaths differ from combat events');
      const index = death.event_index; deathIndex++;
      const encounter = encounters.get(e.victim); encounters.delete(e.victim);
      if (e.relationship !== 0) continue;
      const player = players.get(e.slot); assert.ok(player, 'Unknown gameplay killer');
      player.evaluated_kills++;
      if (!encounter || !encounter.valid || (encounter.slot >= 0 && encounter.slot !== e.slot)
        || (e.weapon && !pistol(e.weapon))) continue;
      if (encounter.unknown || !e.weapon) { player.unknown_kills++; continue; }
      if (encounter.hits.length !== 3) continue;
      player.observed_count++;
      player.examples.push({kill_event_index:index,victim_slot:e.victim,
        start_source_tick:encounter.start,end_source_tick:e.source_tick});
    } else assert.equal(e.kind,3,'Unknown gameplay event kind');
  }
  assert.equal(deathIndex, deaths.length, 'Incomplete gameplay death evidence');
  for (const p of players.values()) {
    if (p.unknown_kills || partialRecording) p.coverage = {status:'partial',
      reason:p.unknown_kills?'missing_shot_evidence':'partial_recording'};
    p.value = p.coverage.status === 'complete' ? p.observed_count : null;
  }
  return {schema:GAMEPLAY_SCHEMA,metrics:[{id:THREE_SHOT_ID,definition_version:1,players:[...players.values()]}]};
}
