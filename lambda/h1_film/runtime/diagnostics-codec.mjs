// Browser-safe reader for halospawns.h1ClientDiagnostics.v1. World coordinates are
// Halo world units. All clocks and physical player slots remain in their source domain.
export const DIAGNOSTICS_SCHEMA = 'halospawns.h1ClientDiagnostics.v1';
export const DIAGNOSTICS_MEDIA_TYPE = 'application/vnd.halospawns.h1-diagnostics';
export const HEADER_BYTES = 32;
export const MAX_BYTES = 128 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
export const CHUNK_ROWS = 2048;
export const TABLES = {
  client: [['shots',88],['clock',8],['poses',264],['hits',44],['host_verdicts',88],
    ['aim',28],['seen',28],['net',44],['corrections',44],['pulls',48],['screen',20],['inputs',16],['blasts',28]],
  ledger: [['damage',28],['deaths',88],['verdicts',88],['clock',12],['inputs',16]],
};
export const REFUSALS = ['taken','player','target','numbers','age','not-dealt','shape','scale','origin','unpaid',
  'melee','collision','range','seen','moved','data','pose','head','sight','past-cap','view','blast-wall','melee-wall'];
export const INPUT_KINDS = ['repeat','merged','lost','silent','stale'];
export const BLAST_ENDS = ['structure','object','fuse','attached','air','deleted'];
const hash = /^[a-f0-9]{64}$/;
export function requireDiagnostic(ok, message) {
  if (!ok) throw new Error(`H1 diagnostics: ${message}`);
}
function view(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function integer(n, min, max) { return Number.isSafeInteger(n) && n >= min && n <= max; }
export function readDiagnosticsHeader(bytes) {
  requireDiagnostic(bytes.length === HEADER_BYTES, 'invalid header size');
  const d = view(bytes);
  requireDiagnostic(new TextDecoder().decode(bytes.subarray(0,8)) === 'H1DG0001'
    && d.getUint32(8,true) === 1 && d.getUint32(12,true) === HEADER_BYTES
    && d.getUint32(24,true) === 0 && d.getUint32(28,true) === 0, 'unsupported header');
  const manifest_bytes = d.getUint32(16,true), size_bytes = d.getUint32(20,true);
  requireDiagnostic(integer(manifest_bytes, 1, MAX_MANIFEST_BYTES)
    && integer(size_bytes, HEADER_BYTES + manifest_bytes, MAX_BYTES), 'invalid container bounds');
  return {manifest_bytes, size_bytes, body_offset: HEADER_BYTES + manifest_bytes};
}
export function validateDiagnosticsManifest(m, header, expected = {}) {
  requireDiagnostic(m?.schema === DIAGNOSTICS_SCHEMA && m.source?.source_tick_rate === 120
    && hash.test(m.source.film_sha256) && hash.test(m.source.raw_map_sha256)
    && typeof m.source.engine_profile === 'string'
    && integer(m.source.source_tick_count,1,432000) && /^[a-f0-9]{16}$/.test(m.match_id)
    && ['host','client-enriched-host'].includes(m.recording_kind)
    && Array.isArray(m.sections) && m.sections.length <= 2, 'invalid manifest identity');
  for (const [key,value] of Object.entries(expected)) requireDiagnostic(m.source[key] === value, `source mismatch: ${key}`);
  let end = 0;
  const names = new Set();
  for (const s of m.sections) {
    const spec = TABLES[s.kind];
    requireDiagnostic(spec && !names.has(s.kind) && s.version === (s.kind === 'client' ? 11 : 5)
      && s.offset === end && s.header_bytes === (s.kind === 'client' ? 152 : 88)
      && integer(s.size_bytes,s.header_bytes,MAX_BYTES) && hash.test(s.sha256)
      && integer(s.flags,0,0xffffffff) && integer(s.clock_period,1,432000)
      && Array.isArray(s.tables) && s.tables.length === spec.length, 'invalid section');
    names.add(s.kind);
    let offset = s.offset + s.header_bytes;
    for (let i=0;i<spec.length;i++) {
      const t = s.tables[i], [name,stride] = spec[i];
      requireDiagnostic(t.name === name && t.stride === stride && t.offset === offset
        && integer(t.count,0,MAX_BYTES/stride) && t.capped === Boolean(s.flags & (1<<i))
        && Array.isArray(t.chunks) && t.chunks.length === Math.ceil(t.count/CHUNK_ROWS), 'invalid table');
      let row = 0;
      for (const c of t.chunks) {
        requireDiagnostic(c.first_row === row && c.row_count === Math.min(CHUNK_ROWS,t.count-row)
          && c.offset === offset + row*stride && c.size_bytes === c.row_count*stride
          && hash.test(c.sha256) && c.clocks && typeof c.clocks === 'object', 'invalid chunk');
        for (const [clock,range] of Object.entries(c.clocks)) {
          requireDiagnostic(['client_tick','host_tick','view_host_tick','claimed_host_tick','tested_host_tick','sent_client_tick'].includes(clock)
            && Array.isArray(range) && range.length === 2 && integer(range[0],0,0xffffffff)
            && integer(range[1],range[0],0xffffffff), 'invalid clock index');
        }
        row += c.row_count;
      }
      offset += t.count*stride;
    }
    requireDiagnostic(offset === s.offset+s.size_bytes, 'section coverage mismatch');
    end = offset;
  }
  requireDiagnostic(end + header.body_offset === header.size_bytes, 'container coverage mismatch');
  return m;
}
export async function sha256Bytes(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
}
// readRange(start, length) must return precisely those bytes. No full-file fetch or
// retained decoded-tick cache is required; the caller owns a bounded chunk cache.
export async function openDiagnostics(readRange, descriptor, expected = {}) {
  requireDiagnostic(descriptor?.schema === DIAGNOSTICS_SCHEMA && descriptor.compression === 'identity'
    && descriptor.content_type === DIAGNOSTICS_MEDIA_TYPE && hash.test(descriptor.sha256)
    && hash.test(descriptor.manifest_sha256), 'unsupported descriptor');
  const h = readDiagnosticsHeader(await readRange(0,HEADER_BYTES));
  requireDiagnostic(h.size_bytes === descriptor.size_bytes, 'artifact size mismatch');
  const raw = await readRange(HEADER_BYTES,h.manifest_bytes);
  requireDiagnostic(raw.length === h.manifest_bytes && await sha256Bytes(raw) === descriptor.manifest_sha256, 'manifest digest mismatch');
  const manifest = validateDiagnosticsManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),h,{
    film_sha256:descriptor.source_replay_sha256,raw_map_sha256:descriptor.raw_map_sha256,
    engine_profile:descriptor.engine_profile,source_tick_count:descriptor.source_tick_count,
  });
  for(const [key,value] of Object.entries(expected)) requireDiagnostic(manifest.source[key]===value,`source mismatch: ${key}`);
  return {
    manifest,
    chunks(kind, table, clock, first, last) {
      const t = manifest.sections.find(s=>s.kind===kind)?.tables.find(t=>t.name===table);
      return (t?.chunks ?? []).map((c,index)=>({...c,index}))
        .filter(c => !clock || (c.clocks[clock] && c.clocks[clock][0] <= last && c.clocks[clock][1] >= first));
    },
    async readChunk(kind, table, chunkIndex) {
      const t = manifest.sections.find(s=>s.kind===kind)?.tables.find(t=>t.name===table), c=t?.chunks[chunkIndex];
      requireDiagnostic(c, 'unknown chunk');
      const bytes = await readRange(h.body_offset+c.offset,c.size_bytes);
      requireDiagnostic(bytes.length === c.size_bytes && await sha256Bytes(bytes) === c.sha256,'chunk digest mismatch');
      return Array.from({length:c.row_count},(_,i)=>decodeDiagnosticRow(kind,table,
        bytes.subarray(i*t.stride,(i+1)*t.stride),c.first_row+i));
    },
  };
}

