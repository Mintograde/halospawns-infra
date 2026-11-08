import {unpackMszip,unpackNetwork,readRecordedTable} from './compact-records.mjs';
const LIMIT=536870912,BLOCK=262144,SOURCE=134217728;
const check=(ok,m)=>{if(!ok)throw Error(`H1 compact storage: ${m}`);};
const integer=(n,min=0,max=LIMIT)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const hash=/^[a-f0-9]{64}$/;
const keys=(v,names)=>v&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));

export function validateCompactStorage(m,header) {
  const entries=new Map(m.entries.map(e=>[e.id,e]));let physical=0,logical=0;
  for(const e of entries.values()) {
    logical+=e.size_bytes;const s=e.storage;check(s&&typeof s==='object','missing storage');
    if(s.kind==='stored') {
      check(keys(s,['kind','blocks'])&&Array.isArray(s.blocks)&&s.blocks.length>0&&s.blocks.length<=2048,'invalid block list');let at=0;
      for(const b of s.blocks) {
        check(keys(b,['logical_offset','offset','size_bytes','decoded_size_bytes','codec','sha256'])&&b.logical_offset===at&&b.offset===physical&&integer(b.size_bytes,1)&&integer(b.decoded_size_bytes,1)&&hash.test(b.sha256),'invalid block bounds');
        check(b.codec==='identity'?b.size_bytes===b.decoded_size_bytes:b.codec==='zstd'&&b.decoded_size_bytes<=BLOCK&&b.size_bytes<b.decoded_size_bytes,'invalid block codec');
        if(e.kind==='world')check(s.blocks.length===1&&b.codec==='identity'&&b.sha256===e.sha256,'world storage changed');
        else check(b.decoded_size_bytes<=BLOCK,'record block too large');
        at+=b.decoded_size_bytes;physical+=b.size_bytes;check(physical<=LIMIT,'physical overflow');
      }
      check(at===e.size_bytes,'logical coverage differs');continue;
    }
    const source=entries.get(s.source),track=m.tracks.find(t=>e.id.startsWith(t.id+'/'));
    // Network sources are read in bounded blocks; only table sources are read whole.
    check(source&&source.storage?.kind==='stored'&&source.size_bytes<=(s.kind==='network'?LIMIT:SOURCE)&&track&&source.id.startsWith(track.id+'/'),'invalid dependency');
    if(s.kind==='network') {
      check(keys(s,['kind','source','blocks'])&&e.id===track.network?.entry&&s.source===track.recorded_sections?.network&&source.kind==='network-observations'&&Array.isArray(s.blocks)&&s.blocks.length===track.network.blocks.length,'invalid network binding');let at=0;
      for(const [i,b]of s.blocks.entries()) {
        const expected=track.network.blocks[i];
        check(keys(b,['offset','size_bytes','source_offset','source_size_bytes','count','flags','sha256'])&&b.offset===at&&b.size_bytes===expected.size_bytes&&b.sha256===expected.sha256&&b.count===expected.count&&integer(b.size_bytes,1,16777216)&&integer(b.count,1,b.size_bytes/8)&&integer(b.source_offset,32,source.size_bytes)&&integer(b.source_size_bytes,1,source.size_bytes-b.source_offset)&&integer(b.flags,0,3),'invalid network block');at+=b.size_bytes;
      }
      check(at===e.size_bytes,'network coverage differs');
    } else {
      check(keys(s,['kind','source','field'])&&typeof s.field==='string','invalid derived table');
      if(s.kind==='pad')check(source.kind==='raw-pad'&&e.kind==='raw-pad'&&s.source===track.pad?.original&&['events','samples'].includes(s.field)&&e.id===track.pad[s.field],'invalid PAD binding');
      else {
        const kind=s.kind==='ledger'?'ledger':s.kind==='account'?'client':null;
        check(kind&&e.kind==='diagnostic-table'&&source.kind===(kind==='ledger'?'host-ledger':'client-account')&&s.source===(kind==='ledger'?track.recorded_sections?.ledger:track.alignment?.account_entry??track.account?.original)
          &&track.tables?.some(t=>t.kind===kind&&t.name===s.field&&t.entry===e.id),'invalid account binding');
      }
    }
  }
  check(integer(m.logical_size_bytes,1)&&logical===m.logical_size_bytes&&physical+header.body_offset===header.size_bytes,'container coverage differs');
}

