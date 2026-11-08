// Browser/Node shared, bounded reconstruction of original Beta 6 record tables.
const check=(ok,message)=>{if(!ok)throw new Error(`H1 compact records: ${message}`);};
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const MAX=128*1024*1024;
const CLIENT=[['shots',88],['clock',8],['poses',264],['hits',44],['host_verdicts',88],['aim',28],['seen',28],['net',44],['corrections',44],['pulls',48],['screen',20],['inputs',16],['blasts',28]];
const LEDGER=[['damage',28],['deaths',88],['verdicts',88],['clock',12],['inputs',16]];
const bounded=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX;

// A non-final stored DEFLATE block seeds the native browser inflater's history.
// This supplies MSZIP's dictionary without a third-party inflater or extra copy
// of the expanded account. Output and input framing remain strictly bounded.
export async function inflateWithDictionary(bytes,dictionary,wanted,schedule=async()=>{}) {
  check(dictionary.length<=32768&&wanted>0&&wanted<=32768,'invalid inflate bounds');
  const seed=new Uint8Array(5+dictionary.length),v=view(seed);
  v.setUint16(1,dictionary.length,true);v.setUint16(3,dictionary.length^65535,true);seed.set(dictionary,5);
  const input=new Uint8Array(seed.length+bytes.length);input.set(seed);input.set(bytes,seed.length);
  const stream=new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader=stream.getReader(),out=new Uint8Array(dictionary.length+wanted);let at=0;
  try {while(true){await schedule();const {done,value}=await reader.read();if(done)break;check(at+value.length<=out.length,'inflated output overflow');out.set(value,at);at+=value.length;}}
  finally {await reader.cancel();reader.releaseLock();}
  check(at===out.length,'short inflated output');return out.subarray(dictionary.length);
}

export async function unpackMszip(bytes,size,{inflateRaw=inflateWithDictionary,schedule=async()=>{}}={}) {
  check(bounded(size)&&size>0&&bytes.length>=24,'invalid MSZIP bounds');const v=view(bytes);
  check(v.getUint32(0,true)===0xc0e5510a&&v.getUint16(4,true)===24&&bytes[7]===2
    &&v.getBigUint64(8,true)===BigInt(size)&&v.getBigUint64(16,true)===BigInt(Math.min(size,32768)),'invalid MSZIP header');
  let crc=0xffffffff;
  for(let i=0;i<24;i++){if(i===6)continue;crc^=bytes[i];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}
  check(bytes[6]===((crc^0xffffffff)&255),'invalid MSZIP checksum');
  const out=new Uint8Array(size);let at=24,produced=0;
  while(produced<size){
    check(at+6<=bytes.length,'truncated MSZIP block');const n=v.getUint32(at,true);at+=4;
    check(n>=2&&at+n<=bytes.length&&bytes[at]===67&&bytes[at+1]===75,'invalid MSZIP block');
    const wanted=Math.min(32768,size-produced);
    const decoded=await inflateRaw(bytes.subarray(at+2,at+n),out.subarray(Math.max(0,produced-32768),produced),wanted,schedule);
    check(decoded.length===wanted,'MSZIP decoded size differs');out.set(decoded,produced);produced+=wanted;at+=n;await schedule();
  }
  check(at===bytes.length,'trailing MSZIP bytes');return out;
}

export async function unpackNetwork(bytes,count,schedule=async()=>{}) {
  check(Number.isSafeInteger(count)&&count>0&&count<=bytes.length/8&&bytes.length<=16*1024*1024,'invalid network bounds');
  const records=[],groups=new Map();let tick=0,at=0;
  for(let i=0;i<count;i++) {
    let delta=0,head=0;for(let j=0;j<4;j++){delta+=bytes[j*count+i]*2**(8*j);head+=bytes[(4+j)*count+i]*2**(8*j);}
    tick+=delta;check(tick<=0xffffffff,'network clock overflow');const type=head&65535,size=head>>>16,key=type*65536+size;
    check(at+8+size<=bytes.length,'invalid network payload');if(!groups.has(key))groups.set(key,{count:0,history:new Map()});
    records.push({tick,type,size,at,row:groups.get(key).count++,key});at+=8+size;
    if(i%2048===0)await schedule();
  }
  check(at===bytes.length,'network coverage differs');at=8*count;
  for(const [key,g] of [...groups].sort((a,b)=>a[0]-b[0])){g.base=at;at+=g.count*(key%65536);}
  const out=new Uint8Array(bytes.length),v=view(out);
  for(const [i,r] of records.entries()) {
    const g=groups.get(r.key),p=out.subarray(r.at+8,r.at+8+r.size);
    v.setUint32(r.at,r.tick,true);v.setUint16(r.at+4,r.type,true);v.setUint16(r.at+6,r.size,true);
    for(let j=0;j<r.size;j++)p[j]=bytes[g.base+j*g.count+r.row];
    const keySize=r.type===67?1:r.type===68?4:0;
    if(keySize){check(r.size>=keySize,'short keyed record');const key=keySize===1?p[0]:view(p).getUint32(0,true),previous=g.history.get(key);if(previous)for(let j=keySize;j<r.size;j++)p[j]^=previous[j];g.history.set(key,p);}
    if(i%2048===0)await schedule();
  }
  return out;
}

