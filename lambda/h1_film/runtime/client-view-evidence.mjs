// Worker-owned inspection: no simulator commands or remote paths are accepted.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readEnvelope} from './adapters/beta5-v2-120.mjs';
import {selectProfile} from './profiles.mjs';
import {encodeDiagnostics} from './export-diagnostics.mjs';
import {sha256} from './engine-store.mjs';

export function filmEvidence(e, profile) {
  return {engine_profile:profile, format:e.format, protocol_revision:e.protocol_revision,
    tick_rate:e.tick_rate, build:e.build, scenario:e.map, map_size_bytes:e.map_bytes,
    ...(e.map_bytes === 0 ? {map_size_evidence:'halospawns.h1MissingMapSize.v1'} : {}),
    ...(e.network?.roster_recovery ? {roster_recovery:e.network.roster_recovery} : {}),
    source_tick_count:e.ticks, player_count:e.network?.participant_count ?? e.players,
    hash_sample_count:e.hash_samples};
}

export async function inspectViewRecording(path) {
  const envelope=await readEnvelope(path,{allowClientView:true});
  const profile=selectProfile(envelope);
  assert.equal(profile.id,'h1-performance-beta5-p9818-wasm-v1');
  assert.ok(envelope.match_id !== '0000000000000000');
  assert.ok(envelope.recorded_own_player <= 15);
  const sourceHash=await sha256(path);
  const result={film:filmEvidence(envelope,profile.id), source_film_sha256:sourceHash,
    recording_role:envelope.recording_kind==='client-view'?'client':'host',
    match_id:envelope.match_id, recorded_own_player:envelope.recorded_own_player,
    first_update:envelope.first_update};
  if(result.recording_role==='client') {
    result.clocks=envelope.network.clocks.filter(c=>c.frame < envelope.first_update+envelope.ticks)
      .map(c=>({frame:c.frame-envelope.first_update,game_tick:c.game_tick}));
  } else {
    // Map identity is supplied and independently checked by the worker. It is not
    // encoded in the raw diagnostics section, so this placeholder never leaves here.
    const diagnostics=encodeDiagnostics(await readFile(path),{film_sha256:sourceHash,
      raw_map_sha256:'0'.repeat(64),engine_profile:profile.id,source_tick_count:envelope.ticks,source_tick_rate:120});
    const section=diagnostics.manifest.sections.find(s=>s.kind==='client');
    if(section) {
      result.diagnostic_recorded_own_player=section.own_player;
      const table=section.tables.find(t=>t.name==='clock');
      const body=32+diagnostics.bytes.readUInt32LE(16);
      result.alignment_rows=[];
      for(let i=0;i<table.count;i++) {
        const at=body+table.offset+i*table.stride;
        const row=[diagnostics.bytes.readInt32LE(at),diagnostics.bytes.readInt32LE(at+4)];
        if(row.every(v=>v>=0))result.alignment_rows.push(row);
      }
    }
  }
  return result;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length,4,'Usage: client-view-evidence.mjs FILM OUTPUT');
  const result=await inspectViewRecording(process.argv[2]);
  const bytes=JSON.stringify(result);
  assert.ok(Buffer.byteLength(bytes)<=32*1024*1024);
  await writeFile(process.argv[3],bytes+'\n',{flag:'wx'});
}
