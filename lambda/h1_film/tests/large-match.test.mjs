import assert from 'node:assert/strict';
import test from 'node:test';
import {validateMatchReplay,readMatchReplayHeader,LARGE_MATCH_PROJECTION,BETA7_MATCH_PROJECTION} from '../runtime/match-replay.mjs';

const FILE=512*1024*1024,LOGICAL=2*1024*1024*1024,BLOCK=262144,hash='a'.repeat(64);
// Validate address-space boundaries without allocating gigabytes. Stored records
// have bounded compressed blocks; real-film packing/decoding covers their bytes.
function fixture(sizes) {
  let logical=0,physical=0;
  const entries=[40,...sizes].map((size,i)=>{
    const blocks=[];
    for(let at=0;at<size;) {
      const decoded=i?Math.min(BLOCK,size-at):size,stored=i?1:decoded;
      blocks.push({logical_offset:at,offset:physical,size_bytes:stored,decoded_size_bytes:decoded,
        codec:i?'zstd':'identity',sha256:hash});at+=decoded;physical+=stored;
    }
    const entry={id:i?`host/recorded/part-${i}`:'host/world',kind:i?'recorded-section':'world',
      compression:'identity',offset:logical,size_bytes:size,sha256:hash,storage:{kind:'stored',blocks},
      ...(!i?{index_size_bytes:33,index_sha256:hash}:{})};logical+=size;return entry;
  });
  const manifest={schema:'halospawns.h1MatchReplay.v7',sourceContract:{schema:'halospawns.viewerReplay.v1',
    profile:'frontend-default',profile_revision:12,projection_sha256:LARGE_MATCH_PROJECTION,tick_count:2},
    source_film_sha256:hash,raw_map_sha256:hash,engine_profile:'h1-performance-beta7-p9844-wasm-v1',
    wasm_sha256:hash,glue_sha256:hash,match_id:'1234567890abcdef',tick_rate:120,authoritative_track:'host',
    entries,logical_size_bytes:logical,tracks:[{id:'host',role:'host',status:'available',source_film_sha256:hash,
      frame_count:2,first_update:0,viewer_revision:5,world:'host/world',
      verification:{seed_mismatches:0,hash_mismatches:0,hash_checks:1,played_ticks:2}}]};
  return {manifest,header:{version:7,body_offset:64,size_bytes:64+physical}};
}

test('v7 separates its logical address space from compact physical storage',()=>{
  const {manifest,header}=fixture([FILE,FILE,FILE,FILE-40]);
  assert.equal(manifest.logical_size_bytes,LOGICAL);assert.ok(header.size_bytes<10000);
  assert.equal(validateMatchReplay(manifest,header),manifest);
  const old=structuredClone(manifest);old.schema='halospawns.h1MatchReplay.v6';
  old.sourceContract.profile_revision=11;old.sourceContract.projection_sha256=BETA7_MATCH_PROJECTION;
  assert.throws(()=>validateMatchReplay(old,{...header,version:6}),/overflow/);
  assert.throws(()=>validateMatchReplay(manifest,{...header,version:6}),/source/);
});

test('v7 retains aggregate, individual-entry, physical and compressed-block bounds',()=>{
  const tooLarge=fixture([FILE,FILE,FILE,FILE-39]);
  assert.throws(()=>validateMatchReplay(tooLarge.manifest,tooLarge.header),/overflow/);
  const single=fixture([FILE+1]);
  assert.throws(()=>validateMatchReplay(single.manifest,single.header),/entry bounds/);
  const good=fixture([FILE]);
  for(const mutate of [
    m=>m.logical_size_bytes++,
    m=>m.entries[1].storage.blocks[0].decoded_size_bytes=BLOCK+1,
    m=>m.entries[1].storage.blocks[0].offset++,
    m=>m.entries[1].storage.blocks[0].size_bytes=FILE+1,
    m=>m.sourceContract.projection_sha256=BETA7_MATCH_PROJECTION,
  ]) {const bad=structuredClone(good.manifest);mutate(bad);assert.throws(()=>validateMatchReplay(bad,good.header));}
  const raw=Buffer.alloc(64);raw.write('H1MV0007');raw.writeUInt32LE(7,8);raw.writeUInt32LE(64,12);
  raw.writeUInt32LE(1,16);raw.writeUInt32LE(FILE+1,20);
  assert.throws(()=>readMatchReplayHeader(raw),/bounds/);
});
