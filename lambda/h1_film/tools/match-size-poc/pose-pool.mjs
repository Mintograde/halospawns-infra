// Research codec: exact bone states shared across independent client worlds.
// Each group is self-contained. It never equates two nearby-but-different poses.
import assert from 'node:assert/strict';
import {poseRuns,serializePoseRuns} from './pose-columns.mjs';

export function encodePosePool(sources) {
  const pools=Array.from({length:64},()=>({ids:new Map(),values:[]})),buffers=[];let offset=0,hits=0,total=0;
  const save=b=>{const range=[offset,b.length];offset+=b.length;buffers.push(b);return range;};
  const views=sources.map(source=>poseRuns(source).map(r=>{
    const indices=[];
    for(let bone=0;bone<r.bones;bone++) {
      const pool=pools[bone],bytes=Buffer.alloc(32),references=Buffer.alloc(r.frames*4);let previous=0;
      for(let frame=0;frame<r.frames;frame++) {
        for(let j=0;j<8;j++)bytes.writeInt32LE(r.channels[bone*8+j][frame],j*4);
        const key=bytes.toString('latin1');let id=pool.ids.get(key);
        if(id===undefined){id=pool.values.length;pool.ids.set(key,id);pool.values.push(Buffer.from(bytes));}else hits++;
        references.writeInt32LE(id-previous,frame*4);previous=id;total++;
      }
      indices.push(save(references));
    }
    return {first:r.first,player:r.player,frames:r.frames,bones:r.bones,parents:r.parents,modes:r.modes,indices,fallback:save(r.fallback)};
  }));
  const dictionaries=pools.map(pool=>{
    const n=pool.values.length,bytes=Buffer.alloc(n*32);
    for(let j=0;j<8;j++){let previous=0;for(let i=0;i<n;i++){const value=pool.values[i].readInt32LE(j*4),delta=(value-previous)|0;previous=value;for(let k=0;k<4;k++)bytes[(j*4+k)*n+i]=(delta>>>(k*8))&255;}}
    return {count:n,range:save(bytes)};
  });
  const metadata=Buffer.from(JSON.stringify({dictionaries,views})),header=Buffer.alloc(4);header.writeUInt32LE(metadata.length);
  const bytes=Buffer.concat([header,metadata,...buffers]);assert.ok(bytes.length<=64*1024*1024,'pose pool group too large');
  return {bytes,total,hits};
}

export function decodePosePool(bytes) {
  const n=bytes.readUInt32LE(),{dictionaries,views}=JSON.parse(bytes.subarray(4,4+n)),data=bytes.subarray(4+n);
  const take=([at,n])=>{assert.ok(at>=0&&n>=0&&at+n<=data.length);return data.subarray(at,at+n);};
  const pools=dictionaries.map(({count,range})=>{
    const b=take(range);assert.equal(b.length,count*32);const values=new Int32Array(count*8);
    for(let j=0;j<8;j++){let previous=0;for(let i=0;i<count;i++){let delta=0;for(let k=0;k<4;k++)delta+=b[(j*4+k)*count+i]*2**(k*8);previous=(previous+delta)|0;values[i*8+j]=previous;}}
    return values;
  });
  return views.map(runs=>serializePoseRuns(runs.map(r=>{
    const channels=Array.from({length:r.bones*8},()=>new Int32Array(r.frames));
    r.indices.forEach((range,bone)=>{const b=take(range);assert.equal(b.length,r.frames*4);let id=0;
      for(let frame=0;frame<r.frames;frame++){id+=b.readInt32LE(frame*4);assert.ok(id>=0&&id*8+8<=pools[bone].length);for(let j=0;j<8;j++)channels[bone*8+j][frame]=pools[bone][id*8+j];}
    });return {...r,channels,fallback:take(r.fallback)};
  })));
}
