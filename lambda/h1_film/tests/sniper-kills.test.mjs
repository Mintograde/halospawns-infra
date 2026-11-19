import assert from 'node:assert/strict';
import test from 'node:test';
import {classifySniperKills, remoteScopes} from '../runtime/sniper-kills.mjs';

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
    {scope:1,tag:93,owner:2,unit:108});
  assert.equal(remoteScopes(host,{ledger,accounts:[account]},new Map()).size, 0);
  ledger.tables[0].capped=true;
  assert.equal(remoteScopes(host,{ledger,accounts:[account]},fires).size, 0);
});
