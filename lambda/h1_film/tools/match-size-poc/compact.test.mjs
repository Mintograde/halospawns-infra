import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zstdCompressSync,zstdDecompressSync} from 'node:zlib';
import {writeMatchReplay} from '../../runtime/pack-match-replay.mjs';
import {openMatchReplay} from '../../runtime/match-replay.mjs';
import {compactMatch,openCompactMatch,sha} from './compact.mjs';
import {encodeColumns,decodeColumns} from './columns.mjs';
import {encodePoseColumns,decodePoseColumns} from './pose-columns.mjs';
import {encodePosePool,decodePosePool} from './pose-pool.mjs';

async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'h1-compact-'));
  try {
    const world=Buffer.alloc(40);world.write('HSRDC002');world.writeUInt32LE(1,16);
    const verification={played_ticks:2,seed_mismatches:0,hash_mismatches:0,hash_checks:1};
    const host={id:'host',role:'host',source_film_sha256:'1'.repeat(64),frame_count:2,first_update:0,viewer_revision:5,world:'host/world',verification};
    const client={...host,id:'client-0',role:'client',world:'client-0/world',recorded_own_player:0,ends_early:false,
      recorded_trust:{inputs:1,messages:1},clocks:[{frame:0,game_tick:0}],alignment:{method:'unavailable',reason:'client_account_not_recorded'}};
    const entries=[];const add=(id,kind,bytes)=>{entries.push({id,kind,bytes,compression:'identity'});return id;};
    add(host.world,'world',world);add(client.world,'world',world);
    host.recorded_sections={input_script:add('host/recorded/input_script','recorded-section',Buffer.alloc(600000,65))};
    const records=Buffer.alloc(20);for(let i=0;i<2;i++){records.writeUInt32LE(i,i*10);records.writeUInt16LE(67,i*10+4);records.writeUInt16LE(2,i*10+6);records[i*10+8]=1;records[i*10+9]=9+i;}
    const network=Buffer.alloc(56+records.length);network.writeUInt32LE(1,24);network.writeUInt32LE(records.length,32);network.writeUInt32LE(records.length,36);network.writeUInt32LE(1,44);network.writeUInt32LE(2,48);records.copy(network,56);
    client.recorded_sections={network:add('client-0/recorded/network','network-observations',network)};
    client.network={format:'h1arena.fnet-records.v2',entry:add('client-0/network/records','network-observations',records),blocks:[{offset:0,size_bytes:records.length,first_tick:0,last_tick:1,count:2,sha256:sha(records)}]};
    const pad=Buffer.alloc(64+28);const fields=[0x31444150,1,64,1,14,2,0,0,0,16,64,64,0,1,0,0];fields.forEach((v,i)=>pad.writeUInt32LE(v,i*4));pad[64]=42;
    client.pad={seats:1,stride:14,count:2,event_count:0,event_size:16,original:add('client-0/recorded/pad','raw-pad',pad),samples:add('client-0/pad/samples','raw-pad',pad.subarray(64))};
    const identity={sourceContract:{schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:6,projection_sha256:'17891e012b67f5b7e998cf1cc724a1728d18b3df5556559e90fc4ee47c0dc2c2',tick_count:2},
      source_film_sha256:'1'.repeat(64),raw_map_sha256:'2'.repeat(64),engine_profile:'h1-performance-beta6-p9839-wasm-v1',wasm_sha256:'3'.repeat(64),glue_sha256:'4'.repeat(64),match_id:'1234567890123456'};
    const path=join(dir,'source.hsrv');await writeMatchReplay(path,identity,[host,client],entries);return await readFile(path);
  } finally {await rm(dir,{recursive:true,force:true});}
}
const read=b=>async(at,n)=>b.subarray(at,at+n);
function mutateIndex(bytes,change) {
  const old=bytes.readUInt32LE(8),index=JSON.parse(zstdDecompressSync(bytes.subarray(64,64+old)));change(index);
  const raw=Buffer.from(JSON.stringify(index)),packed=zstdCompressSync(raw),head=Buffer.from(bytes.subarray(0,64));
  head.writeUInt32LE(packed.length,8);head.writeUInt32LE(raw.length,12);head.writeUInt32LE(bytes.length-old+packed.length,16);Buffer.from(sha(packed),'hex').copy(head,32);
  return Buffer.concat([head,packed,bytes.subarray(64+old)]);
}

