// Offline IPC only. Mounted into isolated benchmark containers, never a cloud protocol.
import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {convertFilm} from '/var/task/runtime/convert.mjs';
import {sha256} from '/var/task/runtime/engine-store.mjs';
import {ClientDesync,clientDesyncEvidence} from '/var/task/runtime/client-desync.mjs';
import {ClientRosterMismatch,clientRosterEvidence} from '/var/task/runtime/client-roster.mjs';
const digest=text=>createHash('sha256').update(text).digest('hex');
async function save(path,value) {
  await writeFile(path+'.partial',JSON.stringify(value),{flag:'wx'});
  await rename(path+'.partial',path);
}
export async function delegatedConvert(options) {
  assert.equal(process.env.H1_BENCH_FANOUT,'/evidence/fanout');
  assert.equal(options['embedded-match'],true);assert.equal(options['client-view'],true);
  const id=randomUUID(),request={id,options,film_sha256:await sha256(options.film)};
  const text=JSON.stringify(request),pin=digest(text),path=join(process.env.H1_BENCH_FANOUT,id);
  await save(path+'.request.json',{request,sha256:pin});
  const deadline=performance.now()+Number(options.timeout)*1000;
  while(performance.now()<deadline) {
    let response;
    try {response=JSON.parse(await readFile(path+'.response.json','utf8'));}
    catch(error) {if(error.code!=='ENOENT')throw error;await delay(50);continue;}
    assert.equal(response.id,id);assert.equal(response.request_sha256,pin);
    assert.equal(await sha256(options.film),request.film_sha256);
    if(response.ok) {
      assert.equal(response.report.provenance.film_sha256,request.film_sha256);
      return response.report;
    }
    const cause=new Error(response.message);
    if(response.desync)throw new ClientDesync(response.desync,cause);
    if(response.roster)throw new ClientRosterMismatch(response.roster,cause);
    throw cause;
  }
  throw new Error('Offline fan-out client deadline exceeded');
}
if(process.argv[2]==='run') {
  const path=process.argv[3],job=JSON.parse(await readFile(path,'utf8'));
  assert.equal(digest(JSON.stringify(job.request)),job.sha256);
  const {id,options,film_sha256}=job.request;
  assert.equal(await sha256(options.film),film_sha256);
  const started=performance.now();let response;
  try {response={ok:true,report:await convertFilm(options)};}
  catch(error) {response={ok:false,message:error.message,desync:clientDesyncEvidence(error),roster:clientRosterEvidence(error)};}
  const metrics={seconds:(performance.now()-started)/1000};
  for(const key of ['memory/memory.max_usage_in_bytes','cpuacct/cpuacct.usage']) {
    try {metrics[key]=await readFile('/sys/fs/cgroup/'+key,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await save(path.replace('.request.json','.response.json'),{id,request_sha256:job.sha256,...response,metrics});
}
