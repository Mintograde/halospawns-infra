// A clean simulation can still reconstruct an inconsistent initial player table.
// Keep its recorded evidence, but do not publish, trim or renumber that world.
import {verifyPlayback} from './adapters/beta6-v3-120.mjs';

export class ClientRosterMismatch extends Error {
  constructor(evidence, cause) {
    super('Client initial roster differs from its recording', {cause});
    this.evidence=evidence;
  }
}

export function rejectedClientRoster(encoderLog) {
  const prefix='h1-film-encoder: client initial roster mismatch: ';
  const text=encoderLog.trim();
  if(!text.startsWith(prefix)||text.length>1024)return null;
  let roster;
  try {roster=JSON.parse(text.slice(prefix.length));} catch {return null;}
  if(!roster||Object.keys(roster).sort().join(',')!=='exported_player_indices,recorded_player_count')return null;
  const {recorded_player_count:count,exported_player_indices:ids}=roster;
  if(!Number.isInteger(count)||count<1||count>16||!Array.isArray(ids)||!ids.length||ids.length>16
    ||ids.length===count||ids.some(id=>!Number.isInteger(id)||id<0||id>15)||new Set(ids).size!==ids.length)return null;
  return roster;
}

export function completedClientRosterMismatch(log,envelope,encoderLog) {
  const roster=rejectedClientRoster(encoderLog);
  if(!roster||roster.recorded_player_count!==envelope.players)return null;
  // Use the normal verifier, including exact tick/hash/application coverage.
  // Never turn a failed/incomplete verification into a roster-only diagnosis.
  let simulation;
  try {simulation=verifyPlayback(log,envelope);} catch {return null;}
  const applied=[...log.matchAll(/network changes put back: (\d+), (\d+) refused/g)].at(-1);
  if(!applied||Number(applied[2])!==0||Number(applied[1])!==envelope.network?.applications)return null;
  return {reason:'roster_mismatch',...simulation,network_applied:Number(applied[1]),network_refused:0,...roster};
}

export function clientRosterEvidence(error) {
  for(let e=error;e;e=e.cause)if(e instanceof ClientRosterMismatch)return e.evidence;
  return null;
}
