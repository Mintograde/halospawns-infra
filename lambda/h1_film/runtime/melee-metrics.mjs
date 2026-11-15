import assert from 'node:assert/strict';

export const MELEE_METRICS = ['backwhack_kills', 'double_melee_kills'];
const pair = v => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
const damaged = e => pair(e.before) && pair(e.after)
  && e.before.some((v, i) => Math.max(0, v) > Math.max(0, e.after[i]));

// Definition 1 uses original local actions. Definition 2 additionally requires
// accepted original-client report clocks, a map-wide conservative timer bound,
// and a host-observed cancellation chain. Host timing alone is never proof.
export function deriveMeleeMetrics({events, slots, deaths, partialRecording = false, doubleMeleeDefinition = 1,
  resolveNonMeleeFinishers = false, resolveBackwhackFinishers = false}) {
  assert.ok([1,2].includes(doubleMeleeDefinition),'Unsupported double melee definition');
  const metrics = MELEE_METRICS.map(id => ({id, definition_version: id==='double_melee_kills'?doubleMeleeDefinition:1,
    players: slots.map(slot_index => ({slot_index, value: 0, observed_count: 0,
      evaluated_kills: 0, unknown_kills: 0, coverage: {status: 'complete', reason: null}, examples: []}))}));
  assert.equal(new Set(slots).size, slots.length, 'Duplicate melee roster slots');
  const players = metrics.map(m => new Map(m.players.map(p => [p.slot_index, p])));
  const actions = new Map(), latest = new Map(), damage = new Map();
  const remoteHits = new Map();
  const priorMeleeDamage = new Set();
  let lastTick = -1, deathIndex = 0;
  for (const [order, e] of events.entries()) {
    assert.ok(Number.isSafeInteger(e.source_tick) && e.source_tick >= lastTick, 'Unordered melee evidence');
    assert.ok(Number.isSafeInteger(e.clock) && e.clock >= 0, 'Invalid melee clock');
    assert.ok(Number.isSafeInteger(e.melee) && e.melee >= 0, 'Missing melee evidence');
    lastTick = e.source_tick;
    if (e.kind === 4) {
      assert.ok(players[0].has(e.slot) && e.melee > 0 && !actions.has(e.melee)
        && Number.isInteger(e.unit) && e.unit !== -1
        && Number.isSafeInteger(e.ready_clock) && e.ready_clock > e.clock, 'Invalid melee action');
      const previous = latest.get(e.slot);
      // The hook records the first normal restart tick. The timer itself
      // reaches zero one tick earlier, and a hit on that expiry is too late.
      const action = {...e, order, previous, hits: new Map(), cancel: null,
        ready: e.source_tick + e.ready_clock - e.clock - 1};
      actions.set(e.melee, action); latest.set(e.slot, action);
    } else if (e.kind === 5) {
      const action = actions.get(e.melee);
      assert.ok(action && action.slot === e.slot && action.unit === e.unit
        && !action.cancel && latest.get(e.slot) === action, 'Invalid melee cancellation');
      action.cancel = {...e, order};
    } else if (e.kind === 1) {
      assert.ok(players[0].has(e.victim) && pair(e.before) && pair(e.after), 'Invalid melee damage');
      if (!damaged(e)) continue;
      const hit = {...e, order};
      const victimLife=`${e.victim}/${e.unit}`;
      hit.priorPotentialMelee=priorMeleeDamage.has(victimLife);
      // Unknown weapon attribution might have been a melee. Keep it in the
      // history so a missing first blow can never manufacture a complete zero.
      if(e.category===2 || e.category<0) priorMeleeDamage.add(victimLife);
      hit.hostAction=latest.get(e.slot);
      if(doubleMeleeDefinition===2 && e.category===2 && e.relationship===0 && e.deal) {
        const key=`${e.slot}/${e.attacker_unit}`;
        hit.previousRemote=remoteHits.get(key);
        // Multiple callbacks for one accepted report are one impact.
        if(hit.previousRemote?.deal===e.deal) hit.previousRemote=hit.previousRemote.previousRemote;
        remoteHits.set(key,hit);
      }
      damage.set(e.victim, hit);
      const action = actions.get(e.melee);
      if (action && e.category === 2 && e.relationship === 0 && action.slot === e.slot) {
        const key = `${e.victim}/${e.unit}`;
        if (!action.hits.has(key)) action.hits.set(key, hit);
      }
    } else if (e.kind === 2) {
      const death = deaths[deathIndex++];
      assert.ok(death && death.source_tick === e.source_tick && death.victim_slot === e.victim
        && (death.killer_slot ?? -1) === e.slot, 'Melee deaths differ from combat events');
      const hit = damage.get(e.victim); damage.delete(e.victim);
      if (e.relationship !== 0) continue;
      const ps = players.map(p => p.get(e.slot));
      assert.ok(ps.every(Boolean), 'Unknown melee killer');
      ps.forEach(p => p.evaluated_kills++);
      if (e.category >= 0 && e.category !== 2) continue;
      const unknown = i => ps[i].unknown_kills++;
      const example = start => ({kill_event_index: death.event_index, victim_slot: e.victim,
        start_source_tick: start, end_source_tick: e.source_tick});
      const count = (i, ex) => { ps[i].observed_count++; ps[i].examples.push(ex); };
      const lethal = hit && hit.slot === e.slot && hit.unit === e.unit && hit.category === 2
        && hit.relationship === 0 && hit.source_tick === e.source_tick && hit.after[1] <= 0;
      if (e.category !== 2 || !lethal) {
        // Kill credit can name an earlier attacker after a grenade finishes the
        // victim. The death's credited weapon is then unknown, but a positive
        // health-to-zero callback on this exact body/tick can still prove the
        // finisher was not a melee. Unknown categories/owners alone cannot:
        // a dead player's host melee can appear as environmental damage.
        const finisher = e.category < 0 && hit
          && hit.unit === e.unit && hit.source_tick === e.source_tick
          && hit.before[1] > 0 && hit.after[1] <= 0;
        const nonMelee = finisher && hit.category >= 0 && hit.category !== 2;
        // The assassination branch is observed in the actual lethal host call,
        // including remote damage. Two explicit false observations can exclude
        // a backwhack even when its credited weapon/attacker is unresolved.
        const notBackwhack = finisher && (nonMelee || (hit.backwhack === 0 && e.backwhack === 0));
        if (!resolveBackwhackFinishers || !notBackwhack) unknown(0);
        if (!resolveNonMeleeFinishers || !nonMelee) unknown(1);
        continue;
      }
      if (e.backwhack === 1 && hit.backwhack === 1) count(0, example(e.source_tick));
      else if (e.backwhack !== 0 || hit.backwhack !== 0) unknown(0);

      const second = actions.get(e.melee);
      if (!second || hit.melee !== second.melee || second.slot !== e.slot) {
        const first=hit.previousRemote, a=first?.melee_report, b=hit.melee_report;
        const hostFirst=first?.hostAction, hostSecond=hit.hostAction;
        const bound=first?.melee_recovery_ticks, delta=b&&a?b.client_tick-a.client_tick:0;
        if(doubleMeleeDefinition===2 && a && b && a.id!==b.id && a.machine_slot===b.machine_slot
          && a.epoch===b.epoch && a.sequence!==b.sequence && a.verdict_index<b.verdict_index
          && Number.isInteger(hit.attacker_unit) && hit.attacker_unit!==-1
          && first.attacker_unit===hit.attacker_unit && first.victim===hit.victim && first.unit===hit.unit
          && first.after[1]>0 && first.order<hit.order && first.source_tick<=hit.source_tick
          && hostFirst && hostSecond?.previous===hostFirst && hostFirst.cancel
          && hostFirst.unit===hit.attacker_unit && hostSecond.unit===hit.attacker_unit
          && hostFirst.order<first.order && first.order<hostFirst.cancel.order
          && hostFirst.cancel.order<hostSecond.order && hostSecond.order<hit.order
          && Number.isSafeInteger(bound) && bound>0 && bound<=508 && bound%4===0
          && hit.melee_recovery_ticks===bound && delta>0 && delta<bound) {
          count(1,{...example(first.source_tick),remote_melee_timing:{
            method:'host_accepted_reports_v1',first_damage_source_tick:first.source_tick,
            first_report_client_tick:a.client_tick,second_report_client_tick:b.client_tick,
            minimum_recovery_ticks:bound,machine_slot:a.machine_slot,epoch:a.epoch,
            first_sequence:a.sequence,second_sequence:b.sequence,
            first_verdict_index:a.verdict_index,second_verdict_index:b.verdict_index,
            host_first_action_source_tick:hostFirst.source_tick,
            host_grenade_source_tick:hostFirst.cancel.source_tick,
            host_second_action_source_tick:hostSecond.source_tick,
          }});
        } else if(doubleMeleeDefinition!==2 || partialRecording || hit.priorPotentialMelee) unknown(1);
        continue;
      }
      const first = second.previous;
      // A recording that begins in mid-action cannot establish a negative.
      if (!first) { if (partialRecording) unknown(1); continue; }
      if (first.unit !== second.unit || !first.cancel || first.cancel.order >= second.order) continue;
      const firstHit = first.hits.get(`${e.victim}/${e.unit}`);
      if (!firstHit || firstHit.order >= first.cancel.order || firstHit.after[1] <= 0) continue;
      // Compare the lethal damage tick, not merely the second button press.
      // Equality is a normal cooldown expiry and never qualifies.
      if (e.source_tick >= first.ready || second.order >= hit.order) continue;
      count(1, {...example(first.source_tick), melee_timing: {
        first_damage_source_tick: firstHit.source_tick,
        grenade_source_tick: first.cancel.source_tick,
        second_action_source_tick: second.source_tick,
        cooldown_expiry_source_tick: first.ready,
      }});
    } else assert.ok(e.kind === 0 || e.kind === 3, 'Unknown melee evidence kind');
  }
  assert.equal(deathIndex, deaths.length, 'Incomplete melee death evidence');
  for (const metric of metrics) for (const p of metric.players) {
    if (p.unknown_kills || partialRecording) p.coverage = {status: 'partial',
      reason: p.unknown_kills ? 'missing_melee_evidence' : 'partial_recording'};
    p.value = p.coverage.status === 'complete' ? p.observed_count : null;
  }
  return metrics;
}
