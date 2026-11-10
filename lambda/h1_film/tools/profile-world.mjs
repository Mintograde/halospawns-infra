// Diagnostic ablations only. No variant is accepted as a processing recipe.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {copyFile,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {adapterFor,readEnvelope} from '../runtime/film.mjs';
import {profileById,selectExporter} from '../runtime/profiles.mjs';
import {resolveEngine,inspectEngine,sha256} from '../runtime/engine-store.mjs';

const [input,output] = process.argv.slice(2);
assert.ok(input && output);
const baseline=JSON.parse(await readFile(join(input,'report.json')));
const request=JSON.parse(await readFile(join(input,'request.json')));
const profile=selectExporter(profileById(baseline.engine_profile),baseline.exporter_revision);
let engine;
if (process.env.H1_PROFILE_CANDIDATE) {
  const receipt=JSON.parse((await readFile(join(process.env.H1_PROFILE_CANDIDATE,'build-candidate.json'),'utf8')).replace(/^\uFEFF/,''));
  assert.equal(receipt.schema,'halospawns.h1EngineBuildCandidate.v1');
  assert.equal(receipt.inputs.source.git_commit,profile.source.git_commit);
  assert.equal(receipt.inputs.source.sha256,profile.source.sha256);
  engine=await inspectEngine({...profile,wasm_sha256:receipt.wasm_sha256,glue_sha256:receipt.glue_sha256},
    join(process.env.H1_PROFILE_CANDIDATE,'h1-film.js'));
} else engine=await resolveEngine(profile,process.env.H1_ENGINE_ROOT);
await mkdir(output);
await mkdir(join(output,'work/maps'),{recursive:true});
await mkdir(join(output,'work/stats'));
await mkdir(join(output,'work/films'));
const work=join(output,'work'),film=join(work,'input.h1film');
const client=baseline.envelope.recording_kind==='client-view';
await copyFile(join(input,'work',client?'input.h1film':'authoritative.h1film'),film);
await copyFile(join(input,'work/maps',baseline.envelope.map+'.map'),join(work,'maps',baseline.envelope.map+'.map'));
assert.equal(await sha256(join(work,'maps',baseline.envelope.map+'.map')),baseline.provenance.map_sha256);
const envelope=await readEnvelope(film,{allowClientView:client});
const adapter=adapterFor(profile),results=[];
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(BLAMPC_|H1_EXPORT_)/.test(key)));
Object.assign(env,{BLAMPC_FILM_RING:'0',BLAMPC_FILM_KEYFRAME_TICKS:'432001',BLAMPC_FILM_VIEW_DELIVERED:'1',
  BLAMPC_STATS_DIR:join(work,'stats'),BLAMPC_FILM_DIR:join(work,'films')});
async function run(name,flags,exporting,sinkPath) {
  const log=openSync(join(output,name+'.log'),'wx'),sink=openSync(sinkPath||'/dev/null',sinkPath?'wx':'w');
  const started=performance.now();
  try {
    const proc=spawn(process.execPath,[...flags,'--import',new URL('../runtime/metrics.mjs',import.meta.url).href,
      engine.glue,'--film','input.h1film','--deterministic','--ticks',String(envelope.ticks+10),...(exporting?['--dump','NUL']:[])],
      {cwd:work,env:{...env,H1_EXPORT_METRICS:join(output,name+'.metrics.json'),...(exporting?{H1_EXPORT_HANDLE:'3'}:{})},
        stdio:['ignore',log,log,sink],timeout:180000,killSignal:'SIGKILL'});
    const code=await new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('close',resolve);});
    assert.equal(code,0,await readFile(join(output,name+'.log'),'utf8'));
  } finally {closeSync(log);closeSync(sink);}
  const seconds=(performance.now()-started)/1000;
  const simulation=adapter.verifyPlayback(await readFile(join(output,name+'.log'),'utf8'),envelope);
  assert.deepEqual(simulation,baseline.simulation);
  results.push({name,seconds,simulation,resources:JSON.parse(await readFile(join(output,name+'.metrics.json')))});
}
// Export drains gameplay hooks. Omitting it overflows the event budget, so a
// no-export run is not a valid simulation-only ablation for this retained engine.
await run('export-null',[],true);
await run('export-optimized',['--no-liftoff'],true);
await run('cpu-profile',['--cpu-prof',`--cpu-prof-dir=${output}`,'--cpu-prof-name=engine.cpuprofile'],true);
const stream=join(output,'transport.bin');
await run('capture',[],true,stream);
await writeFile(join(output,'request.json'),JSON.stringify(request));
const source=openSync(stream,'r'),log=openSync(join(output,'encoder.log'),'wx');
const started=performance.now();
try {
  const proc=spawn('/var/task/bin/h1-film-encoder',['encode',join(output,'request.json'),join(output,'encoded')],
    {stdio:[source,log,log],timeout:180000,killSignal:'SIGKILL'});
  const code=await new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('close',resolve);});
  assert.equal(code,0,await readFile(join(output,'encoder.log'),'utf8'));
} finally {closeSync(source);closeSync(log);}
const encoderSeconds=(performance.now()-started)/1000;
const encoding=JSON.parse(await readFile(join(output,'encoded/encoding.json')));
assert.equal(encoding['120hz'].sha256,baseline.encoding['120hz'].sha256);
const summary={schema:'halospawns.h1WorldProfile.v1',scope:'offline ablations; not end-to-end timing',
  unregistered_candidate:Boolean(process.env.H1_PROFILE_CANDIDATE),
  simulation_only:'unsupported: exporter must drain per-tick gameplay hooks',
  engine:engine.hashes,source_film_sha256:await sha256(film),request,results,encoder_seconds:encoderSeconds,
  transport_bytes:(await stat(stream)).size,transport_sha256:await sha256(stream),world_sha256:encoding['120hz'].sha256};
await writeFile(join(output,'profile.json'),JSON.stringify(summary,null,2));
if (process.env.H1_PROFILE_EVIDENCE) {
  await mkdir(process.env.H1_PROFILE_EVIDENCE,{recursive:true});
  for (const file of ['profile.json','engine.cpuprofile']) {
    await copyFile(join(output,file),join(process.env.H1_PROFILE_EVIDENCE,file));
  }
}
console.log(JSON.stringify({results:results.map(({name,seconds})=>({name,seconds})),encoderSeconds,bytes:summary.transport_bytes}));