export function compactRangeReader(readRange,header,m,codecs,sha) {
  const entries=new Map(m.entries.map(e=>[e.id,e])),cache=new Map(),pending=new Map();let used=0,epoch=0;
  const schedule=codecs.schedule??(async()=>{}),cacheLimit=33554432;
  const join=(parts,n)=>{const out=new Uint8Array(n);let at=0;for(const b of parts){check(at+b.length<=n,'range overflow');out.set(b,at);at+=b.length;}check(at===n,'short range');return out;};
  async function cached(key,load) {
    await schedule();
    if(cache.has(key)){const b=cache.get(key);cache.delete(key);cache.set(key,b);return b;}
    if(pending.has(key))return pending.get(key);
    const generation=epoch;
    const promise=(async()=>{
      const b=await load();await schedule();
      if(generation===epoch&&b.length<=cacheLimit){
        while(used+b.length>cacheLimit){const first=cache.keys().next().value;used-=cache.get(first).length;cache.delete(first);}
        cache.set(key,b);used+=b.length;
      }
      return b;
    })();
    pending.set(key,promise);
    try{return await promise;}finally{if(pending.get(key)===promise)pending.delete(key);}
  }
  async function whole(id){const e=entries.get(id);check(e,'unknown source');const b=await range(id,0,e.size_bytes);check(await sha(b)===e.sha256,'entry hash differs');return b;}
  async function range(id,at,n) {
    const e=entries.get(id);check(e&&integer(at,0,e.size_bytes)&&integer(n,1,e.size_bytes-at),'invalid entry range');await schedule();const s=e.storage;
    if(s.kind==='stored') {
      const parts=[];
      for(const b of s.blocks)if(b.logical_offset<at+n&&b.logical_offset+b.decoded_size_bytes>at){
        const begin=Math.max(0,at-b.logical_offset),end=Math.min(b.decoded_size_bytes,at+n-b.logical_offset);
        if(e.kind==='world'){const bytes=await readRange(header.body_offset+b.offset+begin,end-begin);check(bytes.length===end-begin,'short world range');parts.push(bytes);}
        else {const bytes=await cached(`${id}:${b.logical_offset}`,async()=>{
          const packed=await readRange(header.body_offset+b.offset,b.size_bytes);check(packed.length===b.size_bytes&&await sha(packed)===b.sha256,'stored block hash differs');
          const raw=b.codec==='identity'?packed:await codecs.decompressZstd(packed,b.decoded_size_bytes,schedule);check(raw.length===b.decoded_size_bytes,'decoded block size differs');return raw;
        });parts.push(bytes.subarray(begin,end));}
      }
      return join(parts,n);
    }
    if(s.kind==='network') {
      const parts=[];
      for(const b of s.blocks)if(b.offset<at+n&&b.offset+b.size_bytes>at) {
        const bytes=await cached(`${id}:${b.offset}`,async()=>{
          const packed=await range(s.source,b.source_offset,b.source_size_bytes);
          const raw=b.flags&1?await unpackMszip(packed,b.size_bytes,codecs):packed;
          const out=b.flags&2?await unpackNetwork(raw,b.count,schedule):raw;
          check(out.length===b.size_bytes&&await sha(out)===b.sha256,'network hash differs');return out;
        });parts.push(bytes.subarray(Math.max(0,at-b.offset),Math.min(b.size_bytes,at+n-b.offset)));
      }
      return join(parts,n);
    }
    const bytes=await cached(id,async()=>{
      const out=await readRecordedTable(await whole(s.source),s,m.match_id,codecs);
      check(out.length===e.size_bytes&&await sha(out)===e.sha256,'derived entry hash differs');return out;
    });return bytes.subarray(at,at+n);
  }
  return {range,clear(){epoch++;cache.clear();pending.clear();used=0;},get cachedBytes(){return used;}};
}
