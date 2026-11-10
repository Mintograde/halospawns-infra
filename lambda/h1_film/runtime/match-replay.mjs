// Browser-safe range reader for the single-file H1 match replay container.
// Each world retains the proven viewer-5 codec and its own clock and roster.
import {validateCompactStorage,compactRangeReader} from './compact-storage.mjs';
export const BETA7_MATCH_REPLAY_SCHEMA='halospawns.h1MatchReplay.v6';
export const BETA7_MATCH_PROJECTION='e04e97f3b3c129672bf41800eece0a69bd3c7372e1da26e87b16f7caddeddfbb';
export const UNSUPPORTED_MATCH_REPLAY_SCHEMA='halospawns.h1MatchReplay.v5';
export const UNSUPPORTED_MATCH_PROJECTION='bdae0bedb45694b5de75d9c6d37860526ef21926e09cbbb774afd0fad6e56f66';
export const COMPACT_MATCH_REPLAY_SCHEMA='halospawns.h1MatchReplay.v3';
export const ROSTER_MATCH_REPLAY_SCHEMA='halospawns.h1MatchReplay.v4';
export const ROSTER_MATCH_PROJECTION='648590bc0387f23240a6f1f8fb35653729a35d956a26f6fe27722200183c023f';
export const COMPACT_MATCH_PROJECTION='5501eb4b77cfca3aa76863bf33ff9819715ca22a07da6b7e5df51006a26783ef';
export const MATCH_REPLAY_SCHEMA='halospawns.h1MatchReplay.v1';
export const MATCH_REPLAY_MAGIC='H1MV0001';
export const PARTIAL_MATCH_REPLAY_SCHEMA='halospawns.h1MatchReplay.v2';
export const PARTIAL_MATCH_PROJECTION='e19c41417dd3c4e6843037a94fb8d993e4861bfd6d345a9965f82b4ed8effdbb';
export const MATCH_REPLAY_HEADER_BYTES=64;
export const MATCH_REPLAY_MAX_BYTES=512*1024*1024;
export const MATCH_REPLAY_MAX_MANIFEST=8*1024*1024;
const hash=/^[a-f0-9]{64}$/;
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const check=(ok,message)=>{if(!ok)throw new Error(`H1 match replay: ${message}`);};
const tableStrides={client:{shots:88,clock:8,poses:264,hits:44,host_verdicts:88,aim:28,seen:28,net:44,corrections:44,pulls:48,screen:20,inputs:16,blasts:28},
  ledger:{damage:28,deaths:88,verdicts:88,clock:12,inputs:16}};
