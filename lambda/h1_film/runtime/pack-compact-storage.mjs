import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {zstdCompressSync,constants} from 'node:zlib';
import {readClientAccount,readHostLedger} from './format3-diagnostics.mjs';
import {readRawPad} from './format3-pad.mjs';
import {unpackMszip} from './adapters/beta5-v2-120.mjs';
import {unpackNetworkColumns} from './format3-codec.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

export async function packCompactStorage(index,tracks,entries,scratch,matchId) {
  const pins=new Map(index.map(e=>[e.id,e])),sources=new Map(entries.map(e=>[e.id,e]));
  const get=async id=>{const e=sources.get(id);assert.ok(e);const b=e.bytes??await readFile(e.path);assert.equal(b.length,pins.get(id).size_bytes);assert.equal(sha(b),pins.get(id).sha256);return b;};
  const derive=(id,storage,bytes)=>{const e=pins.get(id);assert.ok(e);assert.equal(bytes.length,e.size_bytes);assert.equal(sha(bytes),e.sha256,'derived entry differs');e.storage=storage;};
  for(const t of tracks) {
    if(t.network) {
      const source=t.recorded_sections.network,bytes=await get(source),blocks=[],hash=createHash('sha256');let at=32,offset=0;
      for(let i=0;i<bytes.readUInt32LE(24);i++) {
        const [size,packed,first,last,count,flags]=Array.from({length:6},(_,j)=>bytes.readUInt32LE(at+j*4));at+=24;
        assert.ok(size>0&&size<=16777216&&packed>0&&at+packed<=bytes.length&&flags<=3);
        const original=bytes.subarray(at,at+packed),expanded=flags&1?unpackMszip(original,size):original;
        const raw=flags&2?unpackNetworkColumns(expanded,count):expanded,expected=t.network.blocks[i];
        assert.equal(raw.length,size);assert.equal(sha(raw),expected.sha256);assert.equal(expected.offset,offset);assert.equal(expected.count,count);hash.update(raw);
        assert.equal(expected.first_tick,first);assert.equal(expected.last_tick,last);
        blocks.push({offset,size_bytes:size,source_offset:at,source_size_bytes:packed,count,flags,sha256:expected.sha256});at+=packed;offset+=size;
      }
      assert.equal(at,bytes.length);assert.equal(offset,pins.get(t.network.entry).size_bytes);
      assert.equal(hash.digest('hex'),pins.get(t.network.entry).sha256);
      pins.get(t.network.entry).storage={kind:'network',source,blocks};
    }
    if(t.pad){const p=readRawPad(await get(t.pad.original));for(const field of ['events','samples'])if(t.pad[field])derive(t.pad[field],{kind:'pad',source:t.pad.original,field},p[field]);}
    const accounts=new Map();
    for(const table of t.tables??[])if(table.count) {
      const kind=table.kind==='ledger'?'ledger':'account',source=kind==='ledger'?t.recorded_sections.ledger:t.alignment?.account_entry??t.account?.original;
      if(!accounts.has(source))accounts.set(source,kind==='ledger'?readHostLedger(await get(source),matchId):readClientAccount(await get(source)));
      derive(table.entry,{kind,source,field:table.name},accounts.get(source).tables.find(v=>v.name===table.name).bytes);
    }
  }
  const physical=[];let offset=0;
  for(const e of index) {
    if(e.storage)continue;const source=sources.get(e.id),blocks=[];
    if(e.kind==='world') {
      blocks.push({logical_offset:0,offset,size_bytes:e.size_bytes,decoded_size_bytes:e.size_bytes,codec:'identity',sha256:e.sha256});
      physical.push({...source,size_bytes:e.size_bytes,sha256:e.sha256});offset+=e.size_bytes;
    } else {
      const bytes=await get(e.id);
      for(let at=0;at<bytes.length;at+=262144) {
        const raw=bytes.subarray(at,at+262144),packed=zstdCompressSync(raw,{params:{[constants.ZSTD_c_compressionLevel]:6,[constants.ZSTD_c_checksumFlag]:1}}),use=packed.length<raw.length,payload=use?packed:raw;
        const path=join(scratch,`${physical.length}.bin`),pin=sha(payload);await writeFile(path,payload,{flag:'wx'});
        blocks.push({logical_offset:at,offset,size_bytes:payload.length,decoded_size_bytes:raw.length,codec:use?'zstd':'identity',sha256:pin});
        physical.push({path,size_bytes:payload.length,sha256:pin});offset+=payload.length;
      }
    }
    e.storage={kind:'stored',blocks};
  }
  return {physical,size:offset};
}
