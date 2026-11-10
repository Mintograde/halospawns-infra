// Run inside the released image with /input (retained conversion),
// /baseline/runtime, /candidate, /contract.json and /evidence mounts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {copyFile,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';

if(process.argv[2]==='pack') {
  const [variant,output]=process.argv.slice(3);
  assert.ok(['baseline','candidate'].includes(variant));
  const {exportMatchReplay}=await import(`/${variant}/runtime/export-match-replay.mjs`);
  const artifact=JSON.parse(await readFile('/contract.json','utf8')).viewer_artifact;
  const sourceContract=Object.fromEntries(['schema','profile','profile_revision','projection_sha256','encoding_sha256','tick_count'].map(k=>[k,artifact[k]]));
  const started=performance.now();
  const result=await exportMatchReplay({film:'/tmp/packing/input.h1film',directory:'/tmp/packing',
    hostWorld:'/tmp/packing/candidate/replay.120hz.hsrdc',output,sourceContract});
  console.log(JSON.stringify({seconds:(performance.now()-started)/1000,sha256:result.sha256,
    manifest_sha256:result.manifest_sha256,size_bytes:result.size_bytes,usage:process.resourceUsage()}));
} else {
  const root='/tmp/packing';await mkdir(root);
  const tracks=JSON.parse(await readFile('/input/match-tracks.json','utf8')).tracks;
  const files=['report.json','match-tracks.json','candidate/replay.120hz.hsrdc',
    ...tracks.flatMap(t=>[t.id+'.h1film',...(t.world?[t.world]:[])])];
  for(const file of files) {
    await mkdir(dirname(join(root,file)),{recursive:true});await copyFile(join('/input',file),join(root,file));
  }
  await copyFile('/input/work/input.h1film',join(root,'input.h1film'));
  let expected;const runs=[];
  for(let round=0;round<4;round++)for(const variant of round%2?['candidate','baseline']:['baseline','candidate']) {
    const id=variant+'-'+round,output=join(root,id+'.hsrv');
    const child=spawn(process.execPath,[pathToFileURL(process.argv[1]).pathname,'pack',variant,output],
      {stdio:['ignore','pipe','inherit'],timeout:120000,killSignal:'SIGKILL'});
    let stdout='';child.stdout.setEncoding('utf8');child.stdout.on('data',s=>stdout+=s);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    assert.equal(code,0,stdout);
    const result=JSON.parse(stdout),identity={sha256:result.sha256,manifest_sha256:result.manifest_sha256,size_bytes:result.size_bytes};
    if(expected)assert.deepEqual(identity,expected,'Packing changed artifact bytes');else expected=identity;
    const run={variant,round,warmup:round===0,...result};runs.push(run);
    await writeFile('/evidence/'+id+'.json',JSON.stringify(run,null,2));
    console.log(JSON.stringify({id,seconds:result.seconds,peak_rss_kib:result.usage.maxRSS,disk_writes:result.usage.fsWrite}));
    assert.equal(dirname(output),root);
    await rm(output);await rm(output+'.parts',{recursive:true});
  }
  await writeFile('/evidence/summary.json',JSON.stringify({scope:'packing only, retained conversion, warmup excluded',runs},null,2));
}
