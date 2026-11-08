// Offline candidate: losslessly virtualize a deployed H1MV artifact. This is
// deliberately separate from the immutable runtime recipes and format pins.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {zstdCompressSync,zstdDecompressSync,constants} from 'node:zlib';
import {openMatchReplay,readMatchReplayHeader,validateMatchReplay} from '../../runtime/match-replay.mjs';
import {readClientAccount,readHostLedger} from '../../runtime/format3-diagnostics.mjs';
import {readRawPad} from '../../runtime/format3-pad.mjs';
import {unpackMszip} from '../../runtime/adapters/beta5-v2-120.mjs';
import {unpackNetworkColumns} from '../../runtime/format3-codec.mjs';

const LIMIT=512*1024*1024, BLOCK=256*1024;
export const sha=b=>createHash('sha256').update(b).digest('hex');
const zip=b=>zstdCompressSync(b,{params:{[constants.ZSTD_c_compressionLevel]:6}});
const unzip=(b,size)=>{assert.ok(size>0&&size<=128*1024*1024);const raw=zstdDecompressSync(b,{maxOutputLength:size});assert.equal(raw.length,size);return raw;};

function networkBlocks(bytes) {
  const out=[];let at=32,offset=0;
  for(let i=0;i<bytes.readUInt32LE(24);i++) {
    const [size,packed,first,last,count,flags]=Array.from({length:6},(_,j)=>bytes.readUInt32LE(at+j*4));
    assert.ok(size>0&&size<=16*1024*1024&&packed>0&&flags<=3&&at+24+packed<=bytes.length);
    out.push({source_offset:at+24,source_size:packed,offset,size,count,flags});at+=24+packed;offset+=size;
  }
  assert.equal(at,bytes.length);return out;
}
function expandNetwork(bytes,block) {
  const packed=bytes.subarray(block.source_offset,block.source_offset+block.source_size);
  const raw=block.flags&1?unpackMszip(packed,block.size):packed;
  return block.flags&2?unpackNetworkColumns(raw,block.count):raw;
}

export async function compactMatch(source) {
  const opened=await openMatchReplay(async(at,n)=>source.subarray(at,at+n),{size_bytes:source.length}),m=opened.manifest;
  const entries=new Map(m.entries.map(e=>[e.id,e]));
  const raw=id=>{const e=entries.get(id);assert.ok(e);return source.subarray(opened.header.body_offset+e.offset,opened.header.body_offset+e.offset+e.size_bytes);};
  for(const e of m.entries)assert.equal(sha(raw(e.id)),e.sha256,'source entry hash differs');
  const derived=new Map();
  for(const t of m.tracks) {
    if(t.network) {
      const id=t.recorded_sections.network,bytes=raw(id),blocks=networkBlocks(bytes),original=raw(t.network.entry);
      for(const block of blocks)assert.ok(expandNetwork(bytes,block).equals(original.subarray(block.offset,block.offset+block.size)),'network reconstruction differs');
      assert.equal(blocks.reduce((n,b)=>n+b.size,0),original.length);
      derived.set(t.network.entry,{method:'network',source:id,blocks});
    }
    if(t.pad) {
      const pad=readRawPad(raw(t.pad.original));
      for(const key of ['samples','events'])if(t.pad[key]) {
        assert.ok(pad[key].equals(raw(t.pad[key])),'pad reconstruction differs');
        derived.set(t.pad[key],{method:'pad',source:t.pad.original,field:key});
      }
    }
    for(const table of t.tables??[])if(table.count) {
      const id=table.kind==='ledger'?t.recorded_sections.ledger:t.alignment?.account_entry??t.account?.original;
      assert.ok(id,'missing diagnostic source');
      const account=table.kind==='ledger'?readHostLedger(raw(id),m.match_id):readClientAccount(raw(id));
      const value=account.tables.find(v=>v.name===table.name).bytes;
      assert.ok(value.equals(raw(table.entry)),'table reconstruction differs');
      derived.set(table.entry,{method:table.kind==='ledger'?'ledger':'account',source:id,field:table.name});
    }
  }
  const chunks=[],layouts=[];let offset=0;
  for(const e of m.entries) {
    if(derived.has(e.id)){layouts.push({id:e.id,derived:derived.get(e.id)});continue;}
    const bytes=raw(e.id),blocks=[];
    // World chunks already have their own compression and hashes. Retaining
    // identity storage preserves the viewer's original small HTTP range reads.
    for(let at=0;at<bytes.length;at+=e.kind==='world'?bytes.length:BLOCK) {
      const data=bytes.subarray(at,Math.min(bytes.length,at+(e.kind==='world'?bytes.length:BLOCK)));
      const compressed=e.kind==='world'?data:zip(data),use=compressed.length<data.length;
      const payload=use?compressed:data;
      blocks.push({at,raw:data.length,offset,size:payload.length,codec:use?'zstd':'identity',sha256:sha(payload)});
      chunks.push(payload);offset+=payload.length;
    }
    layouts.push({id:e.id,blocks});
  }
  const index={schema:'halospawns.experimentalCompactMatch.v1',source_size:source.length,source_sha256:sha(source),
    prefix:source.subarray(0,opened.header.body_offset).toString('base64'),layouts};
  const rawIndex=Buffer.from(JSON.stringify(index)),packed=zip(rawIndex),head=Buffer.alloc(64);
  head.write('H1MCPOC1');head.writeUInt32LE(packed.length,8);head.writeUInt32LE(rawIndex.length,12);head.writeUInt32LE(64+packed.length+offset,16);
  Buffer.from(sha(packed),'hex').copy(head,32);
  return Buffer.concat([head,packed,...chunks]);
}

