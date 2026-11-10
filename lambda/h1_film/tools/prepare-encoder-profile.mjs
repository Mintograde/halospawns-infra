// Create a separate diagnostic source tree. Never instrument the released encoder.
import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const [target]=process.argv.slice(2);assert.ok(target);
await mkdir(target);
for(const path of ['lambda/h1_film/encoder','lambda/h1_film/pose_codec',
  'lambda/h1_film/runtime','lambda/h1_film/profiles',
  'lambda/h1_film/tools/linux-candidate','lambda/h1_film/tools/source-fingerprint.mjs',
  'lambda/replay_parser/native/src/viewer.rs','lambda/replay_parser/contracts/replays']) {
  const output=join(target,path);await mkdir(dirname(output),{recursive:true});
  await cp(join(root,path),output,{recursive:true,filter:path=>!/[\\/]target([\\/]|$)/.test(path)});
}
const path=join(target,'lambda/h1_film/encoder/src/main.rs');
let code=await readFile(path,'utf8');
function replace(before,after) {assert.equal(code.split(before).length,2,before);code=code.replace(before,after);}
replace('    while let Some(mut tick) = if incremental {',
  '    let mut profile_times = [std::time::Duration::ZERO; 8];\n    let mut profile_mark = Instant::now();\n    while let Some(mut tick) = if incremental {');
replace('        if count >= request.ticks {','        profile_times[0] += profile_mark.elapsed();\n        profile_mark = Instant::now();\n        if count >= request.ticks {');
replace('        observations.observe_state(', '        profile_times[1] += profile_mark.elapsed();\n        profile_mark = Instant::now();\n        observations.observe_state(');
replace('        sampling::normalize(&mut tick, count, 1, &request.map)?;',
  '        profile_times[2] += profile_mark.elapsed();\n        profile_mark = Instant::now();\n        sampling::normalize(&mut tick, count, 1, &request.map)?;');
replace('        let sample = if low.is_some()',
  '        profile_times[3] += profile_mark.elapsed();\n        profile_mark = Instant::now();\n        let sample = if low.is_some()');
replace('        spare = tick;',
  '        profile_times[4] += profile_mark.elapsed();\n        profile_mark = Instant::now();\n        spare = tick;');
replace('        count += 1;\n    }',
  '        count += 1;\n        profile_times[5] += profile_mark.elapsed();\n        profile_mark = Instant::now();\n    }\n    eprintln!("H1_PROFILE_STAGES {:?}", profile_times);');
await writeFile(path,code);
const artifactPath=join(target,'lambda/h1_film/encoder/src/artifact.rs');
let artifact=await readFile(artifactPath,'utf8');
const poseReset='                self.pose_duration = Duration::ZERO;';
assert.equal(artifact.split(poseReset).length,2);
artifact=artifact.replace(poseReset,
  '                eprintln!("H1_PROFILE_CHUNK {} pose_ns={} delta_ns={} validation_ns={}", self.collector.tick_count, self.pose_duration.as_nanos(), chunk.encode_duration.as_nanos(), chunk.validation_duration.as_nanos());\n'+poseReset);
await writeFile(artifactPath,artifact);
console.log(target);