export async function hashBytes(bytes) {
  const digest=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  return [...digest].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function readMatchReplayHeader(bytes) {
  check(bytes.length===64,'invalid header size');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const version=v.getUint32(8,true);
  check([1,2,3,4,5,6].includes(version)&&new TextDecoder().decode(bytes.subarray(0,8))===`H1MV000${version}`
    &&v.getUint32(12,true)===64&&v.getUint32(24,true)===0&&v.getUint32(28,true)===0,'unsupported header');
  const manifest_bytes=v.getUint32(16,true),size_bytes=v.getUint32(20,true);
  check(integer(manifest_bytes,1,MATCH_REPLAY_MAX_MANIFEST)&&integer(size_bytes,64+manifest_bytes,MATCH_REPLAY_MAX_BYTES),'invalid bounds');
  return {version,manifest_bytes,size_bytes,body_offset:64+manifest_bytes,
    manifest_sha256:[...bytes.subarray(32,64)].map(b=>b.toString(16).padStart(2,'0')).join('')};
}
export function validateMatchReplay(m,header) {
  const beta7=m?.schema===BETA7_MATCH_REPLAY_SCHEMA,unsupported=beta7||m?.schema===UNSUPPORTED_MATCH_REPLAY_SCHEMA,roster=unsupported||m?.schema===ROSTER_MATCH_REPLAY_SCHEMA;
  const compact=roster||m?.schema===COMPACT_MATCH_REPLAY_SCHEMA,partial=compact||m?.schema===PARTIAL_MATCH_REPLAY_SCHEMA;
  check((partial||m?.schema===MATCH_REPLAY_SCHEMA)&&header.version===(beta7?6:unsupported?5:roster?4:compact?3:partial?2:1)
    &&hash.test(m.source_film_sha256)&&hash.test(m.raw_map_sha256),'invalid source');
  check(m.engine_profile===(beta7?'h1-performance-beta7-p9844-wasm-v1':'h1-performance-beta6-p9839-wasm-v1')&&hash.test(m.wasm_sha256)&&hash.test(m.glue_sha256),'invalid engine');
  check(/^[a-f0-9]{16}$/.test(m.match_id)&&m.match_id!=='0000000000000000'&&m.tick_rate===120&&m.authoritative_track==='host','invalid match');
  check(m.sourceContract?.schema==='halospawns.viewerReplay.v1'&&m.sourceContract.profile==='frontend-default'
    &&m.sourceContract.profile_revision===(beta7?11:unsupported?10:roster?9:compact?8:partial?7:6)&&m.sourceContract.projection_sha256===(beta7?BETA7_MATCH_PROJECTION:unsupported?UNSUPPORTED_MATCH_PROJECTION:roster?ROSTER_MATCH_PROJECTION:compact?COMPACT_MATCH_PROJECTION:partial?PARTIAL_MATCH_PROJECTION:'17891e012b67f5b7e998cf1cc724a1728d18b3df5556559e90fc4ee47c0dc2c2'),
    'invalid source contract');
  check(Array.isArray(m.entries)&&m.entries.length>0&&m.entries.length<=512,'invalid entries');
  const entries=new Map();let end=0;
  for(const e of m.entries) {
    check(compact||e?.storage===undefined,'storage requires revision 8');
    check(e&&typeof e.id==='string'&&/^[a-z0-9][a-z0-9/_-]{0,120}$/.test(e.id)&&!entries.has(e.id),'duplicate or invalid entry');
    check(e.offset===end&&integer(e.size_bytes,1,MATCH_REPLAY_MAX_BYTES)&&hash.test(e.sha256),'invalid entry bounds');
    check(['world','client-account','host-ledger','raw-pad','network-observations','diagnostic-table','recorded-section'].includes(e.kind)
      &&e.compression==='identity','invalid entry kind');
    if(e.kind==='world') check(hash.test(e.index_sha256)&&integer(e.index_size_bytes,33,Math.min(e.size_bytes,16777216)),'invalid world index');
    end+=e.size_bytes;check(end<=MATCH_REPLAY_MAX_BYTES,'entry overflow');entries.set(e.id,e);
  }
  if(!compact)check(m.logical_size_bytes===undefined&&end+header.body_offset===header.size_bytes,'container coverage differs');
  check(Array.isArray(m.tracks)&&m.tracks.length>=1&&m.tracks.length<=17,'invalid track count');
  const ids=new Set();
  const worlds=new Set();
  for(const [i,t] of m.tracks.entries()) {
    check(t&&t.id===(i===0?'host':`client-${i-1}`)&&!ids.has(t.id)&&t.role===(i===0?'host':'client'),'invalid track identity');ids.add(t.id);
    check(hash.test(t.source_film_sha256)&&integer(t.frame_count,1,432000)&&integer(t.first_update,0,2147051647),'invalid track coverage');
    if(partial)check(['available','unavailable'].includes(t.status),'invalid view status');
    else check(t.status===undefined&&t.failure===undefined,'unavailable views require revision 7');
    if(t.status==='unavailable') {
      check(i>0&&t.world===undefined&&t.viewer_revision===undefined&&t.verification===undefined,'unavailable world is playable');
      const f=t.failure;
      if(unsupported&&f?.reason==='unsupported_build') {
        check(typeof f.recorded_build==='string'&&/^[\x20-\x7e]{1,63}$/.test(f.recorded_build)
          &&f.format===3&&f.protocol_revision===(m.engine_profile==='h1-performance-beta7-p9844-wasm-v1'?9844:9839)&&f.tick_rate===120
          &&Object.keys(f).sort().join(',')==='format,protocol_revision,reason,recorded_build,tick_rate',
          'invalid unsupported build evidence');
      } else if(roster&&f?.reason==='roster_mismatch') {
        check(f.played_ticks===t.frame_count&&f.seed_mismatches===0&&f.hash_mismatches===0&&f.network_refused===0
          &&integer(f.hash_checks,1,40000)&&integer(f.control_pushes,1,6912000)&&integer(f.network_applied,0,2147483647)
          &&integer(f.recorded_player_count,1,16)&&Array.isArray(f.exported_player_indices)
          &&integer(f.exported_player_indices.length,1,16)&&f.exported_player_indices.length!==f.recorded_player_count
          &&f.exported_player_indices.every(id=>integer(id,0,15))&&new Set(f.exported_player_indices).size===f.exported_player_indices.length
          &&Object.keys(f).sort().join(',')==='control_pushes,exported_player_indices,hash_checks,hash_mismatches,network_applied,network_refused,played_ticks,reason,recorded_player_count,seed_mismatches',
          'invalid roster mismatch evidence');
      } else {
      check(f?.reason==='simulation_desync'&&f.played_ticks===t.frame_count
        &&integer(f.seed_mismatches,0,t.frame_count)&&integer(f.hash_checks,1,40000)
        &&integer(f.hash_mismatches,0,f.hash_checks)&&(f.seed_mismatches>0||f.hash_mismatches>0)
        &&integer(f.control_pushes,1,6912000)&&integer(f.first_mismatch_update,t.first_update,t.first_update+t.frame_count-1)
        &&integer(f.network_applied,0,2147483647)&&integer(f.network_refused,0,2147483647),'invalid desync evidence');
      }
    } else {
    check(t.failure===undefined,'verified world contains failure evidence');
    const world=entries.get(t.world);
    check(world?.kind==='world'&&world.compression==='identity'&&t.viewer_revision===5,'invalid world');
    check(world.id===`${t.id}/world`&&!worlds.has(world.id),'duplicate world');worlds.add(world.id);
    check(t.verification?.seed_mismatches===0&&t.verification.hash_mismatches===0
      &&t.verification.played_ticks===t.frame_count&&integer(t.verification.hash_checks,1,40000),'unverified world');
    }
    const ref=(id,kind)=>{const e=entries.get(id);check(e&&e.id.startsWith(t.id+'/')&&e.kind===kind,'invalid table entry');return e;};
    check(!t.tables||Array.isArray(t.tables)&&t.tables.length<=18,'invalid tables');
    const tables=new Set();
    for(const table of t.tables??[]) {
      const key=`${table.kind}/${table.name}`;
      check(tableStrides[table.kind]?.[table.name]===table.stride&&!tables.has(key)
        &&integer(table.count,0,1048576)&&typeof table.capped==='boolean','invalid table');tables.add(key);
      if(!table.count){check(!table.entry&&!table.chunks,'invalid empty table');continue;}
      const e=ref(table.entry,'diagnostic-table');
      check(e.size_bytes===table.count*table.stride&&Array.isArray(table.chunks)
        &&table.chunks.length===Math.ceil(table.count/2048),'invalid table size');
      let first=0;
      for(const c of table.chunks) {
        check(c.first_row===first&&c.row_count===Math.min(2048,table.count-first)&&c.offset===first*table.stride
          &&c.size_bytes===c.row_count*table.stride&&hash.test(c.sha256),'invalid table chunk');first+=c.row_count;
      }
    }
    for(const [name,id] of Object.entries(t.recorded_sections??{})) {
      check(['gametype','input_script','events','roster','ledger','network'].includes(name),'unknown recorded section');
      ref(id,name==='ledger'?'host-ledger':name==='network'?'network-observations':'recorded-section');
    }
    if(t.network) {
      const e=ref(t.network.entry,'network-observations');let end=0;
      check(t.network.format==='h1arena.fnet-records.v2'&&Array.isArray(t.network.blocks)&&t.network.blocks.length<=432000,'invalid network index');
      for(const b of t.network.blocks) {check(b.offset===end&&integer(b.size_bytes,1,16777216)&&integer(b.count,1,b.size_bytes/8)
        &&integer(b.first_tick,0,2147483647)&&integer(b.last_tick,b.first_tick,2147483647)&&hash.test(b.sha256),'invalid network block');end+=b.size_bytes;}
      check(end===e.size_bytes,'invalid network coverage');
    }
    if(t.pad) {
      const p=t.pad;ref(p.original,'raw-pad');
      check(integer(p.seats,1,4)&&p.stride===14&&integer(p.count,0,432000)&&integer(p.event_count,0,65536)&&p.event_size===16,'invalid pad');
      if(p.count)check(ref(p.samples,'raw-pad').size_bytes===p.count*p.seats*14,'invalid pad samples');
      if(p.event_count)check(ref(p.events,'raw-pad').size_bytes===p.event_count*16,'invalid pad events');
    }
    if(i===0) continue;
    check(integer(t.recorded_own_player,0,15)&&typeof t.ends_early==='boolean','invalid client coverage');
    check([0,1,2].includes(t.recorded_trust?.inputs)&&[0,1,2].includes(t.recorded_trust?.messages),'invalid recorded trust');
    check(Array.isArray(t.clocks)&&t.clocks.length>0&&t.clocks.length<=432000,'missing client clock');
    let previous=-1;
    for(const c of t.clocks) {
      check(integer(c.frame,0,t.frame_count-1)&&c.frame>previous&&integer(c.game_tick,0,2147051647),'invalid client clock');previous=c.frame;
    }
    check(t.clocks[0].frame===0,'missing initial client clock');
    if(t.alignment?.method==='unavailable') {check(t.alignment.reason==='client_account_not_recorded','invalid missing alignment');continue;}
    check(t.alignment?.method==='recorded-client-clock-v1'&&Array.isArray(t.alignment.rows)&&t.alignment.rows.length<=65536,'invalid alignment');
    check(entries.get(t.alignment.account_entry)?.kind==='client-account','unbound alignment account');
    for(const r of t.alignment.rows) check(Array.isArray(r)&&r.length===2&&r.every(n=>integer(n,-2147483648,2147483647)),'invalid clock sample');
  }
  check(m.sourceContract.tick_count===m.tracks[0].frame_count,'host tick count differs');
  check([...entries.values()].filter(e=>e.kind==='world').length===worlds.size,'unbound world');
  if(compact)validateCompactStorage(m,header);
  return m;
}

export async function openMatchReplay(readRange,expected={},codecs={}) {
  const h=readMatchReplayHeader(await readRange(0,64));
  for(const key of ['size_bytes','manifest_sha256']) if(expected[key]!==undefined) check(h[key]===expected[key],`descriptor ${key} differs`);
  const raw=await readRange(64,h.manifest_bytes);
  check(raw.length===h.manifest_bytes&&await hashBytes(raw)===h.manifest_sha256,'manifest hash differs');
  const manifest=validateMatchReplay(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),h);
  for(const key of ['source_film_sha256','raw_map_sha256','engine_profile']) if(expected[key]!==undefined) check(manifest[key]===expected[key],`source ${key} differs`);
  function entry(id) {const e=manifest.entries.find(e=>e.id===id);check(e,'unknown entry');return e;}
  const compact=h.version>=3?compactRangeReader(readRange,h,manifest,codecs,hashBytes):null;
  async function range(e,start,length) {
    check(integer(start,0,e.size_bytes)&&integer(length,1,e.size_bytes-start),'range outside entry');
    if(compact)return compact.range(e.id,start,length);
    const bytes=await readRange(h.body_offset+e.offset+start,length);check(bytes.length===length,'short entry read');return bytes;
  }
  return {manifest,header:h,
    clearCache(){compact?.clear();},
    get cachedBytes(){return compact?.cachedBytes??0;},
    rangeReader(id) {
      const e=entry(id);check(e.compression==='identity','entry is compressed');
      return (start,length)=>range(e,start,length);
    },
    async readEntry(id) {
      const e=entry(id),bytes=await range(e,0,e.size_bytes);
      check(bytes.length===e.size_bytes&&await hashBytes(bytes)===e.sha256,'entry hash differs');return bytes;
    }};
}
