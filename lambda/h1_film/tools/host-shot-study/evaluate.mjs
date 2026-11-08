import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {recordedGameplaySources,bindGameplayShots} from '../../runtime/gameplay-source.mjs';
import {deriveGameplayMetrics} from '../../runtime/gameplay-metrics.mjs';
import {auditMetrics,reducerSha} from './reducer-audit.mjs';
import {associateHostShots,configs} from './associate.mjs';

const {values} = parseArgs({options:{results:{type:'string'},out:{type:'string'}}});
assert(values.results && values.out,'Pass --results <run results.json> --out <report.json>');
assert(!fs.existsSync(values.out),'Use a new report filename');
const root = path.dirname(path.resolve(values.results)), runs = JSON.parse(fs.readFileSync(values.results));
const hash = b => createHash('sha256').update(b).digest('hex');
const rows = file => fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const report = {reducer_sha256:reducerSha,configs,
  excluded:runs.filter(r => r.status !== 'verified').map(r => ({film:r.film,status:r.status,reasons:r.reasons})),cases:[]};
// A locally saved early recording can overlap a longer recording of the same
// match. Keep the longest verified one so the same kills are not counted twice.
const selected = new Map();
for (const c of runs.filter(r => r.status === 'verified').sort((a,b) => b.frames - a.frames
  || b.accounts.length - a.accounts.length || a.host_sha256.localeCompare(b.host_sha256))) {
  const identity = c.match_id && c.match_id !== '0000000000000000'
    ? c.family + '/' + c.match_id : c.host_sha256;
  if (selected.has(identity)) report.excluded.push({film:c.film,status:'overlapping_recording',
    reasons:['same_match_as_longer_or_equally_complete_verified_recording'],retained:selected.get(identity).film});
  else selected.set(identity,c);
}
for (const c of selected.values()) {
  assert(['exploration','validation'].includes(c.split),'Declare the exploration split before evaluating');
  const dir = path.join(root,'cases',c.host_sha256.slice(0,20));
  const encoding = JSON.parse(fs.readFileSync(path.join(dir,'encoding.json')));
  const raw = fs.readFileSync(c.film); assert.equal(hash(raw),c.source_sha256);
  const sources = recordedGameplaySources(raw);
  const events = rows(path.join(dir,'gameplay.ndjson'))
    .flatMap(f => f.events.map(e => ({...e,weapon:e.weapon || null,source_tick:f.source_tick})));
  const geometryFile = path.join(dir,'geometry.ndjson');
  // The probe opens lazily; an empty match produces no observation file.
  assert(fs.existsSync(geometryFile) || events.length === 0,'Missing probe evidence');
  const geometry = fs.existsSync(geometryFile) ? rows(geometryFile) : [];
  const common = {slots:encoding.players,deaths:encoding.native_analytics.combat.deaths,
    partialRecording:encoding.source_first_clock !== 0 || encoding.analytics.match_end_source_tick === null};
  const bound = bindGameplayShots(events,sources);
  const oracle = auditMetrics({...common,events:bound});
  assert.deepEqual(oracle.product,deriveGameplayMetrics({...common,events:bound}),
    'Trace instrumentation changed the production answer');
  const truth = new Map(oracle.decisions.map(d => [d.event_index,d])), results = [];
  for (const config of configs) {
    const inferred = associateHostShots(events,geometry,config);
    const predicted = auditMetrics({...common,events:inferred.events});
    assert.equal(predicted.decisions.length,oracle.decisions.length);
    const counters = {tp:0,fp:0,fn:0,tn:0,abstained_positive:0,abstained_negative:0,
      oracle_unknown:0,new_estimated_positive:0,new_estimated_negative:0,still_unknown:0,
      three_hit_with_miss:0,three_hit_with_miss_false_positive:0};
    const disagreements = [];
    for (const p of predicted.decisions) {
      const t = truth.get(p.event_index); assert(t && t.slot === p.slot);
      if (t.outcome === 'unknown') {
        counters.oracle_unknown++;
        counters[p.outcome === 'unknown' ? 'still_unknown' : 'new_estimated_' + p.outcome]++;
      } else {
        const key = p.outcome === 'unknown' ? 'abstained_' + t.outcome
          : p.outcome === 'positive' ? (t.outcome === 'positive' ? 'tp' : 'fp')
            : (t.outcome === 'positive' ? 'fn' : 'tn');
        counters[key]++;
        if (key === 'fp' || key === 'fn') disagreements.push({event_index:p.event_index,slot:p.slot,tick:p.tick,
          predicted:p.outcome,truth:t.outcome,truth_detail:t,predicted_detail:p});
        if (t.outcome === 'negative' && t.sequence_gap && !t.other_disqualifier && !t.incomplete && t.hit_count === 3) {
          counters.three_hit_with_miss++;
          if (p.outcome === 'positive') counters.three_hit_with_miss_false_positive++;
        }
      }
    }
    results.push({config:config.name,counters,disagreements,product:predicted.product});
  }
  report.cases.push({film:c.film,source_sha256:c.source_sha256,host_sha256:c.host_sha256,match_id:c.match_id,
    family:c.family,split:c.split,frames:c.frames,engine_sha256:c.engine_sha256,map_sha256:c.map_sha256,
    truth:oracle.product,truth_decisions:oracle.decisions,results});
}
report.summary = configs.map(config => ({config:config.name,
  ...Object.fromEntries(['exploration','validation','all'].map(split => {
    const cases = report.cases.filter(c => split === 'all' || c.split === split), counters = {};
    for (const c of cases) for (const [k,v] of Object.entries(c.results.find(r => r.config === config.name).counters))
      counters[k] = (counters[k] ?? 0) + v;
    return [split,{cases:cases.length,...counters}];
  }))}));
fs.writeFileSync(values.out,JSON.stringify(report,null,2) + '\n');
console.log(JSON.stringify(report.summary));
