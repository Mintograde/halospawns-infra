// Compare only encoder CPU work on an identical retained transport stream.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {sha256} from '../runtime/engine-store.mjs';
const [input,output,evidence]=process.argv.slice(2);assert.ok(input&&output&&evidence);
await mkdir(output);await mkdir(evidence,{recursive:true});
const source=join(input,'transport.bin'),request=join(input,'request.json'),runs=[];
const timings=['assemblyDurationMs','sourceProjectionDurationMs','chunkEncodeDurationMs',
  'tickHashDurationMs','validationDurationMs','compressionDurationMs','chunkWriteDurationMs','nativeViewerDurationMs'];
let expected;
for(let round=0;round<4;round++) {
  for(const variant of round%2?['candidate','baseline']:['baseline','candidate']) {
    const id=variant+'-'+round,directory=join(output,id),binary=variant==='baseline'?'/var/task/bin/h1-film-encoder':'/candidate/h1-film-encoder';
    const fd=openSync(source,'r'),log=openSync(join(output,id+'.log'),'wx'),started=performance.now();
    try {
      const child=spawn(binary,['encode',request,directory],{stdio:[fd,log,log],timeout:180000,killSignal:'SIGKILL'});
      const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
      assert.equal(code,0,await readFile(join(output,id+'.log'),'utf8'));
    } finally {closeSync(fd);closeSync(log);}
    const seconds=(performance.now()-started)/1000;
    const report=JSON.parse(await readFile(join(directory,'encoding.json'),'utf8'));
    const stable=structuredClone(report);delete stable.wall_seconds;
    for(const rate of ['120hz','30hz'])for(const key of timings)if(stable[rate])delete stable[rate][key];
    const products={};
    for(const file of (await readdir(directory)).filter(name=>name.endsWith('.hsrdc')||name.endsWith('.json.zst')||name.endsWith('.ndjson'))) {
      products[file]=await sha256(join(directory,file));
    }
    if(expected)assert.deepEqual({stable,products},expected,id+' changed semantic output');
    else expected={stable,products};
    const run={variant,round,warmup:round===0,seconds,products,report};runs.push(run);
    await writeFile(join(evidence,id+'.json'),JSON.stringify(run,null,2));
    console.log(JSON.stringify({id,seconds}));
  }
}
await writeFile(join(evidence,'summary.json'),JSON.stringify({scope:'encoder-only, identical stream, warmup excluded',
  transport_sha256:await sha256(source),request_sha256:await sha256(request),runs},null,2));
