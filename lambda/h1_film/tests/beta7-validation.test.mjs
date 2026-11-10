import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readEnvelope,verifyPlayback} from '../runtime/adapters/beta7-v3-120.mjs';
import {fnv1a} from '../runtime/format3-codec.mjs';

// Minimal envelope fixtures exercise the real section/roster/network reader.
// The opaque tick payload is only for inspection, not simulation.
function fixture({network=true,client=false,bots=0,players=3,records=[],settings,startBots}={}) {
  const head=Buffer.alloc(504),parts=[head];let length=head.length;
  const u=(at,value)=>head.writeUInt32LE(value,at);
  for(const [at,value] of [[0,0x314d4c46],[4,3],[8,9844],[12,120],[20,32],[24,4],
    [28,network?10+(client?64:0):0],[44,2],[52,120],[56,1],[60,1],[64,504],
    [100,network?1:players],[124,network?players:0],[488,1]])u(at,value);
  head.write('dread',128);head.write('FFA 50',256);head.write('Linux server',384);
  const append=(bytes,offset,size)=>{u(offset,length);if(size!==undefined)u(size,bytes.length);parts.push(bytes);length+=bytes.length;};
  const options=Buffer.alloc(bots?13360:13356);
  if(bots)options.writeUInt32LE(bots,13356);
  append(options,72,16);
  append(Buffer.from(settings??`[tuning]\nbots=${bots}\nbot_skill=2\nbot_teams=auto\n`),76,80);
  if(network) {
    const roster=Buffer.alloc(464);roster.writeUInt32LE(0x52545352);roster.writeUInt32LE(players,4);
    for(let i=0;i<players;i++){roster[16+i*28]=i;roster[17+i*28]=255;}
    append(roster,456,460);
  }
  const tick=Buffer.alloc(33);
  [0x4b435446,1,1,0,0,0,2,fnv1a(Buffer.from([0]))].forEach((v,i)=>tick.writeUInt32LE(v,i*4));
  append(tick,68);
  const trailer=Buffer.alloc(24);trailer.writeUInt32LE(0x314c5254);trailer.writeUInt32LE(1,4);
  append(trailer,48);
  if(startBots!==undefined) {
    const items=Buffer.alloc(56);
    [0x31494854,16,1,56,1,1,32,24,0,0,startBots,0].forEach((v,i)=>items.writeUInt32LE(v,i*4));
    parts.push(items);length+=items.length;
  }
  if(network) {
    if(!records.length)records=[[0,client?64:3,4]];
    const rows=records.map(([at,type,size,value])=>{const b=Buffer.alloc(8+size);b.writeUInt32LE(at);b.writeUInt16LE(type,4);b.writeUInt16LE(size,6);if(value!==undefined)b.writeUInt32LE(value,8);return b;});
    const raw=Buffer.concat(rows),net=Buffer.alloc(56);
    [0x54454e46,2,32,rows.length,raw.length,0,1,24+raw.length,
      raw.length,raw.length,records[0][0],records.at(-1)[0],rows.length,0].forEach((v,i)=>net.writeUInt32LE(v,i*4));
    append(Buffer.concat([net,raw]),448,452);
  }
  return Buffer.concat(parts);
}

async function inspect(bytes,check) {
  const dir=await mkdtemp(join(tmpdir(),'h1-beta7-validation-'));
  try {const path=join(dir,'film.h1film');await writeFile(path,bytes);return await check(path);}
  finally {await rm(dir,{recursive:true,force:true});}
}
const read=bytes=>inspect(bytes,path=>readEnvelope(path,{allowClientView:true}));

test('Beta 7 host classification reads bounded START items and preserves older recipes',async()=>{
  const readHost=bytes=>inspect(bytes,path=>readEnvelope(path,{botAwareHost:true}));
  const bytes=fixture({players:5,startBots:3,records:[[0,3,4,16]]});
  assert.equal((await read(bytes)).network.host,undefined);
  const h=(await readHost(bytes)).network.host;
  assert.deepEqual(h.host_slots,[0]);assert.deepEqual(h.bot_slots,[1,2,3]);
  const neutral=(await readHost(fixture({players:6,records:[[0,3,4,49]]}))).network.host;
  assert.deepEqual(neutral.host_slots,[]);assert.deepEqual(neutral.bot_slots,[1,2,3]);
  const oneBot=fixture({players:2,records:[[0,3,4,2]]});
  assert.deepEqual((await read(oneBot)).network.host.host_slots,[0]);
  assert.equal((await readHost(oneBot)).network.host,undefined);
  const at=bytes.readUInt32LE(48)+24;
  for(const [offset,value,error] of [[12,0xffffffff,/directory/],[24,0,/bounds/],
    [32,1,/START roster/],[36,1,/START roster/],[40,6,/START roster/],
    [44,1,/START roster/],[48,1,/world hash/]]) {
    const bad=Buffer.from(bytes);bad.writeUInt32LE(value,at+offset);
    await assert.rejects(readHost(bad),error);
  }
});

