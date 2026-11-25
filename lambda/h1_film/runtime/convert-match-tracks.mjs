import {sourceRateKey,sourceReplayName} from './tick-rates.mjs';
import assert from 'node:assert/strict';
import {remoteMatchTracks} from './world-pool.mjs';
import {orderedPool} from './ordered-pool.mjs';
import {open,readFile,writeFile,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {inspectMatchFilm,matchFilmPolicy,recordedMatchIdsCompatible} from './match-film.mjs';
import {fnv1a} from './format3-codec.mjs';
import {readEnvelope} from './film.mjs';
import {sha256} from './engine-store.mjs';
import {clientDesyncEvidence} from './client-desync.mjs';
import {clientRosterEvidence} from './client-roster.mjs';
import {preparePovRecovery,IncompletePovRecovery} from './pov-recovery.mjs';
import {EMPTY_CLIENT_BUILD_EXPORTER, RECHECK_CLIENT_MATCH_EXPORTER, hostForEmptyClientBuild,
  recheckedClientMatch, unsupportedClientBuild} from './client-build.mjs';
import {profileById,BUILD_MATCHING} from './profiles.mjs';

const runEngine = promisify(execFile);
const permissionModule = new URL('./engine-permissions.mjs',import.meta.url);
function readEngineArgs(values) {
  return ['--permission', `--allow-fs-read=${values.film}`, `--allow-fs-read=${dirname(values.engine)}`,
    `--allow-fs-read=${fileURLToPath(permissionModule)}`, '--import', permissionModule.href];
}
function engineEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(BLAMPC_|H1_EXPORT_|AWS_)/i.test(k)));
}

function lazyMatchCheck(stage, values, deadline) {
  let run;
  return () => {
    const timeout = Math.floor(deadline - performance.now());
    assert.ok(timeout > 0, 'Match conversion timed out before checking client inputs');
    run ??= runEngine(process.execPath, [...readEngineArgs(values), values.engine, '--film-match-check', values.film],
      {cwd:stage, env:engineEnvironment(), timeout, killSignal:'SIGKILL', maxBuffer:256*1024, windowsHide:true});
    return run;
  };
}

export async function restoreMatchPart(stage,values,bytes,part,deadline) {
  const id=`client-${part.index}`,film=join(stage,`${id}.h1film`);
  if(part.rest.flags&1) {
    // Use the pinned upstream restorer for the RNET shared-message representation.
    // Validate its complete result before allowing any simulation or publication.
    const args=[...readEngineArgs(values),`--allow-fs-read=${stage}`,`--allow-fs-write=${film}`,
      values.engine,'--film-part-export',values.film,String(part.index),film];
    const timeout=Math.min(60000,Math.floor(deadline-performance.now()));assert.ok(timeout>0,'Match conversion timed out');
    const log=openSync(join(stage,`${id}-restore.log`),'wx');
    try {
      const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',log,log],timeout,
        env:engineEnvironment()});
      const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
      assert.equal(code,0,'Thin client restoration failed');
    } finally {closeSync(log);}
  } else await writeFile(film,bytes.subarray(part.offset,part.offset+part.size),{flag:'wx'});
  assert.equal((await stat(film)).size,part.rest.whole_size,'Restored client size differs');
  if (part.rest.fnv1a) assert.equal(fnv1a(await readFile(film)),part.rest.fnv1a,'Restored client checksum differs');
  return film;
}

