// Experimental, lossless column codec. No deployed format depends on this file.
import {zstdCompressSync, zstdDecompressSync, constants} from 'node:zlib';
import assert from 'node:assert/strict';

export const compress = (b, level=6) => zstdCompressSync(b, {params:{[constants.ZSTD_c_compressionLevel]:level}});
export const decompress = b => zstdDecompressSync(b, {maxOutputLength:64*1024*1024});

export function encodeColumns(rows) {
  const buffers=[]; let offset=0;
  const save=b=>{const at=offset;buffers.push(b);offset+=b.length;return [at,b.length];};
  const walk=values=>{
    const first=values[0];
    if(values.every(v=>Object.is(v,first)) && (first===null || typeof first!=='object'))
      return first===undefined?['u']:Object.is(first,-0)?['z']:['c',first];
    const present=values.filter(v=>v!==undefined && v!==null);
    const type=present.length?typeof present[0]:'empty';
    let mask=null;
    if(present.length!==values.length) mask=save(Buffer.from(values.map(v=>v===undefined?0:v===null?1:2)));
    if(!present.length)return ['m',mask];
    if(type==='object' && present.every(v=>typeof v==='object' && !Array.isArray(v))) {
      const keys=[...new Set(present.flatMap(Object.keys))];
      return ['o',mask,keys.map(k=>[k,walk(values.map(v=>v!=null&&Object.hasOwn(v,k)?v[k]:undefined))])];
    }
    if(Array.isArray(present[0]) && present.every(Array.isArray)) {
      const lengths=values.map(v=>v?.length),max=Math.max(...present.map(v=>v.length));
      assert.ok(max<=65536);
      return ['a',mask,walk(lengths),Array.from({length:max},(_,i)=>walk(values.map(v=>v?.[i])))];
    }
    if(type==='number' && present.every(v=>typeof v==='number'&&Number.isFinite(v))) {
      const integer=present.every(v=>Number.isInteger(v)&&!Object.is(v,-0)) &&
        (present.every(v=>v>=-2147483648&&v<=2147483647)||present.every(v=>v>=0&&v<=4294967295));
      const f32=present.every(v=>Object.is(Math.fround(v),v));
      const size=integer||f32?4:8,raw=Buffer.alloc(values.length*size);
      let predictor=0;
      if(f32&&!integer) {
        const bits=new Uint32Array(values.length),probe=Buffer.alloc(4);
        values.forEach((v,i)=>{probe.writeFloatLE(v??0);bits[i]=probe.readUInt32LE();});
        const costs=[0,0,0,0];let last=0,before=0;
        for(let i=0;i<bits.length;i++) {
          probe.writeUInt32LE(last);const a=probe.readFloatLE();probe.writeUInt32LE(before);const b=probe.readFloatLE();
          probe.writeFloatLE(Math.fround(2*a-b));let predicted=probe.readUInt32LE();if(!Number.isFinite(probe.readFloatLE()))predicted=last;
          const ps=[last,last,(2*last-before)>>>0,predicted];
          ps.forEach((p,j)=>{const delta=(bits[i]-p)|0;const r=j===0?(bits[i]^p)>>>0:((delta<<1)^(delta>>31))>>>0;costs[j]+=32-Math.clz32(r);});before=last;last=bits[i];
        }
        predictor=costs.indexOf(Math.min(...costs));
      }
      const tmp=Buffer.alloc(size);let previous=0,lo=0,hi=0;
      values.forEach((v,i)=>{
        if(v===undefined||v===null)v=0;
        if(integer){tmp.writeUInt32LE((v-previous)>>>0);previous=v;}
        else if(f32){tmp.writeFloatLE(v);const bits=tmp.readUInt32LE();let predicted=lo;
          if(predictor===2)predicted=(2*lo-hi)>>>0;
          if(predictor===3){tmp.writeUInt32LE(lo);const a=tmp.readFloatLE();tmp.writeUInt32LE(hi);const b=tmp.readFloatLE();tmp.writeFloatLE(Math.fround(2*a-b));if(Number.isFinite(tmp.readFloatLE()))predicted=tmp.readUInt32LE();}
          const delta=(bits-predicted)|0;tmp.writeUInt32LE(predictor===0?(bits^lo)>>>0:((delta<<1)^(delta>>31))>>>0);hi=lo;lo=bits;}
        else {tmp.writeDoubleLE(v);const a=tmp.readUInt32LE(),b=tmp.readUInt32LE(4);tmp.writeUInt32LE((a^lo)>>>0);tmp.writeUInt32LE((b^hi)>>>0,4);lo=a;hi=b;}
        for(let j=0;j<size;j++)raw[j*values.length+i]=tmp[j];
      });
      return ['n',mask,integer?(present.some(v=>v<0)?'i':'u'):f32?'f':'d',save(raw),0,predictor];
    }
    // Dictionary encoding also preserves unusual mixed-type columns.
    const dictionary=[],ids=new Map(),raw=Buffer.alloc(values.length*4);
    values.forEach((v,i)=>{const key=JSON.stringify(tagValue(v));if(!ids.has(key)){ids.set(key,dictionary.length);dictionary.push(key);}raw.writeUInt32LE(ids.get(key),i*4);});
    return ['s',mask,dictionary,save(raw)];
  };
  const tree=walk(rows),header=Buffer.from(JSON.stringify({count:rows.length,tree})),size=Buffer.alloc(4);
  size.writeUInt32LE(header.length);
  return Buffer.concat([size,header,...buffers]);
}