// Reads only the physical blocks needed for a virtual entry range. Cache is
// byte-bounded; reverse/random seeks do not require preceding worlds or ticks.
export async function openCompactMatch(readRange,{cacheBytes=32*1024*1024}={}) {
  assert.ok(Number.isSafeInteger(cacheBytes)&&cacheBytes>=0&&cacheBytes<=128*1024*1024);
  const head=await readRange(0,64);assert.equal(head.length,64);assert.equal(head.toString('ascii',0,8),'H1MCPOC1');
  assert.ok(head.subarray(20,32).every(v=>v===0),'invalid reserved header bytes');
  const packedSize=head.readUInt32LE(8),rawSize=head.readUInt32LE(12),size=head.readUInt32LE(16),base=64+packedSize;
  assert.ok(packedSize>0&&packedSize<=16*1024*1024&&rawSize<=32*1024*1024&&size>=base&&size<=LIMIT);
  const packed=await readRange(64,packedSize);assert.equal(sha(packed),head.subarray(32).toString('hex'));
  const index=JSON.parse(unzip(packed,rawSize));assert.equal(index.schema,'halospawns.experimentalCompactMatch.v1');
  const prefix=Buffer.from(index.prefix,'base64');assert.ok(prefix.length>=65&&prefix.length<=8*1024*1024+64);
  const sourceHeader=readMatchReplayHeader(prefix.subarray(0,64));
  assert.equal(prefix.length,sourceHeader.body_offset);assert.equal(index.source_size,sourceHeader.size_bytes);
  assert.equal(sha(prefix.subarray(64)),sourceHeader.manifest_sha256);
  const manifest=validateMatchReplay(JSON.parse(prefix.subarray(64)),sourceHeader);
  assert.ok(/^[a-f0-9]{64}$/.test(index.source_sha256)&&Array.isArray(index.layouts)&&index.layouts.length===manifest.entries.length);
  const entries=new Map(manifest.entries.map(e=>[e.id,e])),layouts=new Map(index.layouts.map(e=>[e.id,e]));
  assert.equal(layouts.size,entries.size);let end=0;
  for(const [id,e] of entries) {
    const layout=layouts.get(id);assert.ok(layout);
    if(layout.derived) {
      const d=layout.derived,source=entries.get(d.source);
      assert.ok(['network','pad','ledger','account'].includes(d.method));
      assert.ok(source&&source.id.split('/')[0]===id.split('/')[0]&&!layouts.get(d.source)?.derived,'invalid dependency');
      if(d.method==='network') {
        assert.equal(e.kind,'network-observations');assert.equal(source.kind,'network-observations');
        assert.ok(Array.isArray(d.blocks)&&d.blocks.length>0&&d.blocks.length<=432000);let at=0;
        for(const b of d.blocks){assert.equal(b.offset,at);assert.ok(Number.isSafeInteger(b.size)&&b.size>0&&b.size<=16*1024*1024&&Number.isSafeInteger(b.source_offset)&&b.source_offset>=32&&Number.isSafeInteger(b.source_size)&&b.source_size>0&&b.source_offset+b.source_size<=source.size_bytes&&Number.isSafeInteger(b.count)&&b.count>0&&b.count<=b.size/8&&[0,1,2,3].includes(b.flags));at+=b.size;}
        assert.equal(at,e.size_bytes);
      } else if(d.method==='pad') {assert.equal(source.kind,'raw-pad');assert.equal(e.kind,'raw-pad');assert.ok(['samples','events'].includes(d.field));}
      else {assert.equal(source.kind,d.method==='ledger'?'host-ledger':'client-account');assert.equal(e.kind,'diagnostic-table');assert.ok(typeof d.field==='string'&&d.field.length<32);}
    } else {
      let at=0;assert.ok(layout.blocks.length>0);
      for(const b of layout.blocks){assert.equal(b.at,at);assert.equal(b.offset,end);assert.ok(Number.isSafeInteger(b.raw)&&Number.isSafeInteger(b.size)&&b.raw>0&&b.size>0&&b.size<=b.raw&&/^[a-f0-9]{64}$/.test(b.sha256)&&['identity','zstd'].includes(b.codec));if(b.codec==='zstd')assert.ok(b.raw<=BLOCK);else assert.equal(b.raw,b.size);at+=b.raw;end+=b.size;}
      assert.equal(at,e.size_bytes);
    }
  }
  assert.equal(base+end,size);
  const cache=new Map();let used=0;
  async function cached(key,load) {
    if(cache.has(key)){const b=cache.get(key);cache.delete(key);cache.set(key,b);return b;}
    const b=await load();
    if(b.length<=cacheBytes){while(used+b.length>cacheBytes&&cache.size){const first=cache.keys().next().value;used-=cache.get(first).length;cache.delete(first);}cache.set(key,b);used+=b.length;}
    return b;
  }
  async function readEntryRange(id,at,n) {
    const e=entries.get(id),layout=layouts.get(id);assert.ok(e&&Number.isSafeInteger(at)&&at>=0&&Number.isSafeInteger(n)&&n>0&&at+n<=e.size_bytes,'invalid entry range');
    const d=layout.derived;
    if(d) {
      if(d.method==='network') {
        const parts=[];
        for(const block of d.blocks)if(block.offset<at+n&&block.offset+block.size>at) {
          const bytes=await cached(`${id}:${block.offset}`,async()=>{
            const input=await readEntryRange(d.source,block.source_offset,block.source_size);
            return expandNetwork(input,{...block,source_offset:0});
          });
          parts.push(bytes.subarray(Math.max(0,at-block.offset),Math.min(block.size,at+n-block.offset)));
        }
        const bytes=Buffer.concat(parts);assert.equal(bytes.length,n);return bytes;
      }
      const bytes=await cached(id,async()=>{
        const original=await readEntry(d.source);
        if(d.method==='pad')return readRawPad(original)[d.field];
        const account=d.method==='ledger'?readHostLedger(original,manifest.match_id):readClientAccount(original);
        return account.tables.find(t=>t.name===d.field).bytes;
      });
      return bytes.subarray(at,at+n);
    }
    const parts=[];
    for(const block of layout.blocks)if(block.at<at+n&&block.at+block.raw>at) {
      const begin=Math.max(0,at-block.at),finish=Math.min(block.raw,at+n-block.at);
      if(block.codec==='identity')parts.push(await readRange(base+block.offset+begin,finish-begin));
      else {
        const bytes=await cached(`${id}:${block.at}`,async()=>{const b=await readRange(base+block.offset,block.size);assert.equal(sha(b),block.sha256);return unzip(b,block.raw);});
        parts.push(bytes.subarray(begin,finish));
      }
    }
    const bytes=Buffer.concat(parts);assert.equal(bytes.length,n);return bytes;
  }
  async function readEntry(id) {const e=entries.get(id);assert.ok(e);const b=await readEntryRange(id,0,e.size_bytes);assert.equal(sha(b),e.sha256);return b;}
  async function readSourceRange(at,n) {
    assert.ok(Number.isSafeInteger(at)&&at>=0&&Number.isSafeInteger(n)&&n>0&&at+n<=index.source_size,'invalid source range');
    const parts=[];
    if(at<prefix.length)parts.push(prefix.subarray(at,Math.min(prefix.length,at+n)));
    for(const e of entries.values()) {
      const begin=prefix.length+e.offset,end=begin+e.size_bytes;
      if(begin<at+n&&end>at)parts.push(await readEntryRange(e.id,Math.max(0,at-begin),Math.min(end,at+n)-Math.max(begin,at)));
    }
    const bytes=Buffer.concat(parts);assert.equal(bytes.length,n);return bytes;
  }
  return {index,manifest,prefix,readEntry,readEntryRange,readSourceRange,size_bytes:size,
    get cached_bytes(){return used;},clearCache(){cache.clear();used=0;}};
}