export async function convertMatchTrack(stage,values,report,convertFilm,deadline,bytes,match,part,
  checkMatch = lazyMatchCheck(stage,values,deadline)) {
  const policy=matchFilmPolicy(report.exporter_revision);
  const id=`client-${part.index}`,film=await restoreMatchPart(stage,values,bytes,part,deadline);
  const checkEmptyLabel = report.exporter_revision >= EMPTY_CLIENT_BUILD_EXPORTER && part.envelope.build === ''
    && bytes.subarray(part.offset + 384, part.offset + 448).every(b => b === 0);
  let verifiedClientHost;
  if (checkEmptyLabel) {
    const restored = await open(film);
    try {
      const label = Buffer.alloc(64);
      assert.equal((await restored.read(label,0,64,384)).bytesRead,64);
      if (label.every(b => b === 0))
        verifiedClientHost = hostForEmptyClientBuild(report, match.host, part.player);
    } finally { await restored.close(); }
  }
  if (verifiedClientHost && report.exporter_revision >= RECHECK_CLIENT_MATCH_EXPORTER &&
      part.envelope.match_id === '0000000000000000') {
    const {stdout} = await checkMatch();
    const evidence = recheckedClientMatch(stdout,match.parts,part);
    if (evidence) verifiedClientHost.match_check = evidence;
  }
  const filmHash = await sha256(film);
  const envelope=await readEnvelope(film,{allowClientView:true,botAwareHost:report.exporter_revision>=26,
    allowCappedClientNetwork:report.exporter_revision >= 50, allowTextClientSettings:verifiedClientHost?.tick_rate === 120,
    allowMissingTextSettingsId:Boolean(verifiedClientHost?.match_check)});
  assert.equal(envelope.recorded_own_player,part.player,'Recorded client player differs');
  assert.equal(envelope.match_id,part.envelope.match_id,'Restored client match ID changed');
  assert.ok(recordedMatchIdsCompatible(envelope.match_id,match.host.match_id,policy),'Restored client match differs');
  const remaining=(deadline-performance.now())/1000;assert.ok(remaining>1,'Match conversion timed out');
  const track={id,part,envelope,source_film_sha256:filmHash};
  if (envelope.network?.failure) {
    return {...track,status:'unavailable',failure:envelope.network.failure};
  }
  const unsupported=unsupportedClientBuild(envelope,{...profileById(report.engine_profile),tick_rate:report.envelope.tick_rate},
    report.exporter_revision,BUILD_MATCHING[report.engine_profile]);
  if(unsupported) {
    return {...track,status:'unavailable',failure:unsupported};
  }
  const options={...values,film,verifiedClientHost,inspectedClient:{envelope,filmHash},analytics:false,reference:undefined,'engine-root':undefined,
    'client-view':true,'embedded-match':true,'trusted-local':true,'skip-readback':true,'source-viewer-only':true,'analytics-revision':'2','viewer-revision':'5'};
  let converted, directory=id;
  try { converted=await convertFilm({...options,output:join(stage,id),timeout:String(remaining)});
  } catch(error) {
    const failure=(report.exporter_revision>=16 && clientDesyncEvidence(error))
      || (report.exporter_revision>=18 && clientRosterEvidence(error));
    if(!failure)throw error;
    assert.equal(await sha256(film),track.source_film_sha256,'Client source changed');
    const unavailable={...track,status:'unavailable',failure};
    if(report.exporter_revision<46||failure.reason!=='simulation_desync')return unavailable;
    const plan=preparePovRecovery(bytes,match,track,await readFile(film),failure);
    if(!plan)return unavailable;
    directory=id+'-recovered';
    const seconds=(deadline-performance.now())/1000;
    assert.ok(seconds>1,'Match conversion timed out before client recovery');
    try {
      converted=await convertFilm({...options,output:join(stage,directory),timeout:String(seconds),povRecovery:plan});
    } catch(retryError) {
      if(clientDesyncEvidence(retryError)||clientRosterEvidence(retryError))return unavailable;
      for(let e=retryError;e;e=e.cause)if(e instanceof IncompletePovRecovery)return unavailable;
      throw retryError;
    }
    assert.ok(converted.pov_recovery,'Verified recovery lacks its proof');
  }
  assert.equal(converted.provenance.map_sha256,report.provenance.map_sha256);
  for(const key of ['wasm_sha256','glue_sha256'])assert.equal(converted.provenance[key],report.provenance[key]);
  return {...track,...(report.exporter_revision>=16?{status:'available'}:{}),verification:converted.simulation,
    ...(converted.pov_recovery?{recovery:converted.pov_recovery}:{}),
    world:`${directory}/candidate/${sourceReplayName(envelope.tick_rate)}`,world_sha256:converted.encoding[sourceRateKey(envelope.tick_rate)].sha256};
}

export async function convertMatchTracks(stage,values,report,convertFilm,deadline,prepared) {
  const bytes=prepared?.bytes ?? await readFile(values.film);
  const match=prepared?.match ?? inspectMatchFilm(bytes,matchFilmPolicy(report.exporter_revision));
  assert.equal(match.sha256,report.provenance.film_sha256,'Match film changed');
  const checkMatch = lazyMatchCheck(stage,values,deadline);
  const local = part => convertMatchTrack(stage,values,report,convertFilm,deadline,bytes,match,part,checkMatch);
  const concurrency = Number(values['client-concurrency'] ?? 1);
  let tracks;
  if (values['world-socket']) {
    tracks = await remoteMatchTracks({bytes, match, report, stage, socket:values['world-socket'],
      hostReady:values.hostReady, deadline, concurrency, local});
  } else {
    tracks = await orderedPool(match.parts, concurrency, local);
  }
  const result={schema:'halospawns.h1MatchTracks.v1',source_film_sha256:match.sha256,match_id:match.host.match_id,
    version:match.version,tracks};
  await writeFile(join(stage,'match-tracks.json'),JSON.stringify(result),{flag:'wx'});
  return {schema:result.schema,match_id:result.match_id,client_count:tracks.length,
    ...(report.exporter_revision>=16?{unavailable_client_count:tracks.filter(t=>t.status==='unavailable').length}:{})};
}
