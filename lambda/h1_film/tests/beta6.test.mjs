import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,open,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fnv1a,unpackNetworkColumns,inspectTickBlocks} from '../runtime/format3-codec.mjs';
import {inspectMatchFilm} from '../tools/inspect-match-film.mjs';

test('format 3 network columns restore times and keyed state XOR',()=>{
  const packed=Buffer.from([0,1,0,0,0,0,0,0,67,67,0,0,2,2,0,0,3,3,10,6]);
  const decoded=unpackNetworkColumns(packed,2);
  assert.deepEqual([...decoded],[0,0,0,0,67,0,2,0,3,10,1,0,0,0,67,0,2,0,3,12]);
  assert.throws(()=>unpackNetworkColumns(packed,3),/count/);
  assert.throws(()=>unpackNetworkColumns(packed.subarray(0,19),2),/payload/);
});

test('format 3 tick blocks reject damaged bytes and false coverage',async()=>{
  assert.equal(fnv1a(Buffer.from('hello')),0x4f9f2cab);
  const dir=await mkdtemp(join(tmpdir(),'h1-f3-'));
  try {
    const bytes=Buffer.alloc(37);
    [0x4b435446,5,5,0,0,0,1,0x4f9f2cab].forEach((v,i)=>bytes.writeUInt32LE(v,i*4));
    bytes.write('hello',32);
    const path=join(dir,'stream');await writeFile(path,bytes);
    const f=await open(path,'r');
    try {
      assert.deepEqual(await inspectTickBlocks(f,0,37,1),{raw_bytes:5,frames:1});
      await assert.rejects(inspectTickBlocks(f,0,36,1),/payload/);
      await assert.rejects(inspectTickBlocks(f,0,37,2),/frame count/);
    } finally {await f.close();}
    bytes[36]^=1;await writeFile(path,bytes);
    const damaged=await open(path,'r');
    try {await assert.rejects(inspectTickBlocks(damaged,0,37,1),/checksum/);} finally {await damaged.close();}
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('match film inspection rejects unsupported and truncated tables',()=>{
  const b=Buffer.alloc(1040);
  b.writeUInt32LE(0x314d4c46,0);b.writeUInt32LE(3,4);b.writeUInt32LE(536,64);
  b.writeUInt32LE(0x4843544d,504);b.writeUInt32LE(2,508);
  b.writeUInt32LE(536,512);b.writeUInt32LE(504,516);b.writeUInt32LE(1040,520);
  b.writeUInt32LE(112,528);b.writeUInt32LE(0x314d4c46,536);b.writeUInt32LE(3,540);
  b.writeUInt32LE(504,600);b.writeUInt32LE(1,488);b.writeUInt32LE(1,1024);
  assert.equal(inspectMatchFilm(b).parts.length,0);
  b.writeUInt32LE(1,524);assert.throws(()=>inspectMatchFilm(b),/bounds/);
  b.writeUInt32LE(3,508);assert.throws(()=>inspectMatchFilm(b),/version/);
});
