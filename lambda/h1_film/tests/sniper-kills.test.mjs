import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classifySniperKills,impactScopes,normalizedImpact,remoteScopes,verifiedPrefix} from '../runtime/sniper-kills.mjs';

const weapon = {weapon_id:4, category:'weapon', tag_path:'weapons\\sniper rifle\\sniper rifle'};
const death = {event_index:9, source_tick:55, killer_slot:2, victim_slot:1, kind:'kill', weapon_id:4};
const evidence = {scope:1, deal:0, tag:93, owner:2, unit:108, killer:2, victim:1};
const classify = (deaths, observations, scopes = new Map()) => classifySniperKills(
  {weapons:[weapon, {...weapon, weapon_id:5, category:'melee'}], deaths},
  new Map(observations), scopes).kills;

test('classifies the discharge of each credited rifle kill in combat order', () => {
  const deaths = [death, {...death, event_index:10, weapon_id:5},
    {...death, event_index:11, kind:'betrayal'}, {...death, event_index:12}];
  assert.deepEqual(classify(deaths, [['55/0', evidence], ['55/3', {...evidence, scope:2}]]),
    [{event_index:9, zoom:'unzoomed', method:'projectile'}, {event_index:12, zoom:'zoomed', method:'projectile'}]);
  assert.throws(() => classify([death], [['55/0', {...evidence, victim:3}]]));
});

test('a client-decided kill requires the matching client discharge, weapon and full target handle', () => {
  const obs = [['55/0', {...evidence, deal:12}]];
  const remote = {scope:1, tag:93, owner:2, unit:108};
  assert.equal(classify([death], obs, new Map([[12, remote]]))[0].method, 'client_pull');
  for (const other of [null, {...remote, scope:null}, {...remote, tag:92}, {...remote, owner:0}, {...remote, unit:107}])
    assert.deepEqual(classify([death], obs, new Map([[12, other]]))[0],
      {event_index:9, zoom:'unknown', method:'unavailable'});
});

test('binds local-seat-zero original pulls to the physical player in a verified replay world', () => {
  const table = (name, bytes) => ({name, count:1, stride:bytes.length, bytes});
  const pull = Buffer.alloc(48), shot = Buffer.alloc(88), verdict = Buffer.alloc(88);
  pull.writeInt32LE(20); pull.writeUInt32LE(93,8); pull[42]=2;
  shot.writeInt32LE(21); shot.writeInt32LE(23,4); shot[10]=2; shot[11]=8; shot.writeInt32LE(108,12);
  verdict.writeUInt32LE(24); verdict[5]=3; verdict[6]=2;
  verdict.writeInt32LE(108,8); verdict.writeInt32LE(23,16);
  const account = {hash:'client', own_player:2, own_machine_slot:3, tables:[table('pulls',pull), table('shots',shot)]};
  const ledger = {tables:[table('verdicts',verdict)]};
  const host = {deals:[{kind:3, clock:24, deal:12, physical:2, unit:108}]};
  const fires = new Map([['client', new Map([['20/2/93',1]])]]);
  assert.deepEqual(remoteScopes(host,{ledger,accounts:[account]},fires).get(12),
    {scope:1,tag:93,owner:2,unit:108,account:'client',clock:20});
  assert.equal(remoteScopes(host,{ledger,accounts:[account]},new Map()).size, 0);
  ledger.tables[0].capped=true;
  assert.equal(remoteScopes(host,{ledger,accounts:[account]},fires).size, 0);
});

