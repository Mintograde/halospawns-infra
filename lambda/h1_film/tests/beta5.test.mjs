import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readEnvelope} from '../runtime/film.mjs';
import {readEnvelope as beta4} from '../runtime/adapters/beta4-v2-120.mjs';
function fixture(records = [[3,4],[9,0],[8,124],[10,32],[11,56],[12,20]]) {
  const header=504,options=13152,text=Buffer.from('[tuning]\nbots = 0\n');
  const stream=header+options+text.length,trailer=stream+10,net=trailer+24;
  const raw=Buffer.concat(records.map(([type,size])=>{const b=Buffer.alloc(8+size);b.writeUInt16LE(type,4);b.writeUInt16LE(size,6);if(type===3)b.writeUInt32LE(15,8);return b}));
  const b=Buffer.alloc(net+56+raw.length);
  const words={0:0x314d4c46,1:2,2:9818,3:120,4:options,5:32,6:4,7:42,11:1,12:trailer,13:120,14:1,15:100,16:header,17:stream,18:header,19:header+options,20:text.length,25:1,31:4};
  for(const [k,v] of Object.entries(words))b.writeUInt32LE(v,Number(k)*4);
  b.write('dread',128);b.write('Linux server',384);b.writeBigUInt64LE(1793303779n,464);
  text.copy(b,header+options);b.writeUInt32LE(0x314c5254,trailer);b.writeUInt32LE(1,trailer+4);
  b.writeUInt32LE(net,448);b.writeUInt32LE(56+raw.length,452);
  [0x54454e46,2,32,records.length,raw.length,0,1,24+raw.length,raw.length,raw.length,0,0,records.length,0].forEach((v,i)=>b.writeUInt32LE(v,net+i*4));raw.copy(b,net+56);return b;
}
async function withFilm(b,fn){const dir=await mkdtemp(join(tmpdir(),'beta5-'));try {const p=join(dir,'film.h1film');await writeFile(p,b);await fn(p);}finally{await rm(dir,{recursive:true,force:true});}}
test('beta5 routes new projectile records and excludes copy-rule metadata from applications',async()=>withFilm(fixture(),async p=>{const e=await readEnvelope(p);assert.equal(e.protocol_revision,9818);assert.equal(e.network.applications,4);assert.equal(e.network.host.provenance,'initial_fnet_all_remote_v1');assert.equal(e.created_utc,1793303779);await assert.rejects(beta4(p));}));
for(const [name,mutate] of [
 ['client-view format',b=>b.writeUInt32LE(106,28)],
 ['conflicting link flags',b=>b.writeUInt32LE(58,28)],
 ['unknown protocol',b=>b.writeUInt32LE(9819,8)],
 ['overlapping ledger',b=>{b.writeUInt32LE(504,480);b.writeUInt32LE(40,484)}],
 ['truncated client evidence',b=>{b.writeUInt32LE(b.length-2,496);b.writeUInt32LE(40,500)}],
 ['unknown extension',b=>b.writeUInt32LE(1,476)],
])test('beta5 rejects '+name,async()=>{const b=fixture();mutate(b);await withFilm(b,p=>assert.rejects(readEnvelope(p)))});
test('beta5 rejects malformed projectile payload lengths and unknown records',async()=>{for(const records of [[[8,123]],[[10,31]],[[11,55]],[[12,19]],[[13,0]],[[64,4]]])await withFilm(fixture(records),p=>assert.rejects(readEnvelope(p)));});
test('beta5 accepts bounded optional ledger and client evidence plus recorded fireteams',async()=>{let b=fixture();const size=b.length;b=Buffer.concat([b,Buffer.alloc(48)]);b.writeUInt32LE(0x55,472);b.writeUInt32LE(size,480);b.writeUInt32LE(24,484);b.writeUInt32LE(size+24,496);b.writeUInt32LE(24,500);await withFilm(b,p=>readEnvelope(p));});
