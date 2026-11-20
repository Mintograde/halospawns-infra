import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readClientAccount,decodeAccountRows} from './format3-diagnostics.mjs';

export const POV_RECOVERY_SCHEMA='halospawns.h1VerifiedPovRecovery.v1';
const layouts=new Map([
  [9839,{size:13828,pistol:13196,sniper:13212}],
  [9844,{size:13860,pistol:13228,sniper:13244}],
  [9848,{size:13888,pistol:13232,sniper:13248}],
]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const recoveryEntryId=id=>`${id}/verification/pov-recovery-v1`;

function section(bytes,field) {
  const offset=bytes.readUInt32LE(field), size=bytes.readUInt32LE(field+4);
  if(!offset||!size||offset+size>bytes.length)return null;
  return bytes.subarray(offset,offset+size);
}
function ownName(bytes,player) {
  const roster=section(bytes,456), start=20+28*player;
  if(!roster||roster.length<start+24||player>=roster.readUInt32LE(4))return null;
  return roster.toString('utf16le',start,start+24).split('\0')[0]||null;
}
function angles(bytes,layout) {
  const options=section(bytes,72);
  if(options?.length!==layout.size)return null;
  const pair=[options.readFloatLE(layout.pistol),options.readFloatLE(layout.sniper)];
  return pair.every(v=>v===-1||Number.isFinite(v)&&v>=0&&v<=360)?pair:null;
}
function compareRound(a,b) {
  return a.client_tick-b.client_tick||a.trigger-b.trigger||a.pellet-b.pellet||
    a.weapon_tag-b.weapon_tag||a.projectile_tag-b.projectile_tag;
}

// This is internal replay data. Never accept a caller-supplied direction, player,
// file path or tuning value. Both recordings and the account belong to this match.
export function preparePovRecovery(raw,match,track,client,originalFailure) {
  const {part,envelope}=track, layout=layouts.get(envelope.protocol_revision);
  if(!layout||originalFailure.reason!=='simulation_desync'||!part.account_size||
     envelope.match_id!==match.host.match_id||envelope.recorded_own_player!==part.player||
     !(envelope.recorded_local_player_mask & (1<<part.player)))return null;
  const host=raw.subarray(match.host_offset,match.host_offset+match.host_size);
  const hostAngles=angles(host,layout), clientAngles=angles(client,layout);
  if(!hostAngles||!clientAngles||hostAngles.every((n,i)=>n===clientAngles[i]))return null;
  const name=ownName(client,part.player);
  if(!name||ownName(host,part.player)!==name)return null;
  const original=raw.subarray(part.account_offset,part.account_offset+part.account_size);
  const account=readClientAccount(original,{allowUnassignedPlayer:envelope.protocol_revision>=9844});
  const table=account.tables.find(t=>t.name==='pulls');
  if(account.own_player!==part.player||table.capped||table.count>131072)return null;
  const rows=decodeAccountRows(account,'pulls').filter(r=>!(r.flags&2)).sort(compareRound);
  const input=Buffer.alloc(28+32*rows.length);
  input.writeUInt32LE(0x31564f50);input.writeUInt32LE(part.player,4);input.writeUInt32LE(rows.length,8);
  [...clientAngles,...hostAngles].forEach((value,i)=>input.writeFloatLE(value,12+4*i));
  for(const [index,row] of rows.entries()) {
    if(row.owner!==part.player||row.client_tick<0||!row.direction.every(Number.isFinite)||
       !row.direction.some(n=>n!==0)||index>0&&compareRound(row,rows[index-1])===0)return null;
    const at=28+index*32;
    [row.client_tick,row.trigger,row.pellet,row.weapon_tag,row.projectile_tag].forEach((v,i)=>input.writeUInt32LE(v,at+i*4));
    row.direction.forEach((v,i)=>input.writeFloatLE(v,at+20+i*4));
  }
  return {input,rounds:rows.length,receipt:{
    schema:POV_RECOVERY_SCHEMA,source_film_sha256:track.source_film_sha256,account_sha256:hash(original),
    recorded_own_player:part.player,client_autoaim_degrees:clientAngles,host_autoaim_degrees:hostAngles,
    verified_network_applications:envelope.network.applications,
    original_failure:originalFailure,
  }};
}

export class IncompletePovRecovery extends Error {}
export function finishPovRecovery(log,plan) {
  const summaries=[...log.matchAll(/^\[pov-recovery\] rules=(\d+) rounds=(\d+) matched=(\d+) changed=(\d+) rejected=(\d+)\r?$/gm)];
  assert.equal(summaries.length,1,'Missing or duplicate engine recovery summary');
  const [rules,rounds,matched,changed,rejected]=summaries[0].slice(1).map(Number);
  assert.equal(rounds,plan.rounds,'Engine read a different recovery table');
  if(!rules||matched!==rounds||changed>matched||rejected)throw new IncompletePovRecovery('Incomplete recorded round binding');
  return {...plan.receipt,method:changed?'host_rules_and_recorded_directions':'host_rules',
    matched_rounds:matched,changed_directions:changed};
}
