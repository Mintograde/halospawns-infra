// Lossless per-chunk recompression experiment; does not publish a new container.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {constants,zstdCompressSync,zstdDecompressSync} from 'node:zlib';
const [input,output]=process.argv.slice(2);
assert.ok(input&&output);
const sha=b=>createHash('sha256').update(b).digest('hex');
const results=[];
for(const id of ['','client-0','client-1','client-2','client-3']) {
  const bytes=await readFile(join(input,id,'candidate/replay.120hz.hsrdc'));
  assert.equal(bytes.subarray(0,8).toString(),'HSRDC002');
  const size=bytes.readUInt32LE(16),base=32+size;
  const manifest=JSON.parse(zstdDecompressSync(bytes.subarray(32,base),{maxOutputLength:16*1024*1024}));
  const chunks=manifest.chunks.map(c=>{
    const compressed=bytes.subarray(base+c.offset,base+c.offset+c.compressedBytes);
    assert.equal(sha(compressed),c.compressedSha256);
    const raw=zstdDecompressSync(compressed,{maxOutputLength:64*1024*1024});
    assert.equal(raw.length,c.rawBytes);
    return raw;
  });
  for(const level of [1,3,6]) {
    const started=performance.now();
    const packed=chunks.map(raw=>zstdCompressSync(raw,{params:{
      [constants.ZSTD_c_compressionLevel]:level,[constants.ZSTD_c_checksumFlag]:1}}));
    const compression_seconds=(performance.now()-started)/1000;
    const verifyStarted=performance.now();
    for(let i=0;i<chunks.length;i++)assert.ok(zstdDecompressSync(packed[i],{maxOutputLength:chunks[i].length}).equals(chunks[i]));
    results.push({world:id||'host',level,original_chunk_bytes:bytes.length-base,
      candidate_chunk_bytes:packed.reduce((n,b)=>n+b.length,0),compression_seconds,
      verification_seconds:(performance.now()-verifyStarted)/1000,lossless:true});
  }
}
await writeFile(output,JSON.stringify({scope:'chunk recompression ablation, not a format migration',results},null,2));
console.table(results);
