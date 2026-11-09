import assert from 'node:assert/strict';
import {deriveGameplayMetrics} from './gameplay-metrics.mjs';

export const ESTIMATE_SCHEMA = 'halospawns.h1GameplayEstimates.v1';
export const ESTIMATE_METHOD = 'host_sequence_previous_12';
const key = e => `${e.slot}/${e.physical}/${e.weapon_tag}`;

// Candidate-only adapter. Host copies cannot prove the original client miss
// sequence. This method is never used to populate exact counts or coverage.
export function bindEstimatedHostShots(events) {
  const sequences = new Map(), shots = new Map();
  for (const e of events) if (e.kind === 0) {
    const sequence = (sequences.get(e.slot) ?? 0) + 1;
    sequences.set(e.slot,sequence);
    const list = shots.get(key(e)) ?? [];
    assert(Number.isSafeInteger(e.clock) && (!list.length || e.clock >= list.at(-1).clock),
      'Unordered host discharge clocks');
    list.push({...e,sequence,domain:'host-estimate',discharge:`host-estimate/${e.shot}`});
    shots.set(key(e),list);
  }
  const mapped = new Map(), used = new Set();
  return events.map(e => {
    if (e.kind === 0) return {...e,discharge:`local/${e.shot}`,domain:'local'};
    if (e.kind !== 1) return e;
    if (!e.deal) return {...e,discharge:e.shot ? `local/${e.shot}` : null};
    if (!mapped.has(e.deal)) {
      const list = shots.get(key(e)) ?? [];
      let low = 0, high = list.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (list[middle].clock < e.clock - 12) low = middle + 1;
        else high = middle;
      }
      const shot = list[low];
      const unique = shot && shot.clock <= e.clock && !(list[low + 1]?.clock <= e.clock)
        && !used.has(shot.discharge);
      mapped.set(e.deal,unique ? shot : null);
      if (unique) used.add(shot.discharge);
    }
    const shot = mapped.get(e.deal);
    return {...e,discharge:shot?.discharge ?? null,remoteShot:shot ?? undefined};
  });
}

export function addGameplayEstimates(exact, args) {
  const unresolved = new Map(exact.classifications.filter(c => c.status === 'unknown')
    .map(c => [c.kill_event_index,c.slot_index]));
  const candidate = deriveGameplayMetrics({...args,events:bindEstimatedHostShots(args.events)});
  return {...exact.product,metrics:exact.product.metrics.map(metric => ({...metric,
    players:metric.players.map(player => {
      const examples = candidate.metrics.find(m => m.id === metric.id).players
        .find(p => p.slot_index === player.slot_index).examples
        .filter(e => unresolved.get(e.kill_event_index) === player.slot_index);
      assert(examples.length <= player.unknown_kills);
      return {...player,estimates:{schema:ESTIMATE_SCHEMA,method:ESTIMATE_METHOD,count:examples.length,examples}};
    })
  }))};
}
