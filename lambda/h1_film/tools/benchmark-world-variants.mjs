// Compare one complete simulation/encoder pipeline under identical limits.
// Inputs are retained profile-world.mjs directories. Native execution is an
// explicit offline experiment; production Node permissions cannot load addons.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {copyFile,mkdir,readFile,writeFile,readdir,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {adapterFor,readEnvelope} from '../runtime/film.mjs';
import {profileById,selectExporter} from '../runtime/profiles.mjs';
import {resolveEngine,sha256} from '../runtime/engine-store.mjs';

const [input,output,evidence]=process.argv.slice(2);assert.ok(input&&output&&evidence);
await mkdir(output);await mkdir(evidence,{recursive:true});
const prior=JSON.parse(await readFile(join(input,'profile.json'),'utf8'));
const profile=selectExporter(profileById('h1-performance-beta6-p9839-wasm-v1'),24);
const engine=await resolveEngine(profile,process.env.H1_ENGINE_ROOT);
assert.deepEqual(engine.hashes,prior.engine);
const work=join(output,'work');await mkdir(join(work,'maps'),{recursive:true});
await mkdir(join(work,'stats'));await mkdir(join(work,'films'));
await copyFile(join(input,'work/input.h1film'),join(work,'input.h1film'));
await copyFile(join(input,'work/maps',prior.request.map+'.map'),join(work,'maps',prior.request.map+'.map'));
const sourceSha=await sha256(join(work,'input.h1film'));assert.equal(sourceSha,prior.source_film_sha256);
const mapSha=await sha256(join(work,'maps',prior.request.map+'.map'));
if(prior.request.analytics_context?.map_sha256)assert.equal(mapSha,prior.request.analytics_context.map_sha256);
const envelope=await readEnvelope(join(work,'input.h1film'),{allowClientView:true});
const request=join(output,'request.json');await writeFile(request,JSON.stringify(prior.request));
const aot=process.env.H1_WORLD_AOT,candidateEncoder=process.env.H1_WORLD_ENCODER,bufferBytes=process.env.H1_WORLD_BUFFER_BYTES;
const baselineBufferBytes=process.env.H1_WORLD_BASELINE_BUFFER_BYTES??'0';
assert.ok(bufferBytes||baselineBufferBytes==='0','Buffer tuning requires a buffered export candidate');
assert.equal([aot,candidateEncoder,bufferBytes].filter(Boolean).length,1,'Select AOT, encoder or buffered export candidate');
const candidatePath=aot||candidateEncoder||new URL('../runtime/export-write-buffer.mjs',import.meta.url).pathname;
const candidateSha=await sha256(candidatePath);
const environment={...process.env,BLAMPC_FILM_RING:'0',BLAMPC_FILM_KEYFRAME_TICKS:'432001',
  BLAMPC_FILM_VIEW_DELIVERED:'1',BLAMPC_STATS_DIR:join(work,'stats'),BLAMPC_FILM_DIR:join(work,'films'),H1_EXPORT_HANDLE:'3'};
const engineFlags=(variant,id)=>['--max-old-space-size=4096','--import',new URL('../runtime/metrics.mjs',import.meta.url).pathname,
  ...(aot&&variant==='candidate'?['--import',new URL('./wasm2c/preload.mjs',import.meta.url).pathname]:[]),
  engine.glue,'--film','input.h1film','--deterministic','--ticks',String(envelope.ticks+10),'--dump','NUL'];
const env=(variant,id)=>({...environment,H1_EXPORT_METRICS:join(evidence,id+'.metrics.json'),
  H1_EXPORT_BUFFER_BYTES:bufferBytes&&variant==='candidate'?bufferBytes:baselineBufferBytes,
  ...(aot&&variant==='candidate'?{H1_AOT_OFFLINE:'1',H1_AOT_MODULE:aot,H1_AOT_RECEIPT:join(evidence,id+'.aot.json')}:{})});
const done=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
const simulation=async log=>{
  const result=adapterFor(profile).verifyPlayback(await readFile(log,'utf8'),envelope);
  assert.deepEqual(result,prior.results[0].simulation);return result;
};

