import assert from 'node:assert/strict';
import {unpackMszip} from './adapters/beta5-v2-120.mjs';

export function fnv1a(bytes) {
  let hash=0x811c9dc5;
  for(const byte of bytes) hash=Math.imul(hash^byte,0x01000193)>>>0;
  return hash;
}

// Pinned upstream blampc_film_net_uncolumns: time/head byte columns followed
// by payload groups sorted by (kind,size), with keyed XOR history per block.
export function unpackNetworkColumns(bytes,count) {
  assert.ok(Number.isSafeInteger(count)&&count>0&&count<=bytes.length/8,'Invalid network column count');
  const records=[],groups=new Map();
  let tick=0,at=0;
  for(let i=0;i<count;i++) {
    let delta=0,head=0;
    for(let j=0;j<4;j++) {delta+=(bytes[j*count+i]*2**(8*j));head+=(bytes[(4+j)*count+i]*2**(8*j));}
    tick+=delta;
    assert.ok(tick<=0xffffffff,'Network clock overflow');
    const type=head&65535,size=head>>>16,key=type*65536+size;
    assert.ok(at+8+size<=bytes.length,'Invalid network column payload');
    if(!groups.has(key)) groups.set(key,{count:0,history:new Map()});
    const group=groups.get(key),row=group.count++;
    records.push({tick,type,size,at,row,key});at+=8+size;
  }
  assert.equal(at,bytes.length,'Trailing network columns');
  at=8*count;
  for(const [key,group] of [...groups].sort((a,b)=>a[0]-b[0])) {group.base=at;at+=group.count*(key%65536);}
  const out=Buffer.alloc(bytes.length);
  for(const r of records) {
    const g=groups.get(r.key),p=out.subarray(r.at+8,r.at+8+r.size);
    out.writeUInt32LE(r.tick,r.at);out.writeUInt16LE(r.type,r.at+4);out.writeUInt16LE(r.size,r.at+6);
    for(let j=0;j<r.size;j++) p[j]=bytes[g.base+j*g.count+r.row];
    const keySize=r.type===67?1:r.type===68?4:0;
    if(keySize) {
      assert.ok(r.size>=keySize,'Truncated keyed network record');
      const key=p.readUIntLE(0,keySize),previous=g.history.get(key);
      if(previous) for(let j=keySize;j<r.size;j++) p[j]^=previous[j];
      g.history.set(key,p);
    }
  }
  return out;
}

export async function inspectTickBlocks(file,start,end,frames) {
  let at=start,rawTotal=0,frameTotal=0;
  while(at<end) {
    assert.ok(at+32<=end,'Truncated FTCK header');
    const head=Buffer.alloc(32);
    assert.equal((await file.read(head,0,32,at)).bytesRead,32);
    const w=Array.from({length:8},(_,i)=>head.readUInt32LE(i*4));
    assert.ok(w[0]===0x4b435446&&w[1]>0&&w[1]<=16*1024*1024&&w[2]>0&&w[3]<=1,'Invalid FTCK block');
    assert.equal(w[4],rawTotal,'Noncontiguous tick stream');
    assert.ok(at+32+w[2]<=end,'Truncated FTCK payload');
    const packed=Buffer.alloc(w[2]);
    assert.equal((await file.read(packed,0,packed.length,at+32)).bytesRead,packed.length);
    const raw=w[3]&1?unpackMszip(packed,w[1]):packed;
    assert.equal(raw.length,w[1],'FTCK size mismatch');
    assert.equal(fnv1a(packed),w[7],'FTCK checksum mismatch');
    assert.equal(w[5],frameTotal,'Noncontiguous FTCK frames');
    rawTotal+=raw.length;frameTotal+=w[6];
    assert.ok(rawTotal<=512*1024*1024,'Tick expansion limit exceeded');
    at+=32+packed.length;
  }
  assert.equal(at,end);
  assert.equal(frameTotal,frames,'FTCK frame count mismatch');
  return {raw_bytes:rawTotal,frames:frameTotal};
}
