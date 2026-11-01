// Browser-safe logical package reader. World artifacts keep the existing viewer-5 codec.
export const VIEW_TRACKS_SCHEMA = 'halospawns.h1ReplayViews.v1';
const hash=/^[0-9a-f]{64}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
function check(ok,message) { if(!ok) throw new Error(`H1 views: ${message}`); }
export function validateViewTracks(m) {
  check(m?.schema===VIEW_TRACKS_SCHEMA,'unsupported manifest');
  const hosted=m.available===true;
  if(hosted) check(hash.test(m.package_id)&&uuid.test(m.replay_id)&&uuid.test(m.host_artifact_id),'invalid package generation');
  check(/^[0-9a-f]{16}$/.test(m.match_id)&&m.match_id!=='0000000000000000','invalid match');
  check(m.engine_profile==='h1-performance-beta5-p9818-wasm-v1'&&hash.test(m.raw_map_sha256),'invalid engine/map');
  check(m.tick_rate===120&&m.authoritative_track==='host','invalid authoritative track');
  check(Array.isArray(m.tracks)&&m.tracks.length>=2&&m.tracks.length<=17,'invalid track count');
  const ids=new Set(),sources=new Set();
  for(const t of m.tracks) {
    check(t && typeof t==='object','invalid track');
    check(!ids.has(t.id)&&!sources.has(t.source_film_sha256),'duplicate track/source');
    ids.add(t.id);sources.add(t.source_film_sha256);
    check(t.id===(t.role==='host'?'host':`client-${t.source_film_sha256}`),'invalid track identity');
    check(['host','client'].includes(t.role)&&hash.test(t.source_film_sha256),'invalid source');
    check(integer(t.frame_count,1,432000)&&integer(t.first_update,0,2147051647),'invalid coverage');
    check(integer(t.exporter_revision,t.role==='client'?13:11,1000000),'invalid exporter');
    check(hash.test(t.wasm_sha256)&&hash.test(t.glue_sha256),'missing engine pin');
    if(hosted) check(uuid.test(t.generation_id)&&(t.role!=='host'||t.generation_id===m.host_artifact_id),'invalid track generation');
    const a=t.artifact;
    check(a?.viewer_revision===5&&hash.test(a.sha256)&&integer(a.size_bytes,1,2147483647),'invalid artifact');
    if(hosted) validateAsset(a,512*1024**2);
    else check(typeof a.path==='string'&&/^(host|client-[0-9a-f]{64})\/replay\.120hz\.hsrdc$/.test(a.path)
      &&a.path.startsWith(t.id+'/'),'invalid artifact path');
    if(t.role==='host') continue;
    check(integer(t.recorded_own_player,0,15),'invalid recording player');
    if(hosted) {
      validateAsset(t.timeline,32*1024**2);
      check(t.timeline.schema==='halospawns.h1ClientViewTimeline.v1','invalid timeline');
      check(t.alignment?.method==='beta5-client-clock-v1'&&hash.test(t.alignment.source_film_sha256)
        &&t.alignment.source_film_sha256!==t.source_film_sha256,'unbound independent clock source');
      continue; // Original clocks are in the separately hashed timeline.
    }
    check(Array.isArray(t.clocks)&&t.clocks.length>0&&t.clocks.length<=432000,'missing frame clock');
    let previous=-1;
    for(const c of t.clocks) {
      check(integer(c.frame,0,t.frame_count-1)&&c.frame>previous&&integer(c.game_tick,0,2147051647),'invalid frame clock');
      previous=c.frame;
    }
    check(t.clocks[0].frame===0,'missing initial frame clock');
    const s=t.alignment;
    check(s?.method==='beta5-client-clock-v1'&&s.source_film_sha256===m.tracks[0].source_film_sha256,'unbound alignment');
    check(Array.isArray(s.rows)&&s.rows.length<=65536,'invalid clock rows');
    for(const row of s.rows) check(Array.isArray(row)&&row.length===2&&row.every(v=>integer(v,0,2147051647)),'invalid clock sample');
  }
  check(m.tracks[0].id==='host'&&m.tracks.filter(t=>t.role==='host').length===1,'missing host');
  return m;
}

function validateAsset(a,max) {
  check(a&&hash.test(a.sha256)&&integer(a.size_bytes,1,max)&&a.method==='GET','invalid delivered asset');
  let url;try {url=new URL(a.url);} catch {check(false,'invalid asset URL');}
  check(url.protocol==='https:'&&!url.username&&!url.password,'invalid asset URL');
}

