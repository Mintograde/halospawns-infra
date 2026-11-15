import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindMeleeReports} from '../runtime/gameplay-source.mjs';
import {deriveMeleeMetrics} from '../runtime/melee-metrics.mjs';

const real=JSON.parse(readFileSync(new URL('./fixtures/double-melee-fallout.json',import.meta.url)));
function fixture() {
  const f=structuredClone(real);
  f.source={ledger:{tables:[{name:'verdicts',stride:88,count:f.verdicts.length,
    capped:false,bytes:Buffer.from(f.verdict_bytes,'base64')}]},accounts:[]};
  return f;
}
function result(f,definition=2,partialRecording=false) {
  return deriveMeleeMetrics({events:bindMeleeReports(f.events,f.source),slots:[0,3],
    deaths:f.deaths,doubleMeleeDefinition:definition,partialRecording}).at(-1).players.find(p=>p.slot_index===3);
}
const hits=f=>f.events.filter(e=>e.kind===1&&e.category===2);
const rows=f=>f.source.ledger.tables[0].bytes;

test('real Seizen/dstny host-only exchange: two accepted reports 32 ticks apart, map bound 56',()=>{
  const f=fixture(),p=result(f);
  assert.equal(p.observed_count,1);
  assert.equal(result(f,1).observed_count,0);
  const ex=p.examples[0];
  assert.equal(ex.end_source_tick,7206);
  assert.equal(ex.remote_melee_timing.second_report_client_tick-ex.remote_melee_timing.first_report_client_tick,32);
  assert.equal(ex.remote_melee_timing.minimum_recovery_ticks,56);
  assert.equal(ex.remote_melee_timing.host_grenade_source_tick,7186);
  assert.equal(f.source.accounts.length,0);
});

for(const [name,change] of [
  ['host packet timing compresses ordinary client hits',f=>rows(f).writeInt32LE(7145+136,88+16)],
  ['hit at conservative expiry',f=>rows(f).writeInt32LE(7145+56,88+16)],
  ['same client tick',f=>rows(f).writeInt32LE(7145,88+16)],
  ['backward client clock',f=>rows(f).writeInt32LE(7144,88+16)],
  ['different reliable epoch',f=>rows(f).writeUInt16LE(2,88+30)],
  ['same reliable sequence',f=>rows(f).writeUInt16LE(9,88+28)],
  ['plain message lacks original retry clock',f=>rows(f)[88+7]=0],
  ['refused report',f=>rows(f)[88+4]=1],
  ['wrong accepted target',f=>rows(f).writeInt32LE(123,88+8)],
  ['wrong accepted owner',f=>rows(f)[88+6]=1],
  ['capped host ledger',f=>f.source.ledger.tables[0].capped=true],
  ['missing host ledger',f=>f.source.ledger=null],
  ['missing original cooldown bound',f=>delete hits(f)[0].melee_recovery_ticks],
  ['invalid map animation timing',f=>hits(f)[0].melee_recovery_ticks=0],
  ['different victim lifetime',f=>hits(f)[0].unit++],
  ['different attacker lifetime',f=>hits(f)[0].attacker_unit++],
  ['first hit causes no damage',f=>hits(f)[0].after=[...hits(f)[0].before]],
  ['lethal hit causes no damage',f=>hits(f)[1].after=[...hits(f)[1].before]],
  ['no observed grenade cancellation',f=>f.events=f.events.filter(e=>e.kind!==5)],
  ['host respawn between the swings',f=>f.events.find(e=>e.kind===4&&e.melee===9).unit++],
  ['non-melee finisher',f=>f.events.find(e=>e.kind===2).category=0],
  ['extra unpaired DEAL at the first impact',f=>{const i=f.events.findIndex(e=>e.kind===3);f.events.splice(i,0,{...f.events[i],deal:999});}],
])test(`remote proof rejects ${name}`,()=>{
  const f=fixture();change(f);assert.equal(result(f).observed_count,0);
});

test('one tick inside the conservative bound qualifies; duplicate damage callbacks do not multiply it',()=>{
  const f=fixture();rows(f).writeInt32LE(7145+55,88+16);
  const i=f.events.findIndex(e=>e.kind===1);f.events.splice(i+1,0,{...f.events[i]});
  assert.equal(result(f).observed_count,1);
});

test('a single damaging blow can establish a negative only with a complete victim history',()=>{
  const f=fixture(), first=hits(f)[0];
  f.events=f.events.filter(e=>e!==first);
  assert.equal(result(f).value,0);
  assert.equal(result(f,2,true).value,null);
  assert.equal(result(f,1).value,null);
});

test('an earlier unknown damage category preserves uncertainty about the first melee',()=>{
  const f=fixture();hits(f)[0].category=-1;
  const p=result(f);
  assert.equal(p.value,null);
  assert.equal(p.unknown_kills,1);
});

test('the recovery bound follows the decrement phase for every valid animation and start phase',()=>{
  for(let total=1;total<=127;total++) {
    const duration=total-(total>>2);
    for(let offset=0;offset<duration;offset++)for(let start=400;start<404;start++) {
      let timer=duration,impact,expiry;
      for(let tick=start+1;timer>0;tick++)if(tick%4===0){
        if(timer===duration-offset)impact=tick;
        if(--timer===0)expiry=tick;
      }
      assert.equal(expiry-impact,(duration-offset-1)*4);
    }
  }
});
