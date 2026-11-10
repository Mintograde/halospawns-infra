// Byte attribution for a retained private stream. Diagnostic only: this does
// not skip, project, rewrite, or validate simulation data for a conversion.
import assert from 'node:assert/strict';
import {openSync,readSync,closeSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const [source,destination]=process.argv.slice(2);assert.ok(source&&destination);
const fd=openSync(source,'r'),hash=createHash('sha256');
const totals={framing:8,keys:0,strings:0,scalars:0,containers:0,matrices:0,objects:0,spawns:0};
const keys=new Map(),strings=new Set(),roots=new Map(),previous=new Map();
let bytes=0,frames=0,maxFrame=0,buffer=Buffer.alloc(0),offset=0;
function readExact(target,eof=false) {
  let used=0;
  while(used<target.length) {
    const n=readSync(fd,target,used,target.length-used,null);
    if(n===0) {assert.ok(eof&&used===0,'Truncated stream');return false;}
    used+=n;
  }
  hash.update(target);bytes+=target.length;return true;
}
function take(n) {assert.ok(n>=0&&offset+n<=buffer.length,'Truncated frame');const start=offset;offset+=n;return start;}
function u32() {return buffer.readUInt32LE(take(4));}
function text(key=false) {
  const n=u32();assert.ok(n<=65536);const start=take(n),s=buffer.toString('utf8',start,start+n);
  if(key) {totals.keys+=n+4;keys.set(s,(keys.get(s)||0)+1);}
  else {totals.strings+=n+4;strings.add(s);}
  return s;
}
function value(depth=0) {
  assert.ok(depth<32);const tag=buffer[take(1)];
  if(tag<=6) {const size=tag<=2?0:tag===6?8:4;take(size);totals.scalars+=1+size;}
  else if(tag===7) {totals.scalars++;text();}
  else if(tag===8||tag===9) {
    const count=u32();assert.ok(count<=65536);totals.containers+=5;
    for(let i=0;i<count;i++) {
      const key=tag===9?text(true):null,start=offset;
      value(depth+1);
      if(depth===0&&tag===9) {
        const part=buffer.subarray(start,offset),prior=previous.get(key);
        const entry=roots.get(key)||{bytes:0,frames:0,unchanged_bytes:0,unchanged_frames:0};
        entry.bytes+=part.length;entry.frames++;
        if(prior?.equals(part)) {entry.unchanged_bytes+=part.length;entry.unchanged_frames++;}
        else previous.set(key,Buffer.from(part));
        roots.set(key,entry);
      }
    }
  } else if(tag===10) {take(8);text();take(44);totals.objects+=53;}
  else if(tag===11) {take(40);totals.spawns+=41;}
  else if(tag===12) {take(52);totals.matrices+=53;}
  else assert.fail('Unknown transport tag '+tag);
}
try {
  const header=Buffer.alloc(8);readExact(header);assert.equal(header.toString(),'HSFT0002');
  const length=Buffer.alloc(4),storage=Buffer.alloc(4*1024*1024);
  while(readExact(length,true)) {
    const n=length.readUInt32LE();assert.ok(n>0&&n<=storage.length);
    buffer=storage.subarray(0,n);readExact(buffer);offset=0;value();assert.equal(offset,n);
    totals.framing+=4;frames++;maxFrame=Math.max(n,maxFrame);
  }
} finally {closeSync(fd);}
assert.equal(Object.values(totals).reduce((a,b)=>a+b,0),bytes);
writeFileSync(destination,JSON.stringify({scope:'raw byte attribution; no timing claim',source,sha256:hash.digest('hex'),bytes,frames,max_frame_bytes:maxFrame,
  totals,unique_keys:keys.size,unique_strings:strings.size,
  root_fields:Object.fromEntries([...roots].sort((a,b)=>b[1].bytes-a[1].bytes)),
  largest_key_overheads:[...keys].map(([key,count])=>({key,count,bytes:count*(4+Buffer.byteLength(key))})).sort((a,b)=>b.bytes-a.bytes).slice(0,30)},null,2),{flag:'wx'});
console.log(JSON.stringify({bytes,frames,totals}));
