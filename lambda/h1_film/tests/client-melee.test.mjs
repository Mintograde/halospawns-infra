import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindMeleeReports} from '../runtime/gameplay-source.mjs';
import {deriveMeleeMetrics} from '../runtime/melee-metrics.mjs';

const real=JSON.parse(readFileSync(new URL('./fixtures/double-melee-chillout-client.json',import.meta.url)));
function fixture() {
  const f=structuredClone(real),account=f.account;
  account.tables=account.tables.map(t=>({...t,bytes:Buffer.from(t.bytes,'base64')}));
  f.source={ledger:null,accounts:[account]};return f;
}
const table=(f,name)=>f.source.accounts[0].tables.find(t=>t.name===name);
const row=(f,name,i)=>table(f,name).bytes.subarray(i*88,(i+1)*88);
const result=(f,allowClientCopies=true)=>deriveMeleeMetrics({
  events:bindMeleeReports(f.events,f.source,{allowClientCopies}),slots:f.slots,deaths:f.deaths,
  doubleMeleeDefinition:2,resolveNonMeleeFinishers:true,resolveBackwhackFinishers:true,
}).at(-1).players[0];

test('real mirrored-host minto/JukkisP exchange uses the preserved account without client worlds',()=>{
  const f=fixture(),p=result(f);
  assert.equal(result(f,false).observed_count,0,'retained recipes remain unchanged');
  assert.equal(p.observed_count,1);assert.equal(p.unknown_kills,0);
  const ex=p.examples[0],timing=ex.remote_melee_timing;
  assert.equal(ex.end_source_tick,24553);assert.equal(ex.victim_slot,3);
  assert.equal(timing.method,'client_accepted_reports_v1');
  assert.equal(timing.client_account_sha256,f.account.hash);
  assert.equal(timing.first_shot_index,154);assert.equal(timing.second_shot_index,155);
  assert.equal(timing.first_verdict_index,154);assert.equal(timing.second_verdict_index,155);
  assert.equal(timing.second_report_client_tick-timing.first_report_client_tick,36);
  assert.equal(timing.minimum_recovery_ticks,56);
});

for(const [name,change] of [
  ['missing account',f=>f.source.accounts=[]],
  ['missing original reports',f=>f.account.tables=f.account.tables.filter(t=>t.name!=='shots')],
  ['missing copied verdicts',f=>f.account.tables=f.account.tables.filter(t=>t.name!=='host_verdicts')],
  ['capped reports',f=>table(f,'shots').capped=true],
  ['capped copied verdicts',f=>table(f,'host_verdicts').capped=true],
  ['capped original ledger',f=>f.source.ledger={tables:[{...table(f,'host_verdicts'),name:'verdicts',capped:true}]}],
  ['unknown account player',f=>f.account.own_player=-1],
  ['wrong account player',f=>f.account.own_player=1],
  ['wrong machine slot',f=>f.account.own_machine_slot=1],
  ['refused second report',f=>row(f,'host_verdicts',155)[4]=1],
  ['wrong accepted owner',f=>row(f,'host_verdicts',155)[6]=1],
  ['wrong accepted target',f=>row(f,'host_verdicts',155).writeInt32LE(123,8)],
  ['wrong original target',f=>row(f,'shots',155).writeInt32LE(123,12)],
  ['wrong original owner',f=>row(f,'shots',155)[10]=1],
  ['wrong damage tag',f=>row(f,'shots',155).writeUInt32LE(123,16)],
  ['unreliable original report',f=>row(f,'shots',155)[11]=0],
  ['unknown verdict flags',f=>row(f,'host_verdicts',155)[7]=3],
  ['unknown client clock',f=>row(f,'shots',155).writeInt32LE(-1,0)],
  ['impact after its own report',f=>row(f,'shots',155).writeInt32LE(24554,0)],
  ['different reliable epoch',f=>{row(f,'shots',155).writeUInt16LE(2,80);row(f,'host_verdicts',155).writeUInt16LE(2,30);}],
  ['same sequence',f=>{row(f,'shots',155).writeUInt16LE(154,78);row(f,'host_verdicts',155).writeUInt16LE(154,28);}],
  ['compressed host arrival clocks',f=>{row(f,'shots',155).writeInt32LE(24617,4);row(f,'host_verdicts',155).writeInt32LE(24617,16);}],
  ['hit exactly at conservative expiry',f=>{row(f,'shots',155).writeInt32LE(24573,4);row(f,'host_verdicts',155).writeInt32LE(24573,16);}],
  ['absent cancellation',f=>f.events=f.events.filter(e=>e.kind!==5)],
  ['extra same-target DEAL, including zero damage',f=>{const at=f.events.findIndex(e=>e.kind===3&&e.clock===24517);f.events.splice(at,0,{...f.events[at],deal:9999});}],
  ['duplicate account identity',f=>f.source.accounts.push({...f.account,hash:'a'.repeat(64)})],
  ['duplicate raw verdict',f=>row(f,'host_verdicts',154).copy(row(f,'host_verdicts',153))],
  ['duplicate raw report',f=>row(f,'shots',154).copy(row(f,'shots',153))],
  ['conflicting verdict copy',f=>{const bytes=Buffer.from(row(f,'host_verdicts',154));bytes.writeUInt32LE(24518,0);
    f.source.accounts.push({tables:[{name:'host_verdicts',stride:88,count:1,capped:false,bytes}]});}],
]) test(`copied-report proof rejects ${name}`,()=>{
  const f=fixture();change(f);assert.equal(result(f).observed_count,0);
});

test('identical cross-account verdict copies do not duplicate the kill or change provenance',()=>{
  const f=fixture(),before=result(f);
  f.source.accounts.push({tables:[{name:'host_verdicts',stride:88,count:1,capped:false,bytes:Buffer.from(row(f,'host_verdicts',154))}]});
  assert.deepEqual(result(f),before);
});

test('an unrelated simultaneous report does not make the exact owner/target join ambiguous',()=>{
  const f=fixture(),at=f.events.findIndex(e=>e.kind===3&&e.clock===24517);
  f.events.splice(at,0,{...f.events[at],physical:2,unit:999,deal:9999});
  assert.equal(result(f).observed_count,1);
});
