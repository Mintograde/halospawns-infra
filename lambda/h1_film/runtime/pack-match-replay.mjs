import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {sha256} from './engine-store.mjs';
import {MATCH_REPLAY_SCHEMA,MATCH_REPLAY_MAGIC,validateMatchReplay,readMatchReplayHeader} from './match-replay.mjs';
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
  const manifest={...identity,schema:MATCH_REPLAY_SCHEMA,tick_rate:120,authoritative_track:'host',tracks,entries:index};
  const raw=Buffer.from(JSON.stringify(manifest)),header=Buffer.alloc(64),size=64+raw.length+offset;
  header.write(MATCH_REPLAY_MAGIC);header.writeUInt32LE(1,8);header.writeUInt32LE(64,12);
  header.writeUInt32LE(raw.length,16);header.writeUInt32LE(size,20);Buffer.from(sha(raw),'hex').copy(header,32);
  validateMatchReplay(manifest,readMatchReplayHeader(header));
  const file=await open(path,'wx'),hash=createHash('sha256');
  try {
    async function write(bytes) {
      hash.update(bytes);let written=0;
      while(written<bytes.length) written+=(await file.write(bytes,written,bytes.length-written)).bytesWritten;
    }
    await write(header);await write(raw);
    for(const entry of entries) {
      const check=createHash('sha256');let size=0;
      for await(const bytes of entry.bytes?[entry.bytes]:createReadStream(entry.path)) {
        check.update(bytes);size+=bytes.length;await write(bytes);
      }
      const pin=index.find(e=>e.id===entry.id);
      assert.equal(size,pin.size_bytes,'Entry changed during packing');
      assert.equal(check.digest('hex'),pin.sha256,'Entry changed during packing');
    }
  } finally {await file.close();}
  return {schema:MATCH_REPLAY_SCHEMA,size_bytes:size,sha256:hash.digest('hex'),manifest_sha256:sha(raw),manifest};
}