test('Beta 7 records detail checks, grenade sticks and client events with exact sizes', async()=>{
  const host=await read(fixture({records:[[0,3,4],[0,16,16],[1,17,124]]}));
  assert.equal(host.network.applications,1);
  const client=await read(fixture({client:true,records:[[0,64,4],[0,16,16],[1,17,124],[2,83,16]]}));
  assert.equal(client.network.applications,3);
  for(const [type,size] of [[16,15],[17,123],[83,15],[84,16]]) {
    await assert.rejects(read(fixture({client:true,records:[[0,64,4],[1,type,size]]})),/record/);
  }
  const old=fixture();old.writeUInt32LE(9839,8);
  await assert.rejects(read(old),/layout/);
});

test('Beta 7 network lobby bot settings do not add participants; local bots still do',async()=>{
  for(const client of [false,true]) {
    const envelope=await read(fixture({client,bots:4,players:16}));
    assert.equal(envelope.players,16);
    assert.equal(envelope.bots,undefined);
  }
  const local=await read(fixture({network:false,bots:4,players:1}));
  assert.equal(local.players,5);assert.equal(local.bots,4);
  await assert.rejects(read(fixture({network:false,bots:9,players:4})),/bot roster/);
});

test('Beta 7 uses the complete recorded roster beyond the legacy eight-player envelope',async()=>{
  for(const client of [false,true]) {
    const bytes=fixture({client,players:16});bytes.writeUInt32LE(8,124);
    assert.equal((await read(bytes)).players,16);
    bytes.writeUInt32LE(7,124);
    await assert.rejects(read(bytes),/roster count differs/);
    bytes.writeUInt32LE(8,124);
    bytes.writeUInt32LE(17,bytes.readUInt32LE(456)+4);
    await assert.rejects(read(bytes),/roster count/);
  }
});

test('Beta 7 network bot options retain count, skill, team and duplicate validation',async()=>{
  await assert.rejects(read(fixture({client:true,bots:12})),/bot roster/);
  const cases=[
    ['[tuning]\nbots=3\nbot_skill=2\nbot_teams=auto\n',/bot count differs/],
    ['[tuning]\nbots=4\nbot_skill=4\nbot_teams=auto\n',/bot skill/],
    ['[tuning]\nbots=4\nbot_skill=2\nbot_teams=2\n',/bot teams/],
    ['[tuning]\nbots=4\nbots=4\nbot_skill=2\nbot_teams=auto\n',/Duplicate/],
  ];
  for(const [settings,error] of cases)await assert.rejects(read(fixture({client:true,bots:4,settings})),error);
});

test('Beta 7 counts closing client changes, excludes rules, and preserves the host boundary',async()=>{
  const client=await read(fixture({client:true,records:[[0,64,4],[0,81,0],[1,1,68],[2,66,4],[2,66,4]]}));
  assert.equal(client.network.applications,4);
  const host=await read(fixture({records:[[0,3,4],[1,1,68],[2,1,68]]}));
  assert.equal(host.network.applications,1);
  await assert.rejects(read(fixture({client:true,records:[[0,64,4],[3,66,4]]})),/bounds or time/);
  const log='[film] played 2 ticks of film\n[film] self-check: 0 seed mismatches, 0 of 1 hash samples differed, 2 control pushes\n[film] VERDICT: clean\nnetwork changes put back: 4, 0 refused';
  assert.equal(verifyPlayback(log,client).hash_checks,1);
  assert.throws(()=>verifyPlayback(log.replace('back: 4','back: 2'),client),/Incomplete network replay/);
  assert.throws(()=>verifyPlayback(log.replace('0 refused','1 refused'),client),/refused recorded/);
  assert.throws(()=>verifyPlayback(log.replace('0 seed','1 seed'),client),/Seed mismatch/);
  assert.throws(()=>verifyPlayback(log.replace('0 of 1','1 of 1'),client),/Hash mismatch/);
});
