// One real packaged host worker plus isolated, equally capped client containers.
// Shared local disk replaces S3/dispatch. Results are NOT hosted Lambda timings.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {join,basename} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const [root,output]=process.argv.slice(2);
const config=JSON.parse(await readFile(join(output,'configuration.json'),'utf8'));
assert.equal(config.memory_mb,3008);assert.equal(config.client_concurrency,4);assert.equal(config.overlap_host,true);
const spool=join(output,'fanout');await mkdir(spool);
const code=join(output,'code/runtime/convert-match-tracks.mjs');
let source=await readFile(code,'utf8');
assert.equal(source.split('converted=await convertFilm(').length,2);
source="import {delegatedConvert} from '/checks/tools/fanout-client.mjs';\n"+
  source.replace('converted=await convertFilm(','converted=await delegatedConvert(');
await writeFile(code,source);
const hashes=JSON.parse(await readFile(join(output,'runtime-hashes.json'),'utf8'));
const changed=hashes.find(entry=>entry.path.replaceAll('\\','/')==='runtime/convert-match-tracks.mjs');
assert.ok(changed);changed.sha256=createHash('sha256').update(source).digest('hex');
changed.offline_overlay='delegate client conversion through separate capped containers';
await writeFile(join(output,'runtime-hashes.json'),JSON.stringify(hashes,null,2));
const id='h1-fanout-'+randomUUID(),volume=id,processes=[];
function run(args,logPath,name) {
  const fd=openSync(logPath,'wx'),started=performance.now();
  const child=spawn('docker',args,{windowsHide:true,stdio:['ignore',fd,fd]});
  const record={name,done:false,child,started};processes.push(record);
  record.promise=new Promise(resolve=>{
    child.once('error',error=>{record.error=error.message;});
    child.once('close',code=>{record.done=true;record.code=code;record.seconds=(performance.now()-started)/1000;closeSync(fd);resolve(code);});
  });return record;
}
const setup=run(['volume','create',volume],join(output,'volume.log'),'volume');
assert.equal(await setup.promise,0);
const common=['run','--rm','--network','none','--read-only','--cpus',config.cpus,
  '--memory','3008m','--memory-swap','3008m','--env','PYTHONPATH=/var/task',
  '--env','PYTHONDONTWRITEBYTECODE=1','--env','H1_BENCH_FANOUT=/evidence/fanout',
  '--mount',`type=volume,source=${volume},target=/tmp`,
  '--mount',`type=bind,source=${config.film},target=/input/film.h1film,readonly`,
  '--mount',`type=bind,source=${config.map},target=/input/${basename(config.map)},readonly`,
  '--mount',`type=bind,source=${output},target=/evidence`,
  '--mount',`type=bind,source=${root},target=/checks,readonly`,
  '--mount',`type=bind,source=${join(output,'code/runtime')},target=/var/task/runtime,readonly`,
  '--mount',`type=bind,source=${join(output,'code/convert.mjs')},target=/var/task/convert.mjs,readonly`,
  '--mount',`type=bind,source=${join(root,'tests')},target=/var/task/h1_film/tests,readonly`];
let succeeded=false;
try {
  const parent=run([...common,'--name',id+'-host','--env','H1_BENCH_EVIDENCE=/evidence',
    '--env','H1_BENCH_CLIENTS=4','--env','H1_BENCH_OVERLAP=1','--entrypoint','/var/lang/bin/python3.12',
    config.image_id,'/checks/tools/benchmark-worker.py','--film','/input/film.h1film',
    '--map','/input/'+basename(config.map),'--output','/tmp/benchmark-products',
    '--analytics-revision','5','--exporter-revision','24','--viewer-revision','10'],join(output,'run.log'),id+'-host');
  const pending=new Set(),deadline=performance.now()+900000;
  while(!parent.done) {
    assert.ok(performance.now()<deadline,'Offline fan-out deadline exceeded');
    for(const file of (await readdir(spool)).filter(n=>n.endsWith('.request.json'))) {
      if(pending.has(file))continue;pending.add(file);
      assert.ok(pending.size<=16,'Too many delegated clients');
      const name=id+'-'+pending.size;
      run([...common,'--name',name,'--entrypoint','/var/lang/bin/node',config.image_id,
        '/checks/tools/fanout-client.mjs','run','/evidence/fanout/'+file],join(spool,file+'.log'),name);
    }
    for(const record of processes)if(record.done&&record.code!==0)throw new Error(`${record.name} failed; inspect its log`);
    await delay(50);
  }
  assert.equal(parent.code,0,'Packaged parent failed; inspect run.log');
  const children=processes.filter(p=>p.name!==id+'-host'&&p.name!=='volume');
  assert.ok(children.length>0);assert.ok((await Promise.all(children.map(p=>p.promise))).every(code=>code===0));
  succeeded=true;
} finally {
  for(const record of processes.filter(p=>!p.done)) {
    const stop=run(['rm','--force',record.name],join(output,record.name+'-stop.log'),'stop-'+record.name);
    await stop.promise;await record.promise;
  }
  await writeFile(join(output,'fanout-processes.json'),JSON.stringify({scope:'offline isolated containers, shared disk',volume,
    success:succeeded,processes:processes.map(({name,seconds,code,error})=>({name,seconds,code,error}))},null,2));
  if(succeeded) {
    const cleanup=run(['volume','rm',volume],join(output,'volume-cleanup.log'),'volume-cleanup');
    assert.equal(await cleanup.promise,0,'Fresh benchmark volume cleanup failed');
  }
}
