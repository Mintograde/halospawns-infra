import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {deflateRawSync,zstdDecompressSync} from 'node:zlib';
import {writeMatchReplay} from '../runtime/pack-match-replay.mjs';
import {openMatchReplay,readMatchReplayHeader,validateMatchReplay} from '../runtime/match-replay.mjs';
import {unpackMszip,inflateWithDictionary} from '../runtime/compact-records.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=b=>async(at,n)=>b.subarray(at,at+n);
const codecs={decompressZstd:(b,n)=>zstdDecompressSync(b,{maxOutputLength:n})};
function mszip(bytes) {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0xc0e5510a);
  header.writeUInt16LE(24, 4);
  header[7] = 2;
  header.writeBigUInt64LE(BigInt(bytes.length), 8);
  header.writeBigUInt64LE(BigInt(Math.min(bytes.length, 32768)), 16);
  let checksum = 0xffffffff;
  for (const byte of Buffer.concat([header.subarray(0, 6), header.subarray(7)])) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  header[6] = (checksum ^ 0xffffffff) & 255;
  const parts = [header];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    const compressed = deflateRawSync(bytes.subarray(offset, offset + 32768), {
      dictionary: bytes.subarray(Math.max(0, offset - 32768), offset),
    });
    const prefix = Buffer.alloc(6);
    prefix.writeUInt32LE(compressed.length + 2);
    prefix.write('CK', 4);
    parts.push(prefix, compressed);
  }
  return Buffer.concat(parts);
}

async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'h1-compact-'));
  try {
    const world=Buffer.alloc(40);world.write('HSRDC002');world.writeUInt32LE(1,16);
    const verification={played_ticks:2,seed_mismatches:0,hash_mismatches:0,hash_checks:1};
    const host={id:'host',role:'host',status:'available',source_film_sha256:'1'.repeat(64),frame_count:2,first_update:0,viewer_revision:5,world:'host/world',verification};
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
    const identity={sourceContract:{schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:8,projection_sha256:'5501eb4b77cfca3aa76863bf33ff9819715ca22a07da6b7e5df51006a26783ef',tick_count:2},
      source_film_sha256:'1'.repeat(64),raw_map_sha256:'2'.repeat(64),engine_profile:'h1-performance-beta6-p9839-wasm-v1',wasm_sha256:'3'.repeat(64),glue_sha256:'4'.repeat(64),match_id:'1234567890123456'};
    const path=join(dir,'source.hsrv');await writeMatchReplay(path,identity,[host,client],entries);return await readFile(path);
  } finally {await rm(dir,{recursive:true,force:true});}
}

test('compact worlds seek directly while duplicate tables reconstruct exactly',async()=>{
  const bytes=await fixture(),requests=[];
  const r=await openMatchReplay(async(at,n)=>{requests.push([at,n]);return bytes.subarray(at,at+n);},{size_bytes:bytes.length},codecs);
  assert.equal(r.header.version,3);assert.ok(bytes.length<r.manifest.logical_size_bytes/10);
  for(const e of [...r.manifest.entries].reverse()) {
    r.clearCache();const b=await r.readEntry(e.id);assert.equal(sha(b),e.sha256);
    const at=Math.floor(b.length/2),n=Math.min(100,b.length-at);
    assert.deepEqual(Buffer.from(await r.rangeReader(e.id)(at,n)),Buffer.from(b.subarray(at,at+n)));
    assert.ok(r.cachedBytes<=33554432);
  }
  requests.length=0;await r.rangeReader('client-0/world')(20,8);
  assert.equal(requests.length,1);assert.equal(requests[0][1],8);
  r.clearCache();await Promise.all(Array.from({length:8},()=>r.readEntry('host/recorded/input_script')));
  assert.equal(r.cachedBytes,600000);
  r.clearCache();assert.equal(r.cachedBytes,0);
  await assert.rejects(r.rangeReader('host/world')(40,1));
});

test('compact storage rejects cycles, foreign sources, changed payloads and incomplete coverage',async()=>{
  const bytes=await fixture(),r=await openMatchReplay(read(bytes),{},codecs);
  for(const mutate of [
    m=>m.logical_size_bytes++,
    m=>m.entries[0].storage.blocks[0].offset++,
    m=>m.entries[0].storage.blocks[0].codec='zstd',
    m=>m.entries[0].storage.blocks[0].sha256='0'.repeat(64),
    m=>m.entries.find(e=>e.storage.kind==='network').storage.source='client-0/network/records',
    m=>m.entries.find(e=>e.storage.kind==='network').storage.source='host/recorded/input_script',
    m=>m.entries.find(e=>e.storage.kind==='network').storage.blocks[0].source_offset=1e12,
    m=>m.entries.find(e=>e.storage.kind==='pad').storage.field='missing',
    m=>m.entries[0].storage.extra=true,
  ]){const bad=structuredClone(r.manifest);mutate(bad);assert.throws(()=>validateMatchReplay(bad,r.header));}
  const b=Buffer.from(bytes),entry=r.manifest.entries.find(e=>e.id==='host/recorded/input_script');
  b[r.header.body_offset+entry.storage.blocks[0].offset]^=1;
  await assert.rejects((await openMatchReplay(read(b),{},codecs)).readEntry(entry.id),/hash/);
  const short=Buffer.from(bytes.subarray(0,64));short.writeUInt32LE(bytes.length-1,20);
  assert.throws(()=>validateMatchReplay(r.manifest,readMatchReplayHeader(short)),/coverage/);
});

test('browser-native MSZIP handles 32 KiB dictionaries and rejects corruption and surplus bytes',async()=>{
  const seed=randomBytes(32768),source=Buffer.concat([seed,seed,seed.subarray(0,8123)]),packed=mszip(source);
  assert.ok(Buffer.from(await unpackMszip(packed,source.length)).equals(source));
  for(const bytes of [packed.subarray(0,packed.length-1),Buffer.concat([packed,Buffer.from([0])])])
    await assert.rejects(unpackMszip(bytes,source.length));
  const bad=Buffer.from(packed);bad[6]^=1;await assert.rejects(unpackMszip(bad,source.length),/checksum/);
  const deflated=deflateRawSync(seed,{dictionary:seed});
  await assert.rejects(inflateWithDictionary(deflated,seed,32767));
  await assert.rejects(inflateWithDictionary(Buffer.concat([deflated,Buffer.from([0])]),seed,32768));
});

test('compact reconstruction yields and honors cancellation before fetching bytes',async()=>{
  const bytes=await fixture(),controller=new AbortController();let reads=0;
  const r=await openMatchReplay(async(at,n)=>{reads++;return bytes.subarray(at,at+n);},{},{...codecs,schedule:async()=>controller.signal.throwIfAborted()});
  controller.abort();const before=reads;await assert.rejects(r.readEntry('host/recorded/input_script'),/abort/i);assert.equal(reads,before);
});
