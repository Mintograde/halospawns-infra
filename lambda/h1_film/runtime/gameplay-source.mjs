import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {inspectMatchFilm,matchFilmPolicy} from './match-film.mjs';
import {readClientAccount,readHostLedger} from './format3-diagnostics.mjs';
import {TABLES,decodeDiagnosticRow,pairShotVerdicts,linkedPull} from './diagnostics-codec.mjs';
import {classifyGameplayMetrics} from './gameplay-metrics.mjs';
import {addGameplayEstimates} from './gameplay-estimates.mjs';
import {deriveMeleeMetrics} from './melee-metrics.mjs';

function rows(account,kind,name) {
  const t=account?.tables.find(t=>t.name===name);
  if(!t || t.capped) return null;
  return Array.from({length:t.count},(_,i)=>decodeDiagnosticRow(kind,name,t.bytes.subarray(i*t.stride,(i+1)*t.stride),i));
}
function account11(bytes) {
  assert.ok(bytes.length>=152 && bytes.readUInt32LE(0)===0x3143444c && bytes.readUInt32LE(4)===11
    && bytes.readUInt32LE(8)===152 && bytes.readUInt32LE(20)===13,'Invalid Beta 5 gameplay account');
  let at=152; const flags=bytes.readUInt32LE(12),tables=[];
  for(let i=0;i<13;i++) {
    const [name,stride]=TABLES.client[i],count=bytes.readUInt32LE(48+i*8);
    assert.ok(bytes.readUInt32LE(52+i*8)===stride && count*stride<=bytes.length-at,'Invalid gameplay account table');
    tables.push({name,stride,count,bytes:bytes.subarray(at,at+count*stride),capped:Boolean(flags&(1<<i))});
    at+=count*stride;
  }
  assert.equal(at,bytes.length);
  return {tables,own_machine_slot:bytes.readInt32LE(24),own_player:bytes.readInt32LE(28)};
}

export function recordedGameplaySources(raw,exporterRevision) {
  const beta6=raw.readUInt32LE(4)===3;
  const accountOptions={allowUnassignedPlayer:beta6&&raw.readUInt32LE(8)===9844};
  const match=beta6?inspectMatchFilm(raw,matchFilmPolicy(exporterRevision)):null;
  const host=match?raw.subarray(match.host_offset,match.host_offset+match.host_size):raw;
  const section=(b,at)=>{
    const start=b.readUInt32LE(at),size=b.readUInt32LE(at+4);
    assert.ok(start<=b.length && size<=b.length-start,'Gameplay section outside source');
    return size?b.subarray(start,start+size):null;
  };
  const ledgerBytes=section(host,480),accounts=[],seen=new Set();
  function add(bytes) {
    if(!bytes) return;
    const hash=createHash('sha256').update(bytes).digest('hex');
    if(seen.has(hash)) return;
    seen.add(hash);
    const account=beta6?readClientAccount(bytes,accountOptions):account11(bytes);
    accounts.push({...account,hash});
  }
  add(section(host,496));
  for(const p of match?.parts??[]) if(p.account_size) add(raw.subarray(p.account_offset,p.account_offset+p.account_size));
  return {ledger:ledgerBytes?readHostLedger(ledgerBytes,host.readBigUInt64LE(488).toString(16).padStart(16,'0')):null,accounts};
}

// The upstream host records exactly one FNET DEAL for each TAKEN verdict, in
// ledger order, before executing that damage. Check the complete per-tick
// bijection, including calls that remove no vitality, before using any link.
export function gameplayVerdicts({ledger,accounts}) {
  const original=rows(ledger,'ledger','verdicts');
  if(original) return {verdicts:original,ordered:true};
  const unique=new Map();
  for(const a of accounts) for(const v of rows(a,'client','host_verdicts')??[]) {
    const {index,...record}=v;
    const key=v.flags&1?`${v.machine_slot}/r/${v.sent_client_tick}/${v.epoch}/${v.sequence}`
      :`${v.machine_slot}/p/${v.sent_client_tick}/${v.report_index}`;
    const serialized=JSON.stringify(record),previous=unique.get(key);
    if(previous===undefined) unique.set(key,serialized);
    else if(previous!==serialized) unique.set(key,null);
  }
  return {verdicts:[...unique.values()].filter(Boolean).map((v,index)=>({...JSON.parse(v),index})),ordered:false};
}