export async function openDiagnosticsUrl(descriptor,{expectedSource={},signal,fetchImpl=globalThis.fetch}={}) {
  requireDiagnostic(typeof descriptor?.url==='string' && /^https?:\/\//.test(descriptor.url),'invalid delivery URL');
  return openDiagnostics(async(start,length)=>{
    signal?.throwIfAborted();
    requireDiagnostic(integer(start,0,descriptor.size_bytes-1) && integer(length,1,MAX_MANIFEST_BYTES)
      && start+length<=descriptor.size_bytes,'invalid range request');
    const response=await fetchImpl(descriptor.url,{headers:{Range:`bytes=${start}-${start+length-1}`},signal,credentials:'omit'});
    const range=response.headers.get('content-range');
    if(response.status!==206 || range!==`bytes ${start}-${start+length-1}/${descriptor.size_bytes}`) {
      await response.body?.cancel(); throw new Error('H1 diagnostics: server did not honor the bounded range');
    }
    const reader=response.body?.getReader();
    requireDiagnostic(reader,'missing range body');
    const bytes=new Uint8Array(length);let offset=0;
    try {
      while(true) {
        signal?.throwIfAborted();
        const {done,value}=await reader.read();if(done)break;
        requireDiagnostic(value.length<=length-offset,'oversized range body');
        bytes.set(value,offset);offset+=value.length;
      }
      signal?.throwIfAborted();requireDiagnostic(offset===length,'truncated range body');
      return bytes;
    } finally { await reader.cancel(); reader.releaseLock(); }
  },descriptor,expectedSource);
}

export function decodeDiagnosticRow(kind, table, bytes, index) {
  const spec = TABLES[kind]?.find(([name])=>name===table);
  requireDiagnostic(spec && bytes.length === spec[1] && integer(index,0,0x7fffffff), 'invalid row');
  const d=view(bytes), u8=o=>d.getUint8(o), i8=o=>d.getInt8(o), u16=o=>d.getUint16(o,true),
    i16=o=>d.getInt16(o,true), u32=o=>d.getUint32(o,true), i32=o=>d.getInt32(o,true),
    f=o=>{const n=d.getFloat32(o,true); return Number.isFinite(n)?n:null;}, vec=o=>[f(o),f(o+4),f(o+8)];
  const r={index};
  if (table==='verdicts'||table==='host_verdicts') return {...r,host_tick:u32(0),verdict:u8(4),machine_slot:u8(5),owner:u8(6),flags:u8(7),
    object:i32(8),claimed_host_tick:i32(12),sent_client_tick:i32(16),report_index:u32(20),gap:f(24),sequence:u16(28),epoch:u16(30),
    tested_host_tick:i32(32),impact:vec(36),direction:vec(48),target:vec(60),center:vec(72),steps:u8(84),shot_flags:u8(85)};
  if (table==='inputs') return {...r,host_tick:i32(0),span:u16(4),count:u16(6),kind:u8(8),machine_slot:u8(9),player:u8(10),late:u8(11),max_events:u16(12)};
  if (kind==='ledger') {
    if (table==='clock') return {...r,host_tick:u32(0),machine_slot:u8(4),client_tick:i32(8)};
    if (table==='damage') return {...r,host_tick:u32(0),flags:u8(4),victim:u8(5),attacker:u8(6),unit:i32(8),object:i32(12),damage_tag:u32(16),shield:f(20),body:f(24)};
    return {...r,host_tick:u32(0),flags:u8(4),victim:u8(5),owner:u8(6),credited:u8(7),winner:i8(8),killer_own:i8(9),team:i16(10),object:i32(12),window:i32(16),before:u32(20),
      history:Array.from({length:4},(_,i)=>({host_tick:i32(24+16*i),damage:f(28+16*i),object:i32(32+16*i),player:i32(36+16*i)}))};
  }
  if (table==='clock') return {...r,client_tick:i32(0),host_tick:i32(4)};
  if (table==='shots') return {...r,client_tick:i32(0),sent_client_tick:i32(4),report_index:u16(8),owner:u8(10),flags:u8(11),object:i32(12),damage_tag:u32(16),claimed_host_tick:i32(20),
    origin:vec(24),direction:vec(36),target:vec(48),epicenter:vec(60),node:i16(72),region:i16(74),material:i16(76),sequence:u16(78),epoch:u16(80),pull_low16:u16(82),pose_index:i32(84)};
  if (table==='poses') {
    const count=u8(4), base=vec(8);
    requireDiagnostic(count<=20 && (u8(5)===255 || u8(5)<count),'invalid pose nodes');
    return {...r,object_tag:u32(0),node_count:count,head_node:u8(5),flags:u8(6),base,scale:f(20),
      nodes:Array.from({length:count},(_,i)=>{
        const at=24+12*i, packed=[u16(at+6),u16(at+8),u16(at+10)];
        let bits=BigInt(packed[0])|(BigInt(packed[1])<<16n)|(BigInt(packed[2])<<32n);
        const largest=Number((bits>>45n)&3n), rotation=[],position=[0,1,2].map(a=>base[a]===null?null:Math.fround(base[a]+i16(at+2*a)/8192));
        let sum=0;
        for(let a=0;a<4;a++) if(a!==largest) { const v=(Number(bits&32767n)-16383)/16383*Math.SQRT1_2; rotation[a]=v;sum+=v*v;bits>>=15n; }
        rotation[largest]=Math.sqrt(Math.max(0,1-sum));
        return {position,rotation,packed_rotation:packed};
      })};
  }
  if (table==='hits') return {...r,client_tick:i32(0),host_tick:i32(4),victim:u8(8),attacker:u8(9),flags:u8(10),damage_tag:u32(12),shield_damage:f(16),body_damage:f(20),shield_vitality:f(24),body_vitality:f(28),position:vec(32)};
  if (table==='aim') return {...r,client_tick:i32(0),view_host_tick:i32(4),eye:vec(8),yaw:i16(20)/10400,pitch:i16(22)/10400,fov:u16(24)/10400,seat:u8(26),flags:u8(27)};
  if (table==='seen') return {...r,client_tick:i32(0),view_host_tick:i32(4),center:vec(8),yaw:i16(20)/10400,player:u8(22),flags:u8(23),unit_low16:u16(24),height:u8(26)/200,radius:u8(27)/200};
  if (table==='net') return {...r,client_tick:i32(0),client_end_tick:i32(4),host_tick:i32(8),host_end_tick:i32(12),clock_step_ticks:i32(16),rtt_count:u16(20),rtt_min_ms:u16(22),rtt_mean_ms:u16(24),rtt_max_ms:u16(26),board_ping_ms:i16(28),jitter_ms:u16(30),received:u16(32),lost:u16(34),late:u16(36),catchup:u16(38),out_loss_percent:u8(40),extra_slew:u8(41),held_slew:u8(42),flags:u8(43)};
  if (table==='corrections') return {...r,client_tick:i32(0),host_tick:i32(4),stamp_tick:i32(8),predicted:vec(12),host_position:vec(24),moved:f(36),unit_low16:u16(40),kind:u8(42),seat:u8(43)};
  if (table==='pulls') return {...r,client_tick:i32(0),view_host_tick:i32(4),weapon_tag:u32(8),projectile_tag:u32(12),origin:vec(16),direction:vec(28),trigger:u8(40),pellet:u8(41),owner:u8(42),seat:u8(43),report_count:u8(44),flags:u8(45)};
  if (table==='screen') return {...r,client_tick:i32(0),view_host_tick:i32(4),host_tick:i32(8),message:i16(12),kind:u8(14),flags:u8(15),subject:u8(16),other:u8(17),seat:u8(18)};
  return {...r,client_tick:i32(0),view_host_tick:i32(4),point:vec(8),pull_low16:u16(20),object_low16:u16(22),end:u8(24),flags:u8(25),area_reports:u8(26)};
}

export function diagnosticClockRanges(rows) {
  const result={};
  for(const r of rows) for(const key of ['client_tick','host_tick','view_host_tick','claimed_host_tick','tested_host_tick','sent_client_tick']) {
    const value=r[key];
    if(!Number.isInteger(value)||value<0) continue;
    const endpoints=key==='host_tick' ? [value,r.host_end_tick??value, r.span ? value+r.span-1 : value]
      : key==='client_tick' ? [value,r.client_end_tick??value] : [value];
    const known=endpoints.filter(n=>Number.isInteger(n)&&n>=0),first=Math.min(...known),last=Math.max(...known);
    const range=result[key]??[first,last]; result[key]=[Math.min(range[0],first),Math.max(range[1],last)];
  }
  return result;
}
function reportKey(r,slot) {
  if(r.sent_client_tick<0||slot<0) return null;
  return (r.flags&1) ? `${slot}/r/${r.epoch}/${r.sequence}/${r.sent_client_tick}`
    : `${slot}/p/${r.sent_client_tick}/${r.report_index}`;
}
// Do not manufacture a verdict by nearest time or target. Duplicates stay ambiguous.
export function pairShotVerdicts(shots,verdicts,ownMachineSlot) {
  const groups=new Map(), reports=new Map();
  for(const v of verdicts) {const k=reportKey(v,v.machine_slot); if(k!==null) {
    if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(v);
  }}
  for(const s of shots) {const k=reportKey(s,ownMachineSlot); if(k!==null) reports.set(k,(reports.get(k)??0)+1);}
  return shots.map(s=>{
    const key=reportKey(s,ownMachineSlot), found=groups.get(key)??[];
    const status=s.sent_client_tick<0?'not_sent':key===null?'unknown_identity':found.length===0?'no_verdict':found.length!==1||reports.get(key)!==1?'ambiguous':'paired';
    return {shot_index:s.index,status,verdict_index:status==='paired'?found[0].index:null};
  });
}
export function verdictLabel(verdict, refusalCodesVersion=1) {
  if(!verdict) return 'no_verdict';
  if(refusalCodesVersion!==1||!REFUSALS[verdict.verdict]) return 'unknown';
  if(verdict.verdict!==0) return 'refused';
  if(verdict.tested_host_tick<0) return 'not_tested';
  if(verdict.shot_flags&2) return 'head';
  if(verdict.shot_flags&4) return 'head_as_body';
  return 'body';
}
// Requires the complete ordered pull table (or its row-index/tick index), not a
// time-nearest match. Return null if the linked row is outside the supplied window.
export function linkedPull(row,pulls,isShot=false) {
  if(isShot && !(row.flags&8)) return null;
  let lo=0,hi=pulls.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(pulls[mid].client_tick<=row.client_tick)lo=mid+1;else hi=mid;}
  if(!lo) return null;
  const last=pulls[lo-1].index, index=last-((last-row.pull_low16)&65535);
  lo=0;hi=pulls.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(pulls[mid].index<index)lo=mid+1;else hi=mid;}
  return index>=0 && pulls[lo]?.index===index?index:null;
}