test('compact source is byte-identical through the unchanged match reader and bounded cold ranges',async()=>{
  const source=await fixture(),packed=await compactMatch(source),reader=await openCompactMatch(read(packed),{cacheBytes:1024});
  assert.ok(packed.length<source.length/10);
  assert.ok((await reader.readSourceRange(0,source.length)).equals(source));
  const legacy=await openMatchReplay(reader.readSourceRange,{size_bytes:source.length});
  for(const e of [...legacy.manifest.entries].reverse()) {
    reader.clearCache();assert.ok((await legacy.readEntry(e.id)).equals(await reader.readEntry(e.id)));
    assert.ok(reader.cached_bytes<=1024);
  }
  for(const [at,n] of [[0,1],[60,100],[reader.prefix.length-2,12],[reader.prefix.length+39,3],[source.length-1,1]])
    assert.ok((await reader.readSourceRange(at,n)).equals(source.subarray(at,at+n)));
  await assert.rejects(reader.readSourceRange(-1,2));await assert.rejects(reader.readSourceRange(source.length,1));
});

test('corrupt source, compressed data, indexes and cyclic dependencies are rejected',async()=>{
  const source=await fixture(),packed=await compactMatch(source);
  const bad=Buffer.from(source);bad[bad.length-1]^=1;await assert.rejects(compactMatch(bad),/hash/);
  const corrupt=Buffer.from(packed);corrupt[64]^=1;await assert.rejects(openCompactMatch(read(corrupt)));
  for(const change of [
    i=>i.layouts[0].blocks[0].offset++,
    i=>i.layouts[0].blocks[0].raw++,
    i=>i.layouts.push(i.layouts[0]),
    i=>{i.layouts.find(l=>l.derived)?.derived && (i.layouts.find(l=>l.derived).derived.source=i.layouts.find(l=>l.derived).id);},
    i=>{i.layouts.find(l=>l.derived?.method==='network').derived.blocks[0].source_offset=1e12;},
    i=>{i.prefix=Buffer.alloc(80).toString('base64');},
  ])await assert.rejects(openCompactMatch(read(mutateIndex(packed,change))));
  const reader=await openCompactMatch(read(packed)),index=reader.index;
  const target=index.layouts.find(l=>l.id==='host/recorded/input_script').blocks[0];
  const payload=Buffer.from(packed);payload[64+packed.readUInt32LE(8)+target.offset]^=1;
  await assert.rejects((await openCompactMatch(read(payload))).readEntry('host/recorded/input_script'));
});

test('column experiment preserves numeric bits, missing values, mixed types and changing objects',()=>{
  const rows=[{a:-0,b:4294967295,c:[1,2],d:{x:1},mix:{z:-0}},
    {a:0,b:-1,c:[],d:null,mix:'a'}, {a:Math.fround(1.25),b:2147483648,c:[3],mix:-0},
    {a:Number.MIN_VALUE,b:0,c:[null,-0],d:{y:false},mix:null}];
  rows.push(JSON.parse('{"__proto__":{"value":4},"a":-1.7976931348623157e308}'));
  assert.deepEqual(decodeColumns(encodeColumns(rows)),rows);
  for(const values of [[-0,0,-0],[0,1,4294967295],[-1,0,2147483647],[-1,4294967295],
    [0,Math.fround(1e30),-Math.fround(1e30),Math.fround(1e-30),-0],['a',undefined,null,'undefined']])
    assert.deepEqual(decodeColumns(encodeColumns(values)),values);
});

test('pose byte transform preserves constant and delta channels, including fallbacks',()=>{
  const parts=[Buffer.from([1,0,0,0,0,3,0,1,0])];
  for(let i=0;i<8;i++){
    const header=Buffer.alloc(5);header[0]=i%3;header.writeInt32LE(i-4,1);parts.push(header);
    if(i%3)parts.push(Buffer.from([2,3]));
  }
  const fallback=Buffer.alloc(2+2+13*8);fallback.writeUInt16LE(1);fallback.writeUInt16LE(2,2);fallback.writeDoubleLE(-0,4);parts.push(fallback);
  const raw=Buffer.concat(parts);assert.ok(decodePoseColumns(encodePoseColumns(raw)).equals(raw));
  const pool=encodePosePool([raw,raw,raw]);assert.ok(pool.hits>0);
  const decoded=decodePosePool(pool.bytes);assert.equal(decoded.length,3);decoded.forEach(b=>assert.ok(b.equals(raw)));
});
