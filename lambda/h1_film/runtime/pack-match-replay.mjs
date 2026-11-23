import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open,stat,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createReadStream} from 'node:fs';
import {sha256} from './engine-store.mjs';
import {MATCH_REPLAY_MAX_BYTES,MATCH_REPLAY_MAX_LOGICAL_BYTES,validateMatchReplay,readMatchReplayHeader} from './match-replay.mjs';
import {packCompactStorage} from './pack-compact-storage.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function writeMatchReplay(path,identity,tracks,entries) {
  const version=identity.sourceContract.profile_revision-5;
  assert.ok(Number.isInteger(version)&&version>=1&&version<=10,'Invalid match replay revision');
  const logicalLimit=version>=7?MATCH_REPLAY_MAX_LOGICAL_BYTES:MATCH_REPLAY_MAX_BYTES;
  let offset=0;
  const index=[];
  for(const {bytes,path,derived,worldHash,...entry} of entries) {
    if (derived) {
      assert.ok(version>=3 && entry.kind!=='world' && !bytes && !path);
      assert.match(derived.hash,/^[0-9a-f]{64}$/);
    } else assert.ok(Buffer.isBuffer(bytes)||typeof path==='string');
    const size=derived?.length??bytes?.length??(await stat(path)).size;
    assert.ok(Number.isSafeInteger(size)&&size>0&&size<=MATCH_REPLAY_MAX_BYTES,'Match entry exceeds size limit');
    if(entry.kind==='world') {
      const file=path?await open(path,'r'):null;
      try {
        const head=bytes?.subarray(0,32)??Buffer.alloc(32);
        if(file)assert.equal((await file.read(head,0,32,0)).bytesRead,32);
        assert.equal(head.subarray(0,8).toString(),'HSRDC002');
        const length=32+head.readUInt32LE(16);
        assert.ok(length>32&&length<=size&&length<=16*1024*1024);
        const index=bytes?.subarray(0,length)??Buffer.alloc(length);
        if(file)assert.equal((await file.read(index,0,length,0)).bytesRead,length);
        entry.index_size_bytes=length;entry.index_sha256=sha(index);
      } finally {await file?.close();}
    }
    // The copy loop below verifies every physical byte against this pin. A
    // verified world already supplies its digest, including a rebound host.
    if (worldHash !== undefined) {
      assert.equal(entry.kind,'world');
      assert.match(worldHash,/^[0-9a-f]{64}$/);
    }
    const hash=worldHash??derived?.hash??(bytes?sha(bytes):await sha256(path));
    index.push({...entry,offset,size_bytes:size,sha256:hash});
    offset+=size;assert.ok(offset<=logicalLimit,'Match replay exceeds logical size limit');
  }
  const schema=`halospawns.h1MatchReplay.v${version}`;
  const manifest={...identity,schema,tick_rate:identity.tick_rate??120,authoritative_track:'host',tracks,entries:index};
  let payload,scratch;
  try {
  if(version>=3) {
    scratch=await mkdtemp(join(dirname(path),'.compact-'));
    const packed=await packCompactStorage(index,tracks,entries,scratch,identity.match_id,{allowUnassignedPlayer:version>=6});
    manifest.logical_size_bytes=offset;payload=packed.physical;offset=packed.size;
  } else payload=entries.map((e,i)=>({...e,...index[i]}));
  const raw=Buffer.from(JSON.stringify(manifest)),header=Buffer.alloc(64),size=64+raw.length+offset;
  assert.ok(size<=MATCH_REPLAY_MAX_BYTES,'Match replay exceeds physical file size limit');
  header.write(`H1MV${String(version).padStart(4,'0')}`);header.writeUInt32LE(version,8);header.writeUInt32LE(64,12);
  header.writeUInt32LE(raw.length,16);header.writeUInt32LE(size,20);Buffer.from(sha(raw),'hex').copy(header,32);
  validateMatchReplay(manifest,readMatchReplayHeader(header));
  const file=await open(path,'wx'),hash=createHash('sha256');
  try {
    async function write(bytes) {
      hash.update(bytes);let written=0;
      while(written<bytes.length) written+=(await file.write(bytes,written,bytes.length-written)).bytesWritten;
    }
    await write(header);await write(raw);
    for(const entry of payload) {
      const check=createHash('sha256');let size=0;
      for await(const bytes of entry.bytes?[entry.bytes]:createReadStream(entry.path,{highWaterMark:1024*1024})) {
        check.update(bytes);size+=bytes.length;await write(bytes);
      }
      assert.equal(size,entry.size_bytes,'Entry changed during packing');
      assert.equal(check.digest('hex'),entry.sha256,'Entry changed during packing');
    }
  } finally {await file.close();}
  return {schema,size_bytes:size,sha256:hash.digest('hex'),manifest_sha256:sha(raw),manifest};
  } finally {
    if(scratch){assert.equal(dirname(resolve(scratch)),dirname(resolve(path)));await rm(scratch,{recursive:true,force:true});}
  }
}
