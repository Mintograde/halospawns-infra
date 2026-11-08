import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {readFrames} from './frames.mjs';
import {inspectMatchFilm} from '../../runtime/match-film.mjs';

const {values} = parseArgs({options:{inventory:{type:'string'},engine:{type:'string'},
  out:{type:'string'},jobs:{type:'string',default:'3'}}});
assert(values.inventory && values.engine && values.out,
  'Pass --inventory <json> --engine <probe executable> --out <directory> [--jobs 3]');
const jobs = Number(values.jobs); assert(Number.isInteger(jobs) && jobs >= 1 && jobs <= 8);
const root = path.resolve(values.out), executable = path.resolve(values.engine);
const hash = b => createHash('sha256').update(b).digest('hex');
const engineSha = hash(fs.readFileSync(executable));
const cases = JSON.parse(fs.readFileSync(values.inventory)).cases, results = [];
fs.mkdirSync(path.join(root,'cases'),{recursive:true});
let next = 0;
async function run(c) {
  assert.equal(c.envelope.first_update,0,'This study supports whole recordings only');
  assert(/^[a-f0-9]{64}$/.test(c.host_sha256));
  const raw = fs.readFileSync(c.film); assert.equal(hash(raw),c.source_sha256);
  const mapSha = hash(fs.readFileSync(c.map));
  const dir = path.join(root,'cases',c.host_sha256.slice(0,20)), resultFile = path.join(dir,'result.json');
  fs.mkdirSync(dir,{recursive:true});
  if (fs.existsSync(resultFile)) {
    const old = JSON.parse(fs.readFileSync(resultFile));
    assert.equal(old.engine_sha256,engineSha,'Cached engine differs');
    assert.equal(old.source_sha256,c.source_sha256,'Cached source differs');
    assert.equal(old.map_sha256,mapSha,'Cached map differs');
    results.push({...old,split:c.split,family:c.family,match_id:c.match_id});
    console.log(JSON.stringify({cached:true,name:path.basename(c.film),status:old.status})); return;
  }
  const match = raw.readUInt32LE(4) === 3 ? inspectMatchFilm(raw) : null;
  const host = match ? raw.subarray(match.host_offset,match.host_offset + match.host_size) : raw;
  assert.equal(hash(host),c.host_sha256);
  fs.writeFileSync(path.join(dir,'input.h1film'),host);
  fs.mkdirSync(path.join(dir,'maps'),{recursive:true});
  assert(/^[a-zA-Z0-9_ .-]+$/.test(c.envelope.map) && !c.envelope.map.includes('..'));
  fs.copyFileSync(c.map,path.join(dir,'maps',c.envelope.map + '.map'));
  const log = fs.openSync(path.join(dir,'native.log'),'w'), started = Date.now();
  let code;
  try {
    code = await new Promise((resolve,reject) => {
      const child = spawn(executable,['--film','input.h1film','--deterministic','--ticks',String(c.envelope.ticks),
        '--dump','frames.bin'],{cwd:dir,windowsHide:true,timeout:900000,stdio:['ignore',log,log],env:{...process.env,
        BLAMPC_FILM_RING:'0',BLAMPC_FILM_KEYFRAME_TICKS:'432001',BLAMPC_FILM_VIEW_DELIVERED:'1',
        HS_HOST_SHOT_PROBE_FILE:path.join(dir,'geometry.ndjson')}});
      child.once('error',reject); child.once('exit',resolve);
    });
  } finally { fs.closeSync(log); }
  const text = fs.readFileSync(path.join(dir,'native.log'),'utf8');
  const checked = /self-check: (\d+) seed mismatches, (\d+) of (\d+) hash samples differed/.exec(text);
  const applied = /network changes put back: (\d+), (\d+) refused/.exec(text);
  const reasons = [];
  if (code !== 0) reasons.push('nonzero_exit');
  if (!checked || Number(checked[1]) !== 0 || Number(checked[2]) !== 0
    || Number(checked[3]) !== c.envelope.hash_samples) reasons.push('hash_verification');
  if (!applied) reasons.push('missing_network_verification');
  else if (Number(applied[2]) !== 0) reasons.push('refused_network_application');
  if (!text.includes('VERDICT: clean')) reasons.push('unclean_verdict');
  const clean = reasons.length === 0;
  const result = {...c,engine_sha256:engineSha,map_sha256:mapSha,seconds:(Date.now() - started) / 1000,
    status:clean ? 'verified' : 'rejected',reasons,exit_code:code,
    hash_verification:checked?.slice(1),applications:applied?.slice(1)};
  if (clean) {
    const players = new Set(), deaths = [], weapons = [], gameplay = [];
    let count = 0, end = null, events = 0;
    for (const frame of readFrames(path.join(dir,'frames.bin'))) {
      assert.equal(frame.current_tick,count++);
      for (const p of frame.players) players.add(p);
      if (frame.game_ended_this_tick) end = frame.current_tick;
      for (const w of frame.combat.weapons) weapons.push(w);
      for (const d of frame.combat.deaths) deaths.push({...d,source_tick:frame.current_tick,event_index:deaths.length});
      assert(frame.gameplay.events.length <= 2048);
      if (frame.gameplay.events.length) {
        events += frame.gameplay.events.length; assert(events <= 400000);
        gameplay.push(JSON.stringify({source_tick:frame.current_tick,events:frame.gameplay.events}));
      }
    }
    assert.equal(count,c.envelope.ticks);
    const encoding = {players:[...players],source_first_clock:c.envelope.first_update,
      analytics:{match_end_source_tick:end},native_analytics:{combat:{deaths,weapons}}};
    fs.writeFileSync(path.join(dir,'encoding.json'),JSON.stringify(encoding) + '\n');
    fs.writeFileSync(path.join(dir,'gameplay.ndjson'),gameplay.join('\n') + '\n');
    result.frames = count; result.deaths = deaths.length; result.gameplay_events = events; result.match_end = end;
    // Remove only our generated intermediate, retaining compact evidence and diagnostics.
    fs.unlinkSync(path.join(dir,'frames.bin'));
  }
  fs.writeFileSync(resultFile,JSON.stringify(result,null,2) + '\n'); results.push(result);
  console.log(JSON.stringify({name:path.basename(c.film),status:result.status,reasons,
    seconds:result.seconds,frames:result.frames,deaths:result.deaths,hashes:result.hash_verification}));
}
await Promise.all(Array.from({length:jobs},async () => {
  while (next < cases.length) await run(cases[next++]);
}));
results.sort((a,b) => a.host_sha256.localeCompare(b.host_sha256));
fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2) + '\n');
console.log(JSON.stringify({cases:results.length,verified:results.filter(r => r.status === 'verified').length,
  rejected:results.filter(r => r.status !== 'verified').length,seconds:results.reduce((n,r) => n + r.seconds,0)}));
