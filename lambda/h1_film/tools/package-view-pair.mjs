import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,mkdir,stat,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sha256} from '../runtime/engine-store.mjs';
import {readEnvelope,verifyPlayback} from '../runtime/adapters/beta5-v2-120.mjs';
import {encodeDiagnostics} from '../runtime/export-diagnostics.mjs';
import {VIEW_TRACKS_SCHEMA,validateViewTracks} from '../runtime/view-tracks.mjs';

export async function packageViewPair(hostDirectory,clientDirectory,output) {
  const inputs=[];
  for(const [role,directory] of [['host',hostDirectory],['client',clientDirectory]]) {
    const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
    assert.ok(['simulation_and_encoding_verified','simulation_and_artifacts_verified'].includes(report.status),'Unverified conversion');
    const film=join(directory,'work/input.h1film');
    const envelope=await readEnvelope(film,{allowClientView:true});
    assert.equal(envelope.recording_kind,role==='host'?'host':'client-view','Wrong track role');
    assert.equal(await sha256(film),report.provenance.film_sha256,'Source changed');
    assert.equal(await sha256(join(directory,'work/maps',envelope.map+'.map')),report.provenance.map_sha256,'Staged map changed');
    verifyPlayback(await readFile(join(directory,'playback.log'),'utf8'),envelope);
    const artifact=join(directory,'candidate/replay.120hz.hsrdc');
    const encoding=JSON.parse(await readFile(join(directory,'candidate/encoding.json'),'utf8'));
    assert.equal(encoding.source_ticks,envelope.ticks);
    assert.equal(encoding.viewer_profile_revision,5);
    assert.equal(encoding['120hz'].sha256,await sha256(artifact),'Artifact changed');
    assert.equal(encoding['120hz'].sizeBytes,(await stat(artifact)).size);
    inputs.push({role,directory,film,envelope,report,artifact,encoding});
  }
  const [host,client]=inputs;
  assert.equal(host.envelope.match_id,client.envelope.match_id,'Different matches');
  assert.equal(host.envelope.map,client.envelope.map,'Different scenarios');
  assert.equal(host.report.engine_profile,client.report.engine_profile,'Different engine profiles');
  assert.equal(host.report.provenance.map_sha256,client.report.provenance.map_sha256,'Different maps');
  assert.equal(host.envelope.recorded_own_player,client.envelope.recorded_own_player,'Different recording players');
  // The copy's diagnostic clocks belong to this recording client, not an arbitrary
  // authoritative film from another machine that happens to share the match ID.
  const diagnostics=encodeDiagnostics(await readFile(host.film),{
    film_sha256:host.report.provenance.film_sha256,raw_map_sha256:host.report.provenance.map_sha256,
    engine_profile:host.report.engine_profile,source_tick_count:host.envelope.ticks,source_tick_rate:120});
  const section=diagnostics.manifest.sections.find(s=>s.kind==='client');
  assert.ok(section,'Paired host copy lacks client clock evidence');
  assert.equal(section.own_player,client.envelope.recorded_own_player,'Diagnostic recording player mismatch');
  const table=section.tables.find(t=>t.name==='clock');
  const body=32+diagnostics.bytes.readUInt32LE(16),rows=[];
  for(let i=0;i<table.count;i++) {
    const at=body+table.offset+i*table.stride;
    const row=[diagnostics.bytes.readInt32LE(at),diagnostics.bytes.readInt32LE(at+4)];
    // Unknown samples are not evidence for alignment.
    if(row.every(v=>v>=0))rows.push(row);
  }
  const tracks=inputs.map(({role,envelope,report,encoding})=>{
    const id=role==='host'?'host':`client-${report.provenance.film_sha256}`;
    return {id,role,source_film_sha256:report.provenance.film_sha256,
      frame_count:envelope.ticks,first_update:envelope.first_update,
      exporter_revision:report.exporter_revision,wasm_sha256:report.provenance.wasm_sha256,glue_sha256:report.provenance.glue_sha256,
      artifact:{path:id+'/replay.120hz.hsrdc',sha256:encoding['120hz'].sha256,size_bytes:encoding['120hz'].sizeBytes,viewer_revision:5},
      ...(role==='client'?{recorded_own_player:envelope.recorded_own_player,
        clocks:envelope.network.clocks.filter(c=>c.frame<envelope.first_update+envelope.ticks).map(c=>({...c,frame:c.frame-envelope.first_update})),
        alignment:{method:'beta5-client-clock-v1',source_film_sha256:host.report.provenance.film_sha256,rows}}:{})};
  });
  const manifest=validateViewTracks({schema:VIEW_TRACKS_SCHEMA,match_id:host.envelope.match_id,
    engine_profile:host.report.engine_profile,raw_map_sha256:host.report.provenance.map_sha256,
    tick_rate:120,authoritative_track:'host',tracks});
  await assert.rejects(stat(output),{code:'ENOENT'});
  const stage=output+'.partial';await mkdir(stage);
  for(let i=0;i<inputs.length;i++) {
    await mkdir(join(stage,tracks[i].id));
    await copyFile(inputs[i].artifact,join(stage,tracks[i].artifact.path));
    assert.equal(await sha256(join(stage,tracks[i].artifact.path)),tracks[i].artifact.sha256,'Artifact changed while copying');
  }
  await writeFile(join(stage,'replay.views.json'),JSON.stringify(manifest)+'\n',{flag:'wx'});
  await rename(stage,output);
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length,5,'Usage: node package-view-pair.mjs HOST_CONVERSION CLIENT_CONVERSION NEW_OUTPUT');
  const manifest=await packageViewPair(...process.argv.slice(2).map(p=>resolve(p)));
  console.log(JSON.stringify({schema:manifest.schema,match_id:manifest.match_id,tracks:manifest.tracks.map(t=>({id:t.id,frames:t.frame_count}))},null,2));
}
