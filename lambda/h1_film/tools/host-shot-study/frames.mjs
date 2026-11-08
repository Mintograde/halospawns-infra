import fs from 'node:fs';
import assert from 'node:assert/strict';
import {expandFrame} from '../canonical-transport.mjs';
export function* readFrames(file){
 const fd=fs.openSync(file,'r'),size=fs.fstatSync(fd).size;
 const magic=Buffer.alloc(8),length=Buffer.alloc(4),packed=Buffer.alloc(4*1024*1024),expanded=Buffer.alloc(packed.length);
 try{
  assert.equal(fs.readSync(fd,magic,0,8,0),8);assert.equal(magic.toString(),'HSFT0002');
  let position=8;
  while(position<size){
   assert.equal(fs.readSync(fd,length,0,4,position),4);
   const n=length.readUInt32LE();assert(n>=5&&n<=packed.length&&position+4+n<=size);
   assert.equal(fs.readSync(fd,packed,0,n,position+4),n);position+=4+n;
   const input=expandFrame(packed.subarray(0,n),expanded);let offset=0;
   function count(){const result=input.readUInt32LE(offset);offset+=4;return result;}
   function text(){const len=count(),result=input.toString('utf8',offset,offset+len);offset+=len;return result;}
   function value(){
    const tag=input[offset++];
    if(tag===0)return null;
    if(tag<=2)return tag===2;
    if(tag===3){const r=input.readInt32LE(offset);offset+=4;return r;}
    if(tag===4)return count();
    if(tag===5){const r=input.readFloatLE(offset);offset+=4;return r;}
    if(tag===6){const r=input.readDoubleLE(offset);offset+=8;return r;}
    if(tag===7)return text();
    if(tag===8)return Array.from({length:count()},value);
    assert.equal(tag,9);
    const result=Object.create(null),len=count();
    for(let i=0;i<len;i++)result[text()]=value();
    return result;
   }
   const frame=value();assert.equal(offset,input.length);yield frame;
  }
  assert.equal(position,size);
 }finally{fs.closeSync(fd);}
}
