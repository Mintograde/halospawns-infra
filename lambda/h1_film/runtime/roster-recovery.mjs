import assert from 'node:assert/strict';

export const ROSTER_RECOVERY = 'halospawns.h1InitialRosterRecovery.v1';

// Damage owner handles/teams are recorded facts. Names are not present in this
// evidence and must never be synthesized as identities. Simulation is still
// required to validate every seed, world hash and network application.
export function recoverInitialRoster({players, firstTick, ticks, localPlayers, initialMask,
  maskChanged, rosterChanged, observedMask, owners, teams, ffa, namesSize}) {
  if (initialMask === undefined || initialMask >>> players === 0) return undefined;
  const count = 32 - Math.clz32(initialMask);
  assert.ok(players === 8 && firstTick === 0 && localPlayers === 1 && ffa && namesSize === 196
    && count > 8 && count <= 16 && initialMask === 2 ** count - 1
    && !maskChanged && !rosterChanged && (observedMask & ~initialMask) === 0,
  'Initial roster is not recoverable from unambiguous all-remote FFA evidence');
  const recovered_players = [];
  const usedTeams = new Set(Array.from({length:8},(_,slot)=>(teams >>> (slot*4)) & 15));
  assert.equal(usedTeams.size,8,'Recovery requires distinct recorded FFA teams');
  for(let slot=8;slot<count;slot++) {
    const owner = owners.get(slot);
    assert.ok(owner && !owner.conflict && owner.team >= 0 && owner.team < 16
      && (owner.player_handle >>> 16) !== 0
      && owner.first_source_tick >= 0 && owner.last_source_tick < ticks
      && !usedTeams.has(owner.team), 'Missing or conflicting initial player damage evidence');
    usedTeams.add(owner.team);
    const {conflict, ...evidence} = owner;
    recovered_players.push({slot,...evidence});
  }
  return {schema:ROSTER_RECOVERY,recorded_player_count:8,initial_player_count:count,
    initial_remote_mask:initialMask,recovered_players};
}

export function observeDamageOwner(owners, payload, tick) {
  const handle=payload.readInt32LE(32), slot=handle & 65535, team=payload.readInt16LE(40);
  if(handle === -1 || slot < 8 || slot >= 16) return;
  const prior=owners.get(slot);
  if(prior) {
    prior.conflict ||= prior.player_handle !== handle || prior.team !== team;
    prior.damage_record_count++;
    prior.last_source_tick=tick;
  } else owners.set(slot,{player_handle:handle,team,damage_record_count:1,
    first_source_tick:tick,last_source_tick:tick,conflict:false});
}

export function recoveryEngineValue(recovery) {
  return [recovery.initial_player_count,...recovery.recovered_players.flatMap(p=>[p.player_handle >>> 0,p.team])].join(',');
}
