import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open,stat,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createReadStream} from 'node:fs';
import {sha256} from './engine-store.mjs';
import {BETA7_MATCH_REPLAY_SCHEMA,MATCH_REPLAY_SCHEMA,PARTIAL_MATCH_REPLAY_SCHEMA,COMPACT_MATCH_REPLAY_SCHEMA,ROSTER_MATCH_REPLAY_SCHEMA,UNSUPPORTED_MATCH_REPLAY_SCHEMA,validateMatchReplay,readMatchReplayHeader} from './match-replay.mjs';
import {packCompactStorage} from './pack-compact-storage.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function writeMatchReplay(path,identity,tracks,entries) {
  let offset=0;
  const index=[];
  for(const {bytes,path,...entry} of entries) {
    assert.ok(Buffer.isBuffer(bytes)||typeof path==='string');
    const size=bytes?.length??(await stat(path)).size;
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
    index.push({...entry,offset,size_bytes:size,sha256:bytes?sha(bytes):await sha256(path)});
    offset+=size;assert.ok(offset<=512*1024*1024,'Match replay exceeds size limit');
  }
  const version=identity.sourceContract.profile_revision===11?6:identity.sourceContract.profile_revision===10?5:identity.sourceContract.profile_revision===9?4:identity.sourceContract.profile_revision===8?3:identity.sourceContract.profile_revision===7?2:1;
  const schema=version===6?BETA7_MATCH_REPLAY_SCHEMA:version===5?UNSUPPORTED_MATCH_REPLAY_SCHEMA:version===4?ROSTER_MATCH_REPLAY_SCHEMA:version===3?COMPACT_MATCH_REPLAY_SCHEMA:version===2?PARTIAL_MATCH_REPLAY_SCHEMA:MATCH_REPLAY_SCHEMA;
  const manifest={...identity,schema,tick_rate:120,authoritative_track:'host',tracks,entries:index};
  let payload=entries.map(e=>({...e,...index.find(p=>p.id===e.id)})),scratch;
  try {
  if(version>=3) {
    scratch=await mkdtemp(join(dirname(path),'.compact-'));
    const packed=await packCompactStorage(index,tracks,entries,scratch,identity.match_id,{allowUnassignedPlayer:version===6});
    manifest.logical_size_bytes=offset;payload=packed.physical;offset=packed.size;
  }
  const raw=Buffer.from(JSON.stringify(manifest)),header=Buffer.alloc(64),size=64+raw.length+offset;
  header.write(`H1MV000${version}`);header.writeUInt32LE(version,8);header.writeUInt32LE(64,12);
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
      for await(const bytes of entry.bytes?[entry.bytes]:createReadStream(entry.path)) {
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
