import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../../runtime/gameplay-metrics.mjs',import.meta.url),'utf8');
export const reducerSha=createHash('sha256').update(source).digest('hex');
let text=source;
const edits=[
 ['export const GAMEPLAY_SCHEMA',"export const decisionTrace=[];\nexport const GAMEPLAY_SCHEMA"],
 ['  const players = new Map(', '  decisionTrace.length=0;\n  const players = new Map('],
 ['      player.evaluated_kills++;',`      player.evaluated_kills++;
      const decision={slot:e.slot,event_index:index,tick:e.source_tick,outcome:'negative',
        sequence_gap:!!encounter?.sequenceGap,other_disqualifier:!!encounter?.otherDisqualifier
          || (encounter?.slot>=0 && encounter.slot!==e.slot) || (!!e.weapon && !pistol(e.weapon)),
        hit_count:encounter?.hits.length??0,incomplete:!!encounter?.unknown,
        hit_ids:encounter?.hits??[]}; decisionTrace.push(decision);`],
 ['if (encounter.unknown || !e.weapon) { player.unknown_kills++; continue; }',"if (encounter.unknown || !e.weapon) { decision.outcome='unknown'; player.unknown_kills++; continue; }"],
 ['      player.observed_count++;',"      decision.outcome='positive'; player.observed_count++;"],
 ['|| (!starts && e.before.some((v,i) => v > encounter.after[i]))) encounter.valid = false;',
  '|| (!starts && e.before.some((v,i) => v > encounter.after[i]))) { encounter.valid = false; encounter.otherDisqualifier=true; }'],
 ["if (encounter.hits.at(-1) !== e.discharge) encounter.valid = false;",
  "if (encounter.hits.at(-1) !== e.discharge) { encounter.valid = false; encounter.otherDisqualifier=true; }"],
 ['|| shot.domain !== encounter.domain)) encounter.valid = false;',
  '|| shot.domain !== encounter.domain)) { encounter.valid = false; encounter.sequenceGap=true; }'],
];
for(const [from,to] of edits){assert.equal(text.split(from).length,2,from);text=text.replace(from,to);}
const module=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
export function auditMetrics(args){
 const product=module.deriveGameplayMetrics(args);
 return {product,decisions:structuredClone(module.decisionTrace)};
}