export function bindGameplayShots(events,{ledger,accounts}) {
  const {verdicts,ordered}=gameplayVerdicts({ledger,accounts}), links=new Map(), grouped=new Map();
  if(verdicts) {
    const byTick=new Map();
    for(const v of verdicts) if(v.verdict===0) {
      const list=byTick.get(v.host_tick)??[];list.push(v);byTick.set(v.host_tick,list);
    }
    for(const e of events) if(e.kind===3) {
      const list=grouped.get(e.clock)??[];list.push(e);grouped.set(e.clock,list);
    }
    for(const [clock,deals] of grouped) {
      const accepted=byTick.get(clock)??[];
      if(ordered) {
        if(deals.length!==accepted.length || deals.some((d,i)=>d.physical!==accepted[i].owner || d.unit!==accepted[i].object)) continue;
        for(let i=0;i<deals.length;i++) links.set(deals[i].deal,accepted[i].index);
      } else {
        // Client copies preserve report IDs but not cross-machine order. An exact
        // (host tick, owner, full target handle) join must be one-to-one on BOTH
        // sides. Simultaneous ambiguous reports remain unknown.
        for(const d of deals) {
          const found=accepted.filter(v=>v.owner===d.physical&&v.object===d.unit);
          if(found.length===1&&deals.filter(other=>other.physical===d.physical&&other.unit===d.unit).length===1)
            links.set(d.deal,found[0].index);
        }
      }
    }
  }
  const shotsByVerdict=new Map();
  for(const account of accounts) {
    const shots=rows(account,'client','shots'),pulls=rows(account,'client','pulls');
    if(!verdicts || !shots || !pulls) continue;
    // Low-16 pull references require a unique unwrap in this bounded account.
    // The source format cannot prove identity across a full wrap; fail closed.
    if(pulls.length>65536 || pulls.some((p,i)=>i&&p.client_tick<pulls[i-1].client_tick)) continue;
    const sequence=new Map(),fires=new Map();
    for(const p of pulls) {
      if(p.flags&2) continue; // Thrown grenades are not weapon discharges.
      const n=(sequence.get(p.owner)??0)+1;sequence.set(p.owner,n);fires.set(p.index,n);
    }
    for(const pair of pairShotVerdicts(shots,verdicts,account.own_machine_slot)) {
      if(pair.status!=='paired') continue;
      const shot=shots[pair.shot_index],verdict=verdicts[pair.verdict_index];
      const pullIndex=linkedPull(shot,pulls,true),pull=pullIndex===null?null:pulls[pullIndex];
      if(!pull || pull.flags || pull.pellet!==0 || pull.trigger!==0 || pull.owner!==shot.owner
        || shot.owner!==verdict.owner || shot.object!==verdict.object || verdict.verdict!==0
        || !fires.has(pullIndex)) continue;
      const found=shotsByVerdict.get(verdict.index)??[];
      found.push({discharge:`${account.hash}/${pullIndex}`,sequence:fires.get(pullIndex),
        domain:account.hash,owner:shot.owner,weapon_tag:pull.weapon_tag});
      shotsByVerdict.set(verdict.index,found);
    }
  }
  return events.map(e=>{
    if(e.kind===0) return {...e,discharge:`local/${e.shot}`,domain:'local'};
    if(e.kind!==1) return e;
    if(e.deal) {
      const candidates=shotsByVerdict.get(links.get(e.deal))??[];
      if(candidates.length!==1 || candidates[0].weapon_tag!==e.weapon_tag || candidates[0].owner!==e.physical) return {...e,discharge:null};
      const shot=candidates[0];
      return {...e,discharge:shot.discharge,remoteShot:{...shot,slot:e.slot,weapon:e.weapon}};
    }
    return {...e,discharge:e.shot?`local/${e.shot}`:null};
  });
}

export async function buildGameplayMetrics({film,evidence,encoding,includeEstimates=false,definitionVersion=1,exporterRevision}) {
  for(const kind of ['shot','damage','death']) assert.notEqual(
    encoding.native_analytics.combat[`${kind}_coverage`].reason,'capped',
    'Gameplay metrics require uncapped combat evidence');
  assert.ok((await stat(evidence)).size<=128*1024*1024,'Gameplay evidence too large');
  const events=[];
  const input=createInterface({input:createReadStream(evidence),crlfDelay:Infinity});
  for await(const line of input) {
    const frame=JSON.parse(line);
    assert.ok(Array.isArray(frame.events)&&frame.events.length<=2048,'Invalid gameplay frame');
    for(const event of frame.events) events.push({...event,source_tick:frame.source_tick});
    assert.ok(events.length<=400000,'Gameplay event limit exceeded');
  }
  const source=recordedGameplaySources(await readFile(film),exporterRevision);
  const args={events:events.filter(e=>e.kind<=3),slots:encoding.players,deaths:encoding.native_analytics.combat.deaths,definitionVersion,
    partialRecording:encoding.source_first_clock!==0 || encoding.analytics.match_end_source_tick===null};
  const exact=classifyGameplayMetrics({...args,events:bindGameplayShots(args.events,source)});
  const product=includeEstimates ? addGameplayEstimates(exact,args) : exact.product;
  if(exporterRevision>=29) product.metrics.push(...deriveMeleeMetrics({...args,events}));
  else assert.ok(events.every(e=>e.kind<=3),'Melee evidence requires its frozen exporter');
  return product;
}