// This separate diagnostic hashes every unprojected byte. Hashing is excluded
// from the timed pipeline pairs and is never substituted for simulation checks.
if(aot||bufferBytes) {
  const id='full-stream-proof',log=join(evidence,id+'.log'),fd=openSync(log,'wx');
  let code,proof;
  if(bufferBytes) {
    // A regular file avoids nonblocking consumer behavior in this separate
    // correctness proof. Timed pairs below always use the production pipe.
    const capture=join(output,'proof.bin'),sink=openSync(capture,'wx');
    try {
      const child=spawn(process.execPath,engineFlags('candidate',id),{cwd:work,env:env('candidate',id),
        stdio:['ignore',fd,fd,sink],timeout:180000,killSignal:'SIGKILL'});
      code=await done(child);
    } finally {closeSync(sink);closeSync(fd);}
    proof={bytes:(await stat(capture)).size,sha256:await sha256(capture)};await unlink(capture);
  } else try {
    const child=spawn(process.execPath,engineFlags('candidate',id),{cwd:work,env:env('candidate',id),
      stdio:['ignore',fd,fd,'pipe'],timeout:180000,killSignal:'SIGKILL'});
    const completion=done(child),hash=createHash('sha256');let bytes=0;
    for await(const data of child.stdio[3]) {hash.update(data);bytes+=data.length;}
    code=await completion;proof={bytes,sha256:hash.digest('hex')};
  }finally {closeSync(fd);}
  assert.equal(code,0,await readFile(log,'utf8'));
  assert.equal(proof.bytes,prior.transport_bytes);
  assert.equal(proof.sha256,prior.transport_sha256??await sha256(join(input,'transport.bin')));
  await writeFile(join(evidence,'source-proof.json'),JSON.stringify({source_film_sha256:sourceSha,
    candidate_sha256:candidateSha,...proof,simulation:await simulation(log)},null,2));
}

const runs=[];let expected;
for(let round=0;round<4;round++)for(const variant of round%2?['candidate','baseline']:['baseline','candidate']) {
  const id=variant+'-'+round,product=join(output,id),engineLog=join(evidence,id+'.engine.log'),encoderLog=join(evidence,id+'.encoder.log');
  const engineFd=openSync(engineLog,'wx'),encoderFd=openSync(encoderLog,'wx');
  const binary=candidateEncoder&&variant==='candidate'?candidateEncoder:'/var/task/bin/h1-film-encoder';
  const started=performance.now();let engineCode,encoderCode;
  try {
    const encoder=spawn(binary,['encode',request,product],{stdio:['pipe',encoderFd,encoderFd],timeout:180000,killSignal:'SIGKILL'});
    encoder.stdin.on('error',()=>{});
    // Match the real Linux worker, which already uses a blocking pipe.
    assert.equal(encoder.stdin._handle.setBlocking(true),0);
    const encoded=done(encoder);
    const child=spawn(process.execPath,engineFlags(variant,id),{cwd:work,env:env(variant,id),
      stdio:['ignore',engineFd,engineFd,encoder.stdin],timeout:180000,killSignal:'SIGKILL'});
    engineCode=await done(child);encoder.stdin.end();encoderCode=await encoded;
  }finally {closeSync(engineFd);closeSync(encoderFd);}
  const seconds=(performance.now()-started)/1000;
  assert.equal(engineCode,0,await readFile(engineLog,'utf8'));assert.equal(encoderCode,0,await readFile(encoderLog,'utf8'));
  const products={};for(const file of (await readdir(product)).filter(n=>/\.(hsrdc|ndjson|zst)$/.test(n)))products[file]=await sha256(join(product,file));
  if(expected)assert.deepEqual(products,expected,id+' changed products');else expected=products;
  const encoding=JSON.parse(await readFile(join(product,'encoding.json'),'utf8'));
  assert.equal(encoding['120hz'].sha256,prior.world_sha256);
  const run={id,variant,round,warmup:round===0,seconds,products,simulation:await simulation(engineLog),encoding};runs.push(run);
  await writeFile(join(evidence,id+'.json'),JSON.stringify(run,null,2));console.log(JSON.stringify({id,seconds}));
}
assert.equal(await sha256(candidatePath),candidateSha,'Candidate changed');
await writeFile(join(evidence,'summary.json'),JSON.stringify({scope:'one world pipeline, staging/proofs/finalization/cloud excluded',
  source_film_sha256:sourceSha,map_sha256:mapSha,engine:engine.hashes,candidate_sha256:candidateSha,runtime:aot?'wasm2c':'v8',
  production_blocking_pipe:true,buffer_bytes:bufferBytes?Number(bufferBytes):null,
  baseline_buffer_bytes:Number(baselineBufferBytes),runs},null,2));