async function rowColumns(bytes,count,keyOffset,schedule) {
  check(bounded(count*28)&&bytes.length===count*28,'invalid row columns');
  const out=new Uint8Array(bytes.length),last=new Map();
  for(let i=0;i<count;i++){const row=out.subarray(i*28,(i+1)*28);for(let j=0;j<28;j++)row[j]=bytes[j*count+i];const key=row[keyOffset],previous=last.get(key);if(previous)for(let j=0;j<28;j++)if(j!==keyOffset)row[j]^=previous[j];last.set(key,row);if(i%2048===0)await schedule();}
  return out;
}

export async function readRecordedTable(bytes,descriptor,matchId,codecs={}) {
  const schedule=codecs.schedule??(async()=>{});check(bytes.length<=MAX,'source too large');const v=view(bytes),u=at=>v.getUint32(at,true);
  if(descriptor.kind==='pad') {
    check(bytes.length>=64,'short PAD');const h=Array.from({length:16},(_,i)=>u(i*4));
    const [magic,version,header,seats,stride,count,,flags,eventCount,eventSize,eventOffset,entriesOffset,,,rawSize,packedSize]=h;
    check([0x31444150,0x32444150,0x33444150].includes(magic)&&version===1&&header===64&&seats>=1&&seats<=4&&stride===14&&count<=432000&&flags<=31&&eventCount<=65536&&eventSize===16&&eventOffset===64&&entriesOffset===64+eventCount*16,'invalid PAD');
    const expected=eventCount*16+seats*14*count;check(bounded(expected),'PAD overflow');let data=bytes.subarray(64);
    if(flags&8){check(magic===0x33444150&&rawSize===expected&&packedSize===bytes.length-64,'invalid packed PAD');data=await unpackMszip(data,expected,codecs);}
    check(data.length===expected,'PAD coverage differs');
    if(descriptor.field==='events')return data.subarray(0,eventCount*16);
    check(descriptor.field==='samples','unknown PAD field');const samples=data.subarray(eventCount*16);
    if(!(flags&8))return samples;
    const out=new Uint8Array(samples.length),width=seats*14;
    for(let j=0;j<width;j++){let sum=0;for(let i=0;i<count;i++){sum=(sum+samples[j*count+i])&255;out[i*width+j]=sum;}await schedule();}return out;
  }
  const client=descriptor.kind==='account',header=client?160:88,columns=client?[...CLIENT,['packed',1]]:LEDGER;
  check(['account','ledger'].includes(descriptor.kind)&&bytes.length>=header,'invalid diagnostic kind');
  check(u(0)===(client?0x3143444c:0x3147444c)&&u(4)===(client?12:5)&&u(8)===header&&u(client?20:28)===(client?14:5),'invalid account header');
  if(!client)check(v.getBigUint64(16,true).toString(16).padStart(16,'0')===matchId,'ledger match differs');
  let at=header;const tables=new Map();
  for(const [i,[name,stride]] of columns.entries()) {
    const count=u((client?48:32)+i*8);check(count<=(name==='packed'?MAX:client?1048576:65536)&&u((client?52:36)+i*8)===stride&&bounded(count*stride)&&at+count*stride<=bytes.length,'invalid table bounds');
    tables.set(name,{count,bytes:bytes.subarray(at,at+count*stride)});at+=count*stride;
  }
  check(at===bytes.length,'trailing account data');
  if(client&&['aim','seen'].includes(descriptor.field)) {
    check(!tables.get('aim').count&&!tables.get('seen').count,'packed tables duplicated');const packed=tables.get('packed').bytes;
    if(!packed.length)return new Uint8Array();check(packed.length>=16,'short packed table');const p=view(packed),aim=p.getUint32(0,true),seen=p.getUint32(4,true),size=p.getUint32(8,true),flags=p.getUint32(12,true);
    check(aim<=524288&&seen<=1048576&&size===(aim+seen)*28&&flags<=1,'invalid packed tables');
    const raw=flags?await unpackMszip(packed.subarray(16),size,codecs):packed.subarray(16);check(raw.length===size,'packed table size differs');
    return descriptor.field==='aim'?rowColumns(raw.subarray(0,aim*28),aim,26,schedule):rowColumns(raw.subarray(aim*28),seen,22,schedule);
  }
  check(tables.has(descriptor.field)&&descriptor.field!=='packed','unknown diagnostic table');return tables.get(descriptor.field).bytes;
}
