import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decompress} from './columns.mjs';
import {openMatchReplay} from '../../runtime/match-replay.mjs';
import {sha} from './compact.mjs';

const [input,viewerRoot,output]=process.argv.slice(2);
if(!output)throw Error('Usage: node inspect-alignment.mjs SOURCE VIEWER_REPO OUTPUT.json');
const {decodeReplayDeltaChunk}=await import(pathToFileURL(resolve(viewerRoot,'packages/viewer/src/lib/core/session/replayDeltaCodec.js')));
const source=await readFile(input),opened=await openMatchReplay(async(at,n)=>source.subarray(at,at+n)),tracks=[];
const first=32768,last=40960,maxOffset=240,stride=4;
for(const e of opened.manifest.entries.filter(e=>e.kind==='world')) {
  const bytes=source.subarray(opened.header.body_offset+e.offset,opened.header.body_offset+e.offset+e.size_bytes);
  if(sha(bytes)!==e.sha256)throw Error('world hash differs');
  const start=32+bytes.readUInt32LE(16),index=JSON.parse(decompress(bytes.subarray(32,start))),ticks=[];
  for(const c of index.chunks.filter(c=>c.firstTick>=first&&c.firstTick<last)) {
    const raw=decompress(bytes.subarray(start+c.offset,start+c.offset+c.compressedBytes));
    const base=decodeReplayDeltaChunk(decompress(raw.subarray(20,20+raw.readUInt32LE(8))));
    ticks.push(...base.ticks.map(t=>t.players.map(p=>({id:p.player_index,x:p.player_object_data?.x,y:p.player_object_data?.y,z:p.player_object_data?.z}))));
  }
  tracks.push({id:e.id,ticks});
}
const host=tracks[0],pairs=[];
for(const client of tracks.slice(1))for(const id of [0,1,2,3]) {
  let best={offset:0,count:0,total:0,fraction:0};
  for(let offset=-maxOffset;offset<=maxOffset;offset++) {
    let count=0,total=0;
    for(let i=maxOffset;i<Math.min(host.ticks.length,client.ticks.length)-maxOffset;i+=stride) {
      const a=host.ticks[i].find(p=>p.id===id),b=client.ticks[i+offset].find(p=>p.id===id);
      if(!a||!b||a.x===undefined||b.x===undefined)continue;
      total++;if(a.x===b.x&&a.y===b.y&&a.z===b.z)count++;
    }
    if(count>best.count)best={offset,count,total,fraction:count/total};
  }
  pairs.push({client:client.id,player:id,...best});
}
const report={source_sha256:sha(source),first_frame:first,end_frame_exclusive:last,max_offset:maxOffset,sample_stride:stride,pairs};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
