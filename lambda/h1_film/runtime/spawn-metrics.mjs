import assert from 'node:assert/strict';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {classifySpawn, INITIAL_THRESHOLD} from './spawn-probabilities.mjs';

export function deriveSpawnMetrics(frames, encoding) {
  const events = [], units = new Set(), slots = new Set(encoding.players);
  const stop = encoding.analytics.match_end_source_tick ?? encoding.source_ticks;
  let previous = -1;
  for (const frame of frames) {
    assert.ok(Number.isInteger(frame.source_tick) && frame.source_tick > previous && frame.source_tick < stop);
    previous = frame.source_tick;
    assert.ok(Array.isArray(frame.events) && frame.events.length <= 64);
    for (const e of frame.events) {
      assert.ok(slots.has(e.slot_index) && Number.isInteger(e.unit_handle) && e.unit_handle >= 0 && e.unit_handle < 2**32);
      assert.ok(e.spawn_index === null && e.ratings === null || Number.isInteger(e.spawn_index) && e.spawn_index >= 0 && e.spawn_index < 32768);
      const key = `${e.slot_index}:${e.unit_handle}`;
      assert.ok(!units.has(key), 'Duplicate successful spawn'); units.add(key);
      assert.ok(e.ratings === null || (Array.isArray(e.ratings) && e.ratings.length <= 4096));
      const probabilities = e.ratings === null ? null : classifySpawn(e.ratings, e.spawn_index);
      events.push({source_tick:frame.source_tick,slot_index:e.slot_index,spawn_index:e.spawn_index,
        unit_handle:e.unit_handle,...(probabilities ?? {chosen_probability:null,highest_probability:null,
          probability_ratio:null,probability_gap:null,non_highest:null,improbable:null})});
      assert.ok(events.length <= 8192, 'Spawn event budget exceeded');
    }
  }
  const measured = events.filter(e => e.improbable !== null);
  return {schema:'halospawns.h1SpawnMetrics.v1',definition_version:1,
    probability_model:'independent_uniform_squared_ratings_v1',boundary_policy:'pre_end_snapshot',
    threshold:{...INITIAL_THRESHOLD},observed_spawns:events.length,measured_spawns:measured.length,
    unknown_spawns:events.length-measured.length,
    non_highest_count:measured.filter(e=>e.non_highest).length,
    improbable_count:measured.filter(e=>e.improbable).length,
    coverage:stop > 0 && encoding.source_first_clock === 0 && encoding.analytics.match_end_source_tick !== null
      && measured.length === events.length ? 'complete' : 'partial',events};
}

export async function buildSpawnMetrics({evidence,encoding}) {
  assert.ok((await stat(evidence)).size <= 64*1024*1024);
  const frames=[];
  for await(const line of createInterface({input:createReadStream(evidence),crlfDelay:Infinity})) {
    frames.push(JSON.parse(line));
    assert.ok(frames.length <= 8193);
  }
  // An ended-at-first-frame recording legitimately has no retained events.
  assert.ok(frames.length || encoding.analytics.match_end_source_tick === 0, 'Missing spawn evidence');
  return deriveSpawnMetrics(frames,encoding);
}
