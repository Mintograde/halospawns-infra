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
  // Store offsets/rows and direct group references instead of allocating a
  // record object and Buffer slice for every network application.
  const offsets=new Uint32Array(count),rows=new Uint32Array(count),recordGroups=new Array(count),groups=new Map();
  const out=Buffer.alloc(bytes.length);
  let tick=0,at=0;
  for(let i=0;i<count;i++) {
    const delta=(bytes[i]|bytes[count+i]<<8|bytes[2*count+i]<<16|bytes[3*count+i]<<24)>>>0;
    const head=(bytes[4*count+i]|bytes[5*count+i]<<8|bytes[6*count+i]<<16|bytes[7*count+i]<<24)>>>0;
    tick+=delta;
    assert.ok(tick<=0xffffffff,'Network clock overflow');
    const type=head&65535,size=head>>>16,key=type*65536+size;
    assert.ok(at+8+size<=bytes.length,'Invalid network column payload');
    let group=groups.get(key);
    if(!group) {group={count:0,size,keySize:type===67?1:type===68?4:0,history:new Map()};groups.set(key,group);}
    offsets[i]=at+8;rows[i]=group.count++;recordGroups[i]=group;
    out.writeUInt32LE(tick,at);out.writeUInt32LE(head,at+4);at+=8+size;
  }
  assert.equal(at,bytes.length,'Trailing network columns');
  at=8*count;
  for(const [key,group] of [...groups].sort((a,b)=>a[0]-b[0])) {group.base=at;at+=group.count*(key%65536);}
  for(let i=0;i<count;i++) {
    const g=recordGroups[i],offset=offsets[i],row=rows[i],{size,keySize}=g;
    for(let j=0;j<size;j++) out[offset+j]=bytes[g.base+j*g.count+row];
    if(keySize) {
      assert.ok(size>=keySize,'Truncated keyed network record');
      const key=keySize===1?out[offset]:out.readUInt32LE(offset),previous=g.history.get(key);
      if(previous!==undefined) for(let j=keySize;j<size;j++) out[offset+j]^=out[previous+j];
      g.history.set(key,offset);
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
