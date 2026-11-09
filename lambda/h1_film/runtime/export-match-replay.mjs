import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {inspectMatchFilm} from './match-film.mjs';
import {readClientAccount,readHostLedger} from './format3-diagnostics.mjs';
import {readRawPad} from './format3-pad.mjs';
import {unpackMszip} from './adapters/beta5-v2-120.mjs';
import {unpackNetworkColumns} from './format3-codec.mjs';
import {writeMatchReplay} from './pack-match-replay.mjs';
import {sha256} from './engine-store.mjs';
import {unsupportedClientBuild} from './client-build.mjs';
import {profileById,BUILD_MATCHING} from './profiles.mjs';
import {readEnvelope} from './adapters/beta6-v3-120.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function exportMatchReplay({film,directory,hostWorld,output,sourceContract}) {
  const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
  assert.equal(report.status,'simulation_and_encoding_verified');
  const raw=await readFile(film),match=inspectMatchFilm(raw);
  assert.equal(match.sha256,report.provenance.film_sha256);
  const converted=JSON.parse(await readFile(join(directory,'match-tracks.json'),'utf8'));
  assert.equal(converted.source_film_sha256,match.sha256);
  assert.equal(converted.tracks.length,match.parts.length);
  const partial=[7,8,9,10].includes(sourceContract.profile_revision);
  assert.equal(report.exporter_revision>=16,partial,'Match policy differs from recipe');
  assert.equal(report.exporter_revision>=17,sourceContract.profile_revision>=8,'Match storage differs from recipe');
  assert.equal(report.exporter_revision>=18,sourceContract.profile_revision>=9,'Match roster policy differs from recipe');
  assert.equal(report.exporter_revision>=22,sourceContract.profile_revision>=10,'Match client build policy differs from recipe');
  const scratch=output+'.parts';await mkdir(scratch);
  const entries=[],tracks=[];
  async function add(id,kind,bytes,extra={}) {
    assert.ok(bytes.length>0);
    const path=join(scratch,`${entries.length}.bin`);
    await writeFile(path,bytes,{flag:'wx'});
    entries.push({id,kind,compression:'identity',path,...extra});return id;
  }
  function world(id,path) {entries.push({id,kind:'world',compression:'identity',path});return id;}
  function section(bytes,at) {
    const start=bytes.readUInt32LE(at),size=bytes.readUInt32LE(at+4);
    assert.ok(start<=bytes.length&&size<=bytes.length-start);
    return size?bytes.subarray(start,start+size):null;
  }
  async function tables(track,kind,account) {
    track.tables??=[];
    for(const table of account.tables) {
      if(!table.count) {track.tables.push({kind,name:table.name,count:0,stride:table.stride,capped:table.capped});continue;}
      const entry=await add(`${track.id}/${kind}/${table.name}`,'diagnostic-table',table.bytes);
      const chunks=[];
      for(let first=0;first<table.count;first+=2048) {
        const count=Math.min(2048,table.count-first),offset=first*table.stride,size=count*table.stride;
        chunks.push({first_row:first,row_count:count,offset,size_bytes:size,sha256:digest(table.bytes.subarray(offset,offset+size))});
      }
      track.tables.push({kind,name:table.name,count:table.count,stride:table.stride,capped:table.capped,entry,chunks});
    }
  }
  async function recorded(track,bytes) {
    track.recorded_sections={};
    // Recorder options/config may contain private credentials. Their reviewed typed
    // settings are stored separately by the API; the canonical film retains the originals.
    for(const [name,at,sizeAt] of [['gametype',84,88],
      ['input_script',92,96],['events',112,116],['roster',456,460]]) {
      const start=bytes.readUInt32LE(at),size=bytes.readUInt32LE(sizeAt);
      assert.ok(start<=bytes.length&&size<=bytes.length-start);
      if(size)track.recorded_sections[name]=await add(`${track.id}/recorded/${name}`,'recorded-section',bytes.subarray(start,start+size));
    }
    const roster=section(bytes,456);
    if(roster) {
      assert.ok(roster.length===464&&roster.readUInt32LE(0)===0x52545352&&roster.readUInt32LE(4)<=16);
      track.roster={start_flags:roster.readUInt32LE(8),players:Array.from({length:roster.readUInt32LE(4)},(_,slot)=>{
        const at=16+slot*28;return {slot,team:roster[at],fireteam:roster[at+1],name:roster.subarray(at+4,at+28).toString('utf16le').split('\0')[0]};
      })};
    }
    const ledger=section(bytes,480);
    if(ledger) {
      track.recorded_sections.ledger=await add(`${track.id}/recorded/ledger`,'host-ledger',ledger);
      await tables(track,'ledger',readHostLedger(ledger,match.host.match_id));
    }
    const rawPad=section(bytes,104);
    if(rawPad) {
      const pad=readRawPad(rawPad),{events,samples,...metadata}=pad;
      track.pad={...metadata,original:await add(`${track.id}/recorded/pad`,'raw-pad',rawPad)};
      if(events.length)track.pad.events=await add(`${track.id}/pad/events`,'raw-pad',events);
      if(samples.length)track.pad.samples=await add(`${track.id}/pad/samples`,'raw-pad',samples);
    }
    const network=section(bytes,448);
    if(network) {
      track.recorded_sections.network=await add(`${track.id}/recorded/network`,'network-observations',network);
      const blocks=[],decoded=[];let at=32,offset=0;
      for(let i=0;i<network.readUInt32LE(24);i++) {
        const [size,packedSize,first,last,count,flags]=Array.from({length:6},(_,j)=>network.readUInt32LE(at+j*4));at+=24;
        const packed=network.subarray(at,at+packedSize);at+=packedSize;
        const expanded=flags&1?unpackMszip(packed,size):packed;
        const block=flags&2?unpackNetworkColumns(expanded,count):expanded;
        assert.equal(block.length,size);
        blocks.push({offset,size_bytes:size,first_tick:first,last_tick:last,count,sha256:digest(block)});
        offset+=size;assert.ok(offset<=512*1024*1024);decoded.push(block);
      }
      if(offset)track.network={entry:await add(`${track.id}/network/records`,'network-observations',Buffer.concat(decoded)),
        format:'h1arena.fnet-records.v2',blocks};
    }
  }
  const host={id:'host',role:'host',source_film_sha256:digest(raw.subarray(match.host_offset,match.host_offset+match.host_size)),
    ...(partial?{status:'available'}:{}),
    frame_count:report.envelope.ticks,first_update:report.envelope.first_update,viewer_revision:5,
    world:world('host/world',hostWorld),verification:report.simulation};
  await recorded(host,raw.subarray(match.host_offset,match.host_offset+match.host_size));tracks.push(host);
  const hostAccountOffset=raw.readUInt32LE(match.host_offset+496),hostAccountSize=raw.readUInt32LE(match.host_offset+500);
  if(hostAccountSize&&!match.parts.some(p=>p.account_offset===match.host_offset+hostAccountOffset&&p.account_size===hostAccountSize)) {
    const bytes=raw.subarray(match.host_offset+hostAccountOffset,match.host_offset+hostAccountOffset+hostAccountSize);
    const account=readClientAccount(bytes);
    host.account={...Object.fromEntries(Object.entries(account).filter(([key])=>key!=='tables')),
      original:await add('host/recorded/account','client-account',bytes)};
    await tables(host,'client',account);
  }
  for(const [index,c] of converted.tracks.entries()) {
    const part=match.parts[index];assert.deepEqual(c.part,part);
    assert.equal(c.id,`client-${index}`);
    const bytes=await readFile(join(directory,`${c.id}.h1film`));
    assert.equal(digest(bytes),c.source_film_sha256);
    if(c.failure?.reason==='unsupported_build') {
      const envelope=await readEnvelope(join(directory,`${c.id}.h1film`),{allowClientView:true});
      assert.deepEqual(c.envelope,envelope,'Unsupported client source envelope differs');
      assert.deepEqual(c.failure,unsupportedClientBuild(envelope,profileById(report.engine_profile),
        report.exporter_revision,BUILD_MATCHING[report.engine_profile]),'Unsupported client build evidence differs');
    }
    const unavailable=partial&&c.status==='unavailable';
    if(!unavailable)assert.equal(await sha256(join(directory,c.world)),c.world_sha256);
    const track={id:c.id,role:'client',source_film_sha256:c.source_film_sha256,frame_count:c.envelope.ticks,
      first_update:c.envelope.first_update,...(unavailable?{status:'unavailable',failure:c.failure}:
        {...(partial?{status:'available'}:{}),viewer_revision:5,world:world(`${c.id}/world`,join(directory,c.world)),verification:c.verification}),
      recorded_own_player:part.player,ends_early:Boolean(part.flags&1),
      recorded_trust:{inputs:part.inputs_trust,messages:part.messages_trust,reason:part.reason},
      clocks:c.envelope.network.clocks,alignment:{method:'unavailable',reason:'client_account_not_recorded'}};
    await recorded(track,bytes);
    if(part.account_size) {
      const accountBytes=raw.subarray(part.account_offset,part.account_offset+part.account_size),account=readClientAccount(accountBytes);
      assert.equal(account.own_player,part.player,'Account player differs');
      const account_entry=await add(`${c.id}/recorded/account`,'client-account',accountBytes);
      const clock=account.tables.find(t=>t.name==='clock');
      const rows=Array.from({length:clock.count},(_,i)=>[clock.bytes.readInt32LE(i*8),clock.bytes.readInt32LE(i*8+4)]);
      track.alignment={method:'recorded-client-clock-v1',account_entry,rows};
      track.account={version:account.version,flags:account.flags,clock_period:account.clock_period,
        own_machine_slot:account.own_machine_slot,own_player:account.own_player,last_verdict_host_tick:account.last_verdict_host_tick,
        host_rules:account.host_rules};
      await tables(track,'client',account);
    }
    tracks.push(track);
  }
  return writeMatchReplay(output,{sourceContract,source_film_sha256:match.sha256,
    raw_map_sha256:report.provenance.map_sha256,engine_profile:report.engine_profile,
    wasm_sha256:report.provenance.wasm_sha256,glue_sha256:report.provenance.glue_sha256,match_id:match.host.match_id},tracks,entries);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [requestPath]=process.argv.slice(2);assert.ok(requestPath);
  const request=JSON.parse(await readFile(resolve(requestPath),'utf8'));
  const result=await exportMatchReplay(request);
  await writeFile(request.output+'.json',JSON.stringify(result),{flag:'wx'});
}