test('binds the original struck object to the depleted parent only on a proven lethal call',()=>{
  const impact=[45,65538,355,117,0,0,0,0,0,0,1065353216,0,0];
  const host={...evidence,deal:15,impact},original={tag:93,unit:117,owner:2,scope:2};
  const combat={weapons:[weapon],deaths:[death,{...death,event_index:10,weapon_id:null}]};
  const obs=new Map([['55/0',host]]), remote=new Map([[15,original]]);
  const ex={excluded:new Map([['55/1',{killer:2,victim:1}]]),points:new Map()};
  const run=()=>classifySniperKills(combat,obs,remote,ex);
  assert.deepEqual(run().kills,[{event_index:9,zoom:'zoomed',method:'client_pull'}]);
  assert.deepEqual(run().excluded,[10]);
  assert.equal(classifySniperKills(combat,obs,remote).kills[0].zoom,'unknown');
  ex.points.set(15,1);assert.equal(run().kills[0].zoom,'unknown');
  remote.clear();assert.equal(run().kills[0].method,'client_impact');
  ex.excluded.get('55/1').killer=4;assert.deepEqual(run().excluded,[]);
});

test('point contacts require the original client clock, full ray, owner, weapon and accepted report',()=>{
  const impact=[45,65538,355,117,0,0,0,0,0,0,1065353216,0,0];
  assert.deepEqual(normalizedImpact([...impact.slice(0,10),1073741824,0,0]),impact);
  const v=Buffer.alloc(88);v.writeUInt32LE(72);v[5]=3;v[6]=2;v.writeInt32LE(117,8);v.writeInt32LE(60,16);
  const ledger={tables:[{name:'verdicts',stride:88,count:1,bytes:v}]};
  const host={deaths:new Map([['0/0',{...evidence,deal:15,impact}]]),deals:[{kind:3,deal:15,clock:72,physical:2,unit:117}]};
  const contacts=new Map(),worlds=new Map([[2,{contacts}]]);
  const read=()=>impactScopes(host,{ledger,accounts:[]},worlds).get(15);
  for (const key of [[60,93,...impact],[59,94,...impact],[59,93,...impact.slice(0,-1),1]]) {
    contacts.set(key.join('/'),1);assert.equal(read(),undefined);
  }
  const key=[59,93,...impact].join('/');contacts.set(key,2);assert.equal(read(),2);
  contacts.set(key,null);assert.equal(read(),undefined);
  contacts.set(key,2);ledger.tables[0].capped=true;assert.equal(read(),undefined);
});

test('a unique lethal rifle tag recovers the weapon independently of discharge evidence',()=>{
  const d={...death,weapon_id:null}, combat={deaths:[d],weapons:[weapon]};
  const shot={...evidence,recovered:true,deal:12};
  const ex={excluded:new Map(),points:new Map(),damageGraph:true};
  const run=()=>classifySniperKills(combat,new Map([['55/0',shot]]),new Map(),ex);
  assert.deepEqual(run(),{schema:'halospawns.h1SniperKills.v3',excluded:[],recovered_weapons:[9],
    kills:[{event_index:9,zoom:'unknown',method:'unavailable'}]});
  ex.excluded.set('55/0',{killer:2,victim:1});assert.throws(run);
  ex.excluded.clear();shot.victim=4;assert.throws(run);
  shot.victim=1;d.kind='betrayal';assert.deepEqual(run().kills,[]);
});

test('only original checked updates preceding the first divergence can qualify a client discharge',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'h1-sniper-prefix-'));
  try {
    const path=join(dir,'source'), bytes=Buffer.alloc(64+8+3*16);
    bytes.writeUInt32LE(64,48);bytes.write('TRL1',64);bytes.writeUInt32LE(3,68);
    [101,141,220].forEach((u,i)=>bytes.writeUInt32LE(u,72+16*i));await writeFile(path,bytes);
    const envelope={ticks:125,first_update:101,hash_samples:3};
    const failure={reason:'simulation_desync',network_refused:0,played_ticks:125,
      hash_checks:3,first_mismatch_update:180,hash_mismatches:1,seed_mismatches:2};
    const track={status:'unavailable',failure,envelope};
    assert.equal(await verifiedPrefix(path,track),40);
    failure.first_mismatch_update=141;assert.equal(await verifiedPrefix(path,track),0);
    Object.assign(failure,{reason:'roster_mismatch',seed_mismatches:0,hash_mismatches:0});
    assert.equal(await verifiedPrefix(path,track),Infinity);
    failure.network_refused=1;assert.equal(await verifiedPrefix(path,track),0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
