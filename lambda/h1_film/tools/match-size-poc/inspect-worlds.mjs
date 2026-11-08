import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import assert from 'node:assert/strict';
import {compress,decompress,encodeColumns,decodeColumns} from './columns.mjs';
import {encodePosePool,decodePosePool} from './pose-pool.mjs';
import {openMatchReplay} from '../../runtime/match-replay.mjs';
import {sha} from './compact.mjs';

const [input,viewerRoot,output]=process.argv.slice(2);
if(!output)throw Error('Usage: node inspect-worlds.mjs SOURCE VIEWER_REPO OUTPUT_DIRECTORY');
const {decodeReplayDeltaChunk}=await import(pathToFileURL(resolve(viewerRoot,'packages/viewer/src/lib/core/session/replayDeltaCodec.js')));
await mkdir(output,{recursive:true});
const source=await readFile(input),opened=await openMatchReplay(async(at,n)=>source.subarray(at,at+n));
const worlds=opened.manifest.entries.filter(e=>e.kind==='world').map(e=>{
  const bytes=source.subarray(opened.header.body_offset+e.offset,opened.header.body_offset+e.offset+e.size_bytes);
  assert.equal(sha(bytes),e.sha256);const start=32+bytes.readUInt32LE(16),index=JSON.parse(decompress(bytes.subarray(32,start)));
  return {id:e.id,bytes,start,index};
});
const result={source_sha256:sha(source),source_bytes:source.length,worlds:worlds.length,groups:[],column_samples:[]};
let oldPoses=0,newPoses=0,encodeMs=0,decodeMs=0,totalTicks=0;
for(let i=0;i<Math.max(...worlds.map(w=>w.index.chunks.length));i++) {
  const poses=[],tracks=[];
  for(const w of worlds) {
    const c=w.index.chunks[i];if(!c)continue;
    const packed=w.bytes.subarray(w.start+c.offset,w.start+c.offset+c.compressedBytes);assert.equal(sha(packed),c.compressedSha256);
    const raw=decompress(packed);assert.equal(sha(raw),c.rawSha256);assert.equal(raw.toString('ascii',0,4),'PC01');
    const bc=raw.readUInt32LE(8),pc=raw.readUInt32LE(16),pose=decompress(raw.subarray(20+bc));
    poses.push(pose);tracks.push({id:w.id,chunk:i,firstTick:c.firstTick,tickCount:c.tickCount,sha256:sha(pose)});oldPoses+=pc;totalTicks+=c.tickCount;
    if([0,Math.floor(w.index.chunks.length/2),w.index.chunks.length-1].includes(i)) {
      const decoded=decodeReplayDeltaChunk(decompress(raw.subarray(20,20+bc))),ticks=decoded.ticks;
      const begin=performance.now();
      const normalized=ticks.map(t=>{
        assert.equal(new Set(t.objects.map(o=>o.object_id)).size,t.objects.length);
        return {...t,objects:{order:t.objects.map(o=>o.object_id),byId:Object.fromEntries(t.objects.map(o=>[o.object_id,o]))}};
      });
      const candidate=compress(encodeColumns(normalized)),mid=performance.now();
      const restored=decodeColumns(decompress(candidate)).map(t=>({...t,objects:t.objects.order.map(id=>t.objects.byId[id])})),end=performance.now();
      assert.ok(isDeepStrictEqual(restored,ticks),'decoded base differs');
      result.column_samples.push({id:w.id,chunk:i,old_base_bytes:bc,new_base_bytes:candidate.length,encode_ms:mid-begin,decode_ms:end-mid,all_values_exact:true});
    }
  }
  const begin=performance.now(),pool=encodePosePool(poses),packed=compress(pool.bytes),mid=performance.now();
  const decoded=decodePosePool(decompress(packed)),end=performance.now();
  assert.equal(decoded.length,poses.length);decoded.forEach((p,j)=>assert.ok(p.equals(poses[j]),'pose bytes differ'));
  encodeMs+=mid-begin;decodeMs+=end-mid;newPoses+=packed.length;
  const file=`poses-${String(i).padStart(4,'0')}.zst`;await writeFile(join(output,file),packed,{flag:'wx'});
  result.groups.push({file,bytes:packed.length,sha256:sha(packed),raw_bytes:pool.bytes.length,bone_frames:pool.total,reused_bone_frames:pool.hits,encode_ms:mid-begin,decode_ms:end-mid,tracks});
  if(i%10===0)console.log(JSON.stringify({group:i,old_pose_bytes:oldPoses,new_pose_bytes:newPoses}));
}
result.summary={ticks:totalTicks,old_pose_bytes:oldPoses,new_pose_bytes:newPoses,pose_reduction:1-newPoses/oldPoses,pose_encode_ms:encodeMs,pose_decode_ms:decodeMs,
  all_pose_bytes_exact:true,column_sample_count:result.column_samples.length,
  sampled_old_base_bytes:result.column_samples.reduce((n,s)=>n+s.old_base_bytes,0),sampled_new_base_bytes:result.column_samples.reduce((n,s)=>n+s.new_base_bytes,0)};
await writeFile(join(output,'results.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result.summary));
