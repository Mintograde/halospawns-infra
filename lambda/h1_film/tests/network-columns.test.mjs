import assert from 'node:assert/strict';
import test from 'node:test';
import {unpackNetworkColumns} from '../runtime/format3-codec.mjs';
import {unpackNetwork} from '../runtime/compact-records.mjs';

// Produce columnar fixtures directly. The retained browser decoder is an
// independent implementation and an oracle for keyed XOR and byte coverage.
function columns(count,types=[[68,44],[80,0],[67,68],[72,13],[67,2],[68,8],[65535,17]]) {
  const groups=new Map(),heads=[];
  for(let i=0;i<count;i++) {
    const [type,size]=types[i%types.length],key=type*65536+size;
    heads.push({type,size});
    if(!groups.has(key))groups.set(key,{type,size,count:0});groups.get(key).count++;
  }
  const bytes=Buffer.alloc(heads.reduce((sum,h)=>sum+8+h.size,0)),header=Buffer.alloc(8);
  for(const [i,{type,size}] of heads.entries()) {
    header.writeUInt32LE(i?3:0x80000000,0);header.writeUInt16LE(type,4);header.writeUInt16LE(size,6);
    for(let j=0;j<8;j++)bytes[j*count+i]=header[j];
  }
  let at=8*count,seed=12345;
  for(const [,group] of [...groups].sort((a,b)=>a[0]-b[0])) {
    const {type,size,count:rows}=group,keySize=type===67?1:type===68?4:0;
    for(let j=0;j<size;j++)for(let row=0;row<rows;row++) {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      bytes[at+j*rows+row]=j<keySize?(j===0?row%4:j===3?128:0):seed>>>24;
    }
    at+=rows*size;
  }
  return bytes;
}

test('network decoder matches independent reader for mixed groups, keys and unsigned fields',async()=>{
  for(const count of [1,2,3,17,257,2049]) {
    const bytes=columns(count),before=Buffer.from(bytes);
    assert.deepEqual(unpackNetworkColumns(bytes,count),Buffer.from(await unpackNetwork(bytes,count)));
    assert.deepEqual(bytes,before,'decoder mutated source columns');
  }
  const highHead=columns(1,[[5,32768]]);
  assert.deepEqual(unpackNetworkColumns(highHead,1),Buffer.from(await unpackNetwork(highHead,1)));
});

test('network decoder retains rejection and reconstruction behavior for damaged columns',async()=>{
  const original=columns(17);
  const cases=[[original,0],[original,-1],[original,1.5],[original,original.length],
    [original.subarray(0,original.length-1),17],[Buffer.concat([original,Buffer.from([0])]),17],
    [columns(1,[[67,0]]),1],[columns(1,[[68,3]]),1]];
  const overflow=columns(2);overflow[3*2+1]=128;cases.push([overflow,2]);
  for(let i=0;i<32;i++) {
    const damaged=Buffer.from(original);damaged[(i*41)%damaged.length]^=0x80;cases.push([damaged,17]);
  }
  for(const [bytes,count] of cases) {
    let expected,failed=false;
    try {expected=Buffer.from(await unpackNetwork(bytes,count));}catch {failed=true;}
    if(failed)assert.throws(()=>unpackNetworkColumns(bytes,count));
    else assert.deepEqual(unpackNetworkColumns(bytes,count),expected);
  }
});
