// Local lossless acceptance/benchmark. Never contacts hosted services.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {zstdDecompressSync,inflateRawSync} from 'node:zlib';
import {writeMatchReplay} from '../runtime/pack-match-replay.mjs';
import {openMatchReplay,COMPACT_MATCH_PROJECTION} from '../runtime/match-replay.mjs';
export const nativeCodecs={
  decompressZstd:(b,n)=>zstdDecompressSync(b,{maxOutputLength:n}),
  inflateRaw:(b,d,n)=>{const r=inflateRawSync(b,{dictionary:d,maxOutputLength:n,info:true});assert.equal(r.engine.bytesWritten,b.length);return r.buffer;},
};
const [folder,out]=process.argv.slice(2);
if(folder&&out) {
  const f=JSON.parse(await readFile(join(folder,'finalization.json'),'utf8'));
  const descriptor=Object.values(f).find(v=>v?.artifact_kind==='viewer_replay_delta');assert.ok(descriptor);
  const bytes=await readFile(join(folder,'objects',descriptor.s3_key));
  const original=await openMatchReplay(async(at,n)=>bytes.subarray(at,at+n));
  const {schema,entries,tracks,tick_rate,authoritative_track,...identity}=original.manifest;
  identity.sourceContract={...identity.sourceContract,profile_revision:8,projection_sha256:COMPACT_MATCH_PROJECTION};
  await mkdir(out,{recursive:true});
  const start=performance.now(),packed=await writeMatchReplay(join(out,'match.hsrv'),identity,tracks,
    entries.map(e=>({...e,bytes:bytes.subarray(original.header.body_offset+e.offset,original.header.body_offset+e.offset+e.size_bytes)})));
  const packMs=performance.now()-start,data=await readFile(join(out,'match.hsrv')),verifyAt=performance.now();
  let fetched=0;
  const reader=await openMatchReplay(async(at,n)=>{fetched+=n;return data.subarray(at,at+n);},{size_bytes:data.length},nativeCodecs);
  for(const e of entries)assert.ok(Buffer.from(await reader.readEntry(e.id)).equals(await original.readEntry(e.id)),e.id);
  const verifyMs=performance.now()-verifyAt,seeks=[];
  for(const e of [...entries].reverse()) {
    reader.clearCache();const start=performance.now(),before=fetched,at=Math.floor(e.size_bytes/2),n=Math.min(4096,e.size_bytes-at);
    assert.ok(Buffer.from(await reader.rangeReader(e.id)(at,n)).equals(await original.rangeReader(e.id)(at,n)),e.id);
    assert.ok(reader.cachedBytes<=33554432);
    seeks.push({id:e.id,kind:e.kind,ms:performance.now()-start,fetched:fetched-before});
  }
  const report={source:resolve(folder),original_bytes:bytes.length,compact_bytes:data.length,reduction:1-data.length/bytes.length,
    pack_ms:packMs,verify_ms:verifyMs,entries_verified:entries.length,ranges_verified:seeks.length,sha256:packed.sha256,
    manifest_sha256:packed.manifest_sha256,logical_size_bytes:packed.manifest.logical_size_bytes,seeks};
  await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,seeks:undefined}));
}