// Fetching remains caller-owned. Bind one response's raw timeline bytes to that
// same package before enabling cross-track seeks; never reuse clocks by URL alone.
export async function bindViewTimelines(manifest,timelines) {
  validateViewTracks(manifest);
  check(manifest.available===true,'expected hosted package');
  const result=structuredClone(manifest);
  for(const track of result.tracks) {
    if(track.role==='host')continue;
    const bytes=timelines[track.id];
    check(bytes instanceof Uint8Array&&bytes.byteLength===track.timeline.size_bytes,'timeline length differs');
    const digest=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
    check(Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')===track.timeline.sha256,'timeline digest differs');
    const t=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    check(t.contract==='halospawns.h1ClientViewTimeline.v1'&&t.attempt_id===track.generation_id
      &&t.host_artifact_id===manifest.host_artifact_id&&t.source_film_sha256===track.source_film_sha256
      &&t.clock_source_film_sha256===track.alignment.source_film_sha256&&t.frame_count===track.frame_count
      &&t.first_update===track.first_update&&t.alignment_method===track.alignment.method,'timeline provenance differs');
    check(Array.isArray(t.clocks)&&t.clocks.length>0&&t.clocks.length<=432000&&t.clocks[0].frame===0,'missing clock');
    let previous=-1;
    for(const c of t.clocks) {
      check(integer(c.frame,0,t.frame_count-1)&&c.frame>previous&&integer(c.game_tick,0,2147051647),'invalid clock segment');
      previous=c.frame;
    }
    check(Array.isArray(t.alignment_rows)&&t.alignment_rows.length<=65536,'invalid alignment');
    for(const row of t.alignment_rows)check(Array.isArray(row)&&row.length===2&&row.every(v=>integer(v,0,2147051647)),'invalid sample');
    track.clocks=t.clocks;track.alignment.rows=t.alignment_rows;
  }
  return result;
}

// Upstream pairtime offset rule, restricted to the range actually sampled.
// Rows are [client game tick, host tick], in original recording order.
export function mapRecordedClock(rows,tick,toClient) {
  if(!Number.isSafeInteger(tick)||!rows.length)return null;
  const from=toClient?1:0,to=1-from;
  let k=-1,min=Infinity,max=-Infinity;
  for(let i=0;i<rows.length;i++) {
    const value=rows[i][from]; min=Math.min(min,value);max=Math.max(max,value);
    if(value<=tick)k=i;
  }
  if(k<0||tick<min||tick>max)return null;
  let mapped=rows[k][to]+tick-rows[k][from];
  if(k+1<rows.length)mapped=Math.min(mapped,rows[k+1][to]);
  return mapped;
}
function frameToClock(track,frame) {
  if(!integer(frame,0,track.frame_count-1))return null;
  if(track.role==='host')return track.first_update+frame+1;
  if(!track.clocks?.length)return null;
  let c=track.clocks[0];
  for(const next of track.clocks) {if(next.frame>frame)break;c=next;}
  return c.game_tick+frame-c.frame;
}
function clockToFrame(track,tick) {
  if(tick===null)return null;
  if(track.role==='host') {
    const frame=tick-track.first_update-1;
    return integer(frame,0,track.frame_count-1)?frame:null;
  }
  if(!track.clocks?.length)return null;
  let found=null;
  for(let i=0;i<track.clocks.length;i++) {
    const c=track.clocks[i],end=track.clocks[i+1]?.frame??track.frame_count;
    const frame=c.frame+tick-c.game_tick;
    if(integer(frame,c.frame,end-1)) {if(found!==null)return null;found=frame;}
  }
  return found;
}
// Call validateViewTracks once when loading. A null result means unavailable
// coverage or ambiguous repeated game time; do not silently clamp to an endpoint.
export function mapViewFrame(manifest,fromId,toId,frame) {
  const from=manifest.tracks.find(t=>t.id===fromId),to=manifest.tracks.find(t=>t.id===toId);
  if(!from||!to)return null;
  const clock=frameToClock(from,frame);
  if(clock===null)return null;
  if(from===to)return frame;
  const hostClock=from.role==='host'?clock:mapRecordedClock(from.alignment.rows??[],clock,false);
  if(hostClock===null)return null;
  const target=to.role==='host'?hostClock:mapRecordedClock(to.alignment.rows??[],hostClock,true);
  return clockToFrame(to,target);
}