export function decodeColumns(raw) {
  const length=raw.readUInt32LE(),{count,tree}=JSON.parse(raw.subarray(4,4+length));
  assert.ok(count>0&&count<=32768);const data=raw.subarray(4+length);
  const take=([at,n])=>{assert.ok(at>=0&&n>=0&&at+n<=data.length);return data.subarray(at,at+n);};
  const walk=t=>{
    const [kind,mask]=t;
    if(kind==='u'||kind==='c'||kind==='z')return Array(count).fill(kind==='u'?undefined:kind==='z'?-0:mask);
    let out;
    if(kind==='m')out=Array(count);
    else if(kind==='o') {
      const fields=t[2].map(([k,child])=>[k,walk(child)]);out=Array(count);
      for(let i=0;i<count;i++) {
        if(i&&fields.every(([,v])=>Object.is(v[i],v[i-1]))){out[i]=out[i-1];continue;}
        const obj={};for(const [k,v] of fields)if(v[i]!==undefined){
          if(k==='__proto__')Object.defineProperty(obj,k,{value:v[i],enumerable:true,writable:true,configurable:true});
          else obj[k]=v[i];
        }out[i]=obj;
      }
    }
    else if(kind==='a') {
      const lengths=walk(t[2]),fields=t[3].map(walk);out=Array(count);
      for(let i=0;i<count;i++) {
        if(i&&lengths[i]===lengths[i-1]&&fields.every(v=>Object.is(v[i],v[i-1]))){out[i]=out[i-1];continue;}
        out[i]=Array.from({length:lengths[i]??0},(_,j)=>fields[j][i]);
      }
    }
    else if(kind==='n') {
      const type=t[2],size=type==='d'?8:4,b=take(t[3]),tmp=Buffer.alloc(size);let previous=0,lo=0,hi=0;
      assert.equal(b.length,count*size);out=Array(count);
      for(let i=0;i<count;i++){
        for(let j=0;j<size;j++)tmp[j]=b[j*count+i];
        if(type==='u'||type==='i'){previous=(previous+tmp.readUInt32LE())>>>0;out[i]=type==='i'?previous|0:previous;}
        else if(size===4&&t[5]){const residual=tmp.readUInt32LE();let predicted=lo;
          if(t[5]===2)predicted=(2*lo-hi)>>>0;
          if(t[5]===3){tmp.writeUInt32LE(lo);const a=tmp.readFloatLE();tmp.writeUInt32LE(hi);const b=tmp.readFloatLE();tmp.writeFloatLE(Math.fround(2*a-b));if(Number.isFinite(tmp.readFloatLE()))predicted=tmp.readUInt32LE();}
          hi=lo;lo=(predicted+((residual>>>1)^-(residual&1)))>>>0;tmp.writeUInt32LE(lo);out[i]=tmp.readFloatLE();
        }else {lo=(lo^tmp.readUInt32LE())>>>0;tmp.writeUInt32LE(lo);if(size===8){hi=(hi^tmp.readUInt32LE(4))>>>0;tmp.writeUInt32LE(hi,4);}out[i]=size===4?tmp.readFloatLE():tmp.readDoubleLE();}
      }
    } else if(kind==='s') {const b=take(t[3]),dict=t[2].map(v=>untagValue(JSON.parse(v)));assert.equal(b.length,count*4);out=Array.from({length:count},(_,i)=>dict[b.readUInt32LE(i*4)]);}
    else throw Error('Unknown column kind');
    if(mask){const b=take(mask);assert.equal(b.length,count);for(let i=0;i<count;i++){if(b[i]===0)out[i]=undefined;else if(b[i]===1)out[i]=null;else assert.equal(b[i],2);}}
    return out;
  };
  return walk(tree);
}

function tagValue(v) {
  if(v===undefined)return ['u'];if(Object.is(v,-0))return ['z'];
  if(Array.isArray(v))return ['a',v.map(tagValue)];
  if(v&&typeof v==='object')return ['o',Object.entries(v).map(([k,v])=>[k,tagValue(v)])];
  return ['c',v];
}
function untagValue([kind,v]) {
  if(kind==='u')return undefined;if(kind==='z')return -0;
  if(kind==='a')return v.map(untagValue);if(kind==='o')return Object.fromEntries(v.map(([k,v])=>[k,untagValue(v)]));
  assert.equal(kind,'c');return v;
}
