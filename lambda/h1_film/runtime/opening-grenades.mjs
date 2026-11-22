import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, mkdir, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {readEnvelope} from './film.mjs';
import {inspectMatchFilm, matchFilmPolicy} from './match-film.mjs';
import {restoreMatchPart} from './convert-match-tracks.mjs';

export const OPENING_GRENADES_EXPORTER = 48;
const unitName = unit => unit.toString(16).toUpperCase().padStart(8,'0');

export function openingSpawnRows(log, players) {
  const rows = new Map();
  for (const m of log.matchAll(/^\[h1-opening\] slot=(\d+) unit=([0-9A-F]{8}) grenades=(\d+),(\d+)\r?$/gm)) {
    const slot = Number(m[1]);
    if (slot >= players || rows.has(slot)) return null;
    rows.set(slot, {slot, unit:m[2], frags:Number(m[3]), plasmas:Number(m[4])});
  }
  if (rows.size !== players) return null;
  return Array.from({length:players}, (_, slot) => rows.get(slot));
}

// Beta 8 authoritative unit states (67) identify each live, placed unit at host
// update 1. Inventories (69) are the actual host messages applied by a client.
// Stop accepting evidence after the opening second, or any pickup/damage/roster
// change. Later inventory refreshes and a reused object slot cannot seed a spawn.
export function openingInventoryWitness(spawns, lastTick) {
  const units = new Map(spawns.map(s => [s.unit, s.slot]));
  const seen = new Set(), counts = new Map();
  let clock, invalid = units.size !== spawns.length;
  function record(frame, type, b) {
    if (invalid || frame > lastTick) return;
    if (type === 64) clock = b.readInt32LE() - frame;
    if (clock !== undefined && clock + frame > lastTick) return;
    if ([70,74,76,77,78].includes(type)) {
      if (counts.size !== spawns.length) invalid = true;
      return;
    }
    if (type === 67) {
      const slot = b[0], unit = unitName(b.readUInt32LE(4));
      if (slot >= spawns.length || (b[1] & 3) !== 3 || units.get(unit) !== slot) {
        if (counts.size !== spawns.length) invalid = true;
        return;
      }
      if (frame === 0 && b.readInt32LE(64) === 1) seen.add(slot);
    }
    if (type !== 69) return;
    const slot = units.get(unitName(b.readUInt32LE(0)));
    if (slot === undefined) return;
    if (!seen.has(slot) || clock === undefined || clock+frame < 0) { invalid = true; return; }
    const frags = b.readInt8(4), plasmas = b.readInt8(5);
    if (frags < 0 || plasmas < 0) { invalid = true; return; }
    const first = counts.get(slot);
    if (first && (first.frags !== frags || first.plasmas !== plasmas)) { invalid = true; return; }
    counts.set(slot, {...spawns[slot], frags, plasmas});
  }
  return {record, rows() {
    return invalid || counts.size !== spawns.length ? null : spawns.map(s => counts.get(s.slot));
  }};
}

export function corroboratedOpening(spawns, views) {
  if (views.length < 2 || new Set(views.map(v => v.player)).size !== views.length) return null;
  const rows = views[0].rows;
  if (!rows || views.some(v => !v.rows || !sameOpening(v.rows,rows)) || sameOpening(rows,spawns)) return null;
  return rows;
}

function sameOpening(a,b) {
  return a?.length === b.length && b.every((row,i) => a[i].slot === row.slot && a[i].unit === row.unit &&
    a[i].frags === row.frags && a[i].plasmas === row.plasmas);
}

export function verifyOpening(log, plan) {
  assert.ok(sameOpening(openingSpawnRows(log,plan.rows.length), plan.rows),
    'Recorded opening inventory was not applied to every original unit');
  return {source:'corroborated_host_inventory_messages', original_mismatch_update:plan.mismatch,
    source_players:plan.players, initial_spawns:plan.rows};
}

export class OpeningInventoryDesync extends Error {
  constructor(stage, values, envelope, filmHash, log, cause) {
    super('Host playback diverged after its opening spawns', {cause});
    Object.assign(this,{stage,values,envelope,filmHash});
    this.mismatch = Number(log.match(/FILM DESYNCED AT UPDATE (\d+): the recording's RNG seed was [\dA-F]+ and this replay's is [\dA-F]+/i)?.[1]);
    this.spawns = openingSpawnRows(log,envelope.players);
  }
}

export async function recordedOpening(error, deadline) {
  const {stage,values,envelope,filmHash,spawns,mismatch} = error;
  if (!spawns || envelope.first_update !== 0 || !(mismatch > 1 && mismatch < envelope.ticks)) return null;
  const bytes = await readFile(values.film);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), filmHash);
  if (bytes.readUInt32LE(64) !== 536) return null;
  const match = inspectMatchFilm(bytes,matchFilmPolicy(OPENING_GRENADES_EXPORTER));
  if (match.parts.length < 2 || match.parts.some(p => p.envelope.first_update !== 0 ||
      p.envelope.match_id !== match.host.match_id)) return null;
  const directory = join(stage,'opening-witnesses');
  await mkdir(directory);
  const views = [];
  for (const part of match.parts) {
    const film = await restoreMatchPart(directory,values,bytes,part,deadline);
    try {
      const witness = openingInventoryWitness(spawns,Math.min(envelope.tick_rate,mismatch-1));
      const source = await readEnvelope(film,{allowClientView:true,observeRecord:witness.record});
      if (source.recording_kind !== 'client-view' || source.recorded_own_player !== part.player ||
          !(source.recorded_local_player_mask & (1 << part.player)) || source.match_id !== match.host.match_id) return null;
      views.push({player:part.player,rows:witness.rows()});
    } finally { await unlink(film); }
  }
  const rows = corroboratedOpening(spawns,views);
  return rows && {rows,players:views.map(v => v.player),mismatch};
}

