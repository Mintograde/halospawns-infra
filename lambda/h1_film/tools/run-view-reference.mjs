// Offline reference runner. Inputs are copied into a new, caller-owned work directory.
import assert from 'node:assert/strict';
import {mkdir,copyFile,open,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectViewIdentity} from './inspect-view-pair.mjs';
import {readEnvelope,verifyPlayback} from '../runtime/adapters/beta5-v2-120.mjs';
import * as beta6 from '../runtime/adapters/beta6-v3-120.mjs';
const [engineArg,filmArg,mapArg,outputArg,...flags]=process.argv.slice(2);
assert.ok(outputArg,'Usage: node run-view-reference.mjs ENGINE FILM MAP NEW_OUTPUT [--capture]');
const [engine,film,map,output]=[engineArg,filmArg,mapArg,outputArg].map(p=>resolve(p));
const filmBytes=await readFile(film),format3=filmBytes.readUInt32LE(4)===3;
const envelope=await (format3?beta6.readEnvelope:readEnvelope)(film,{allowClientView:true});
const source=format3?{sha256:createHash('sha256').update(filmBytes).digest('hex'),size_bytes:filmBytes.length,
  frame_count:envelope.ticks,map:envelope.map,match_id:envelope.match_id,recording_kind:envelope.recording_kind}:inspectViewIdentity(filmBytes);
const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const mapHash=await sha(map);
await mkdir(output); await mkdir(output+'/maps');
await copyFile(film,output+'/input.h1film'); await copyFile(map,output+'/maps/'+source.map+'.map');
const wasm=engine.endsWith('.js'),capture=flags.includes('--capture');
const log=await open(output+'/engine.log','wx');
const ticks=wasm ? await open(capture?output+'/ticks.hsft':'NUL',capture?'wx':'w'):null;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(BLAMPC_|H1_EXPORT_|H1_ROSTER_|AWS_)/i.test(key)));
Object.assign(env,{BLAMPC_FILM_RING:'0',BLAMPC_FILM_KEYFRAME_TICKS:'432001',BLAMPC_FILM_VIEW_DELIVERED:'1',BLAMPC_WINDOW_BACKGROUND:'1'});
if(wasm) env.H1_EXPORT_HANDLE='3';
const args=['--film','input.h1film','--deterministic','--ticks',String(source.frame_count+10),'--dump',capture&&!wasm?'ticks.hsft':'NUL'];
const started=performance.now();
const child=spawn(wasm?process.execPath:engine,wasm?[engine,...args]:args,{cwd:output,env,windowsHide:true,
  timeout:900000,stdio:['ignore',log.fd,log.fd,...(ticks?[ticks.fd]:[])]});
const exit=await new Promise((r,j)=>{child.on('error',j);child.on('close',(code,signal)=>r({code,signal}));});
await log.close(); if(ticks) await ticks.close();
const text=await readFile(output+'/engine.log','utf8');
const lines=text.split(/\r?\n/).filter(l=>/DESYNC|self-check:|VERDICT:|network changes put back:|\[film\] played|export.*fail/i.test(l));
const result={source,map_sha256:mapHash,engine_sha256:await sha(engine),exit,seconds:(performance.now()-started)/1000,lines,
  source_unchanged:await sha(film)===source.sha256 && await sha(map)===mapHash};
if(wasm)result.wasm_sha256=await sha(engine.replace(/\.js$/,'.wasm'));
try {
  assert.equal(exit.code,0,'Engine failed');
  assert.ok(result.source_unchanged,'Source changed');
  assert.equal(await sha(output+'/input.h1film'),source.sha256,'Staged source changed');
  assert.equal(await sha(output+'/maps/'+source.map+'.map'),mapHash,'Staged map changed');
  result.simulation=(format3?beta6.verifyPlayback:verifyPlayback)(text,envelope);
  result.verified=true;
} catch(error) {result.verified=false;result.validation_error=error.message;}
await writeFile(output+'/summary.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(!result.verified) process.exitCode=1;
