import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [root,output]=process.argv.slice(2);
assert.ok(root&&output);
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const runs=[],excluded=[];
const directories=(await readdir(root,{withFileTypes:true}))
  .filter(entry=>entry.isDirectory()&&/^(lambda-|aggregate-|fanout-)/.test(entry.name)).map(entry=>entry.name).sort();
for(const name of directories) {
  const path=join(root,name);
  if(name.startsWith('fanout-')) {
    const execution=await load(join(path,'fanout-processes.json'));
    if(!execution.success) {excluded.push({name,reason:'failed experiment; not a performance result'});continue;}
  }
  const [config,stages,report,completion]=await Promise.all(['configuration.json','stages.json','report.json','finalization.json'].map(n=>load(join(path,n))));
  const get=key=>stages.spans.find(s=>s.stage===key)?.seconds;
  const finalize=stages.spans.find(s=>s.stage.startsWith('finalize_')).seconds;
  const inspect=get('inspect.log'),conversion=get('conversion');
  const run={name,config,film_sha256:report.provenance.film_sha256,
    inspect_seconds:inspect,conversion_seconds:conversion,finalize_seconds:finalize,
    measured_stage_sum_seconds:inspect+conversion+finalize,
    offline_compute_gb_seconds:config.aggregate_cpu_experiment?null:config.memory_mb/1024*(inspect+conversion+finalize),
    artifact_sha256:completion.viewer_artifact.sha256,artifact_bytes:completion.viewer_artifact.size_bytes,
    max_cgroup_bytes:Number(stages['memory/memory.max_usage_in_bytes']??stages['memory.peak'])||null,
    worlds:[]};
  if(config.fanout) {
    const childDirectory=join(path,'fanout');
    const responses=await Promise.all((await readdir(childDirectory)).filter(n=>n.endsWith('.response.json')).map(n=>load(join(childDirectory,n))));
    run.child_compute_seconds=responses.reduce((sum,r)=>sum+r.metrics.seconds,0);
    run.child_peak_bytes=responses.map(r=>Number(r.metrics['memory/memory.max_usage_in_bytes']));
    run.offline_compute_gb_seconds=config.memory_mb/1024*(run.measured_stage_sum_seconds+run.child_compute_seconds);
  }
  const worlds=join(path,'worlds');
  run.match_tracks=await load(join(worlds,'match-tracks.json'));
  for(const dir of ['',...(await readdir(worlds)).filter(n=>n.startsWith('client-'))]) {
    const world=await load(join(worlds,dir,'report.json'));
    const usage=world.engine_resources?.resourceUsage;
    run.worlds.push({id:dir||'host',status:world.status,simulation:world.simulation,timing:world.timing,
      world_sha256:world.encoding?.['120hz']?.sha256??null,world_bytes:world.encoding?.['120hz']?.sizeBytes??null,
      engine_cpu_seconds:usage?(usage.userCPUTime+usage.systemCPUTime)/1e6:null});
  }
  const baseline=runs.find(r=>r.film_sha256===run.film_sha256);
  if(baseline) {
    assert.equal(run.artifact_sha256,baseline.artifact_sha256,name+' complete match bytes');
    assert.deepEqual(run.match_tracks,baseline.match_tracks,name+' client availability and evidence');
    assert.deepEqual(run.worlds.map(({id,status,simulation,world_sha256})=>({id,status,simulation,world_sha256})),
      baseline.worlds.map(({id,status,simulation,world_sha256})=>({id,status,simulation,world_sha256})),name+' world proofs');
  }
  runs.push(run);
}
await writeFile(output,JSON.stringify({scope:'offline stage sums, not hosted latency or billing; fan-out includes child compute',excluded,runs},null,2));
console.table(runs.map(r=>({name:r.name,convert:r.conversion_seconds.toFixed(2),finalize:r.finalize_seconds.toFixed(2),
  stage_sum:r.measured_stage_sum_seconds.toFixed(2),GB_seconds:r.offline_compute_gb_seconds?.toFixed(1)??'n/a',
  peak_cgroup_MiB:r.max_cgroup_bytes?Math.round(r.max_cgroup_bytes/1024**2):null})));
