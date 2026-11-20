import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access, open, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {linkedPull, pairShotVerdicts} from './diagnostics-codec.mjs';
import {bindGameplayDeals, recordedGameplaySources, rows} from './gameplay-source.mjs';
import {readEnvelope} from './film.mjs';
import {sha256} from './engine-store.mjs';
import {originalUnzoomedShots} from './sniper-zoom-reset.mjs';

const SNIPER = 'weapons/sniper rifle/sniper rifle';
const scopeNames = ['unknown', 'unzoomed', 'zoomed'];
const fireKey = (clock, owner, tag) => `${clock}/${owner}/${tag}`;

function unique(index, key, value) {
  index.set(key, index.has(key) ? null : value);
}

async function readEvidence(file, before = Infinity) {
  assert.ok((await stat(file)).size <= 128 * 1024 * 1024, 'Oversized sniper evidence');
  const fires = new Map(), deaths = new Map(), deals = [], excluded = new Map(), contacts = new Map();
  const anchors = [];
  let capped = false;
  for await (const line of createInterface({input: createReadStream(file), crlfDelay: Infinity})) {
    const {source_tick, events} = JSON.parse(line);
    if (source_tick >= before) break;
    for (const event of events) {
      const [kind, a, b, c, d, e, f, killer, victim, impact] = event;
      if (kind === 0) unique(fires, fireKey(a,b,c), d);
      else if (kind === 1 || kind === 6) unique(deaths, `${source_tick}/${a}`,
        {scope:b, deal:c, tag:d, owner:e, unit:f, killer, victim, impact, recovered:kind === 6});
      else if (kind === 2) deals.push({kind:3, clock:a, deal:b, physical:c, unit:d});
      else if (kind === 3) unique(excluded,`${source_tick}/${a}`,{killer:b,victim:c});
      else if (kind === 4) unique(contacts, contactKey(a,b,normalizedImpact(d)), c);
      else if (kind === 7) anchors.push([source_tick, a]);
      else { assert.equal(kind,5); capped = true; }
    }
  }
  return {fires, deaths, deals, excluded, contacts:capped ? new Map() : contacts, anchors};
}

const contactKey = (clock,weapon,impact) => [clock,weapon,...impact].join('/');

// The report handler calls the source engine's normalize3d on point damage.
// Reproduce its binary32 expression order so equality remains bit-for-bit.
export function normalizedImpact(impact) {
  const bits=Uint32Array.from(impact.slice(10)), v=new Float32Array(bits.buffer), f=Math.fround;
  const length=f(Math.sqrt(f(f(v[2]*v[2])+f(f(v[0]*v[0])+f(v[1]*v[1])))));
  if (length>=f(0.0001)) {
    const scale=f(1/length);
    for (let i=0;i<3;i++) v[i]=f(v[i]*scale);
  }
  return [...impact.slice(0,10),...bits];
}

// Hash sample updates are explicitly listed in the original TRL1 trailer.
// Only use actions followed by a matching sample before the first divergence.
export async function verifiedPrefix(file, track) {
  const {envelope:e,failure:f} = track;
  if (track.status === 'available') return Infinity;
  if (f?.network_refused !== 0 || f.played_ticks !== e.ticks || f.hash_checks !== e.hash_samples) return 0;
  if (f.reason === 'roster_mismatch' && !f.seed_mismatches && !f.hash_mismatches) return Infinity;
  if (f.reason !== 'simulation_desync') return 0;
  return (await samplesBeforeMismatch(file,e,f.first_mismatch_update)).before;
}

export async function samplesBeforeMismatch(file, e, mismatch) {
  const input = await open(file);
  try {
    const read = async (n,at) => {
      const b=Buffer.alloc(n);
      assert.equal((await input.read(b,0,n,at)).bytesRead,n,'Truncated client hash trailer');
      return b;
    };
    const header=await read(52,0), trailer=header.readUInt32LE(48);
    const samples=await read(8+16*e.hash_samples,trailer);
    assert.equal(samples.toString('ascii',0,4),'TRL1');
    assert.equal(samples.readUInt32LE(4),e.hash_samples);
    let previous=-1, last=e.first_update, checks=0;
    for (let i=0;i<e.hash_samples;i++) {
      const tick=samples.readUInt32LE(8+i*16);
      if (tick <= previous || tick < e.first_update || tick >= e.first_update+e.ticks) return {before:0,checks:0};
      previous=tick;
      if (tick < mismatch) { last=tick; checks++; }
    }
    return {before:last-e.first_update, checks};
  } finally { await input.close(); }
}

// A remote hit is decided on the shooter's client. Require the original pull,
// its accepted hit report, and the same discharge in that verified client world.
export function remoteScopes(host, source, clientFires) {
  const scopes = new Map();
  if (!clientFires.size || source.ledger?.tables.find(t => t.name === 'verdicts')?.capped) return scopes;
  const {verdicts, links} = bindGameplayDeals(host.deals, source);
  const byVerdict = new Map();
  for (const account of source.accounts) {
    const fires = clientFires.get(account.hash);
    if (!fires || account.own_player < 0 || account.own_machine_slot < 0) continue;
    const shots = rows(account, 'client', 'shots'), pulls = rows(account, 'client', 'pulls');
    if (!shots || !pulls || pulls.length > 65536
        || pulls.some((p,i) => i && p.client_tick < pulls[i-1].client_tick)) continue;
    const identities = new Map();
    for (const p of pulls) if (!p.flags && p.pellet === 0 && p.trigger === 0)
      unique(identities, fireKey(p.client_tick,p.owner,p.weapon_tag), p.index);
    for (const pair of pairShotVerdicts(shots, verdicts, account.own_machine_slot)) {
      if (pair.status !== 'paired') continue;
      const shot = shots[pair.shot_index], v = verdicts[pair.verdict_index];
      const index = linkedPull(shot, pulls, true), pull = index === null ? null : pulls[index];
      if (!pull || v.verdict !== 0 || v.object !== shot.object || v.owner !== shot.owner
          || v.owner !== account.own_player || pull.owner !== v.owner || pull.flags
          || pull.trigger !== 0 || pull.pellet !== 0 || pull.client_tick > shot.client_tick
          || shot.client_tick > shot.sent_client_tick) continue;
      const key = fireKey(pull.client_tick, pull.owner, pull.weapon_tag);
      if (identities.get(key) !== index) continue;
      unique(byVerdict, v.index, {scope:fires.get(key), tag:pull.weapon_tag, owner:v.owner, unit:v.object,
        account:account.hash, clock:pull.client_tick});
    }
  }
  for (const [deal, verdictIndex] of links) scopes.set(deal, byVerdict.get(verdictIndex));
  return scopes;
}

export function classifySniperKills(combat, observations, remote, extended) {
  const rifles = new Set(combat.weapons.filter(w => w.category === 'weapon'
    && w.tag_path.toLowerCase().replaceAll('\\','/') === SNIPER).map(w => w.weapon_id));
  const kills = [], excluded = [], recoveredWeapons = [];
  let previousTick = -1, offset = 0;
  for (const death of combat.deaths) {
    if (death.source_tick !== previousTick) { previousTick = death.source_tick; offset = 0; }
    const key = `${death.source_tick}/${offset++}`;
    const negative = extended?.excluded.get(key);
    if (negative && death.kind === 'kill' && death.weapon_id == null
        && negative.killer === death.killer_slot && negative.victim === death.victim_slot) excluded.push(death.event_index);
    const shot = observations.get(key);
    if (death.kind !== 'kill') continue;
    if (!rifles.has(death.weapon_id)) {
      if (!extended?.damageGraph || !shot?.recovered || death.weapon_id != null) continue;
      assert.ok(!negative, 'Conflicting sniper damage attribution');
      recoveredWeapons.push(death.event_index);
    } else assert.ok(!shot?.recovered, 'Sniper recovery requires an unattributed combat death');
    assert.ok(shot && shot.killer === death.killer_slot && shot.victim === death.victim_slot,
      'Sniper observation differs from combat death');
    let scope = shot.scope, method = 'projectile';
    if (shot.deal) {
      const client = remote.get(shot.deal);
      scope = client && client.tag === shot.tag && client.owner === shot.owner
        && (client.unit === shot.unit || (extended && client.unit === shot.impact?.[3]))
        ? client.scope : 0;
      method = 'client_pull';
      const point = extended?.points.get(shot.deal);
      if (point === 1 || point === 2) {
        if (scope && scope !== point) scope=0;
        else if (!scope) { scope=point; method='client_impact'; }
      }
      if (extended?.resets?.has(shot.deal)) {
        if (client?.scope === 2 || point === 2) scope = 0;
        else if (!scope) { scope = 1; method = 'client_zoom_reset'; }
      }
    }
    const zoom = scopeNames[scope] ?? 'unknown';
    kills.push({event_index:death.event_index, zoom, method:zoom === 'unknown' ? 'unavailable' : method});
  }
  if (extended?.damageGraph) return {schema:'halospawns.h1SniperKills.v3',kills,excluded,recovered_weapons:recoveredWeapons};
  return extended ? {schema:'halospawns.h1SniperKills.v2',kills,excluded} : {schema:'halospawns.h1SniperKills.v1', kills};
}

// The original hit queue flushes after game_time_update and uses that clock on
// both the first send and retransmissions. The point itself is sampled one tick
// earlier. Compare the full handles and all nine float bit patterns.
export function impactScopes(host, source, worlds) {
  const scopes=new Map();
  if (source.ledger?.tables.find(t=>t.name==='verdicts')?.capped) return scopes;
  const {verdicts,links}=bindGameplayDeals(host.deals,source);
  for (const shot of host.deaths.values()) {
    if (!shot?.impact || !shot.deal) continue;
    const [,owner,,target]=shot.impact, v=verdicts[links.get(shot.deal)];
    if (!v || v.verdict!==0 || v.owner!==shot.owner || (owner & 65535)!==v.owner
        || v.object!==target || v.sent_client_tick<1) continue;
    const contacts=worlds.get(v.owner)?.contacts;
    const scope=contacts?.get(contactKey(v.sent_client_tick-1,shot.tag,shot.impact));
    if (scope) unique(scopes,shot.deal,scope);
  }
  return scopes;
}

export async function verifyShooterSources(stage, values, host, convertFilm, deadline) {
  assert.ok(host.exporter_revision>=43 && host.engine_profile==='h1-performance-beta5-p9818-wasm-v1');
  const original=await readEnvelope(values.film,{allowClientView:true});
  assert.ok(original.recording_kind==='host' && !/^0+$/.test(original.match_id));
  const pins=JSON.parse(await readFile(values['shooter-sources'],'utf8')), verified=[];
  assert.ok(pins.length>0 && pins.length<=16 && new Set(pins.map(p=>p.player)).size===pins.length);
  for (const pin of pins) {
    const client=await readEnvelope(pin.film,{allowClientView:true});
    assert.ok(client.recording_kind==='client-view' && client.match_id===pin.match_id
      && client.match_id===original.match_id && client.recorded_own_player===pin.player
      && (client.recorded_local_player_mask & (1<<pin.player)) && client.map===original.map
      && client.tick_rate===original.tick_rate && client.protocol_revision===original.protocol_revision
      && await sha256(pin.film)===pin.sha256,'Separate shooter source differs from its verified host');
    const remaining=(deadline-performance.now())/1000;
    assert.ok(remaining>1,'Separate shooter verification timed out');
    const output=join(stage,'shooter-'+pin.player);
    const result=await convertFilm({...values,film:pin.film,output,analytics:false,reference:undefined,
      'engine-root':undefined,'shooter-sources':undefined,'client-view':true,shooterEvidence:true,
      'source-viewer-only':true,'skip-readback':true,'analytics-revision':'2','viewer-revision':'5',
      timeout:String(remaining)});
    assert.ok(result.provenance.film_sha256===pin.sha256 && result.provenance.map_sha256===host.provenance.map_sha256
      && result.provenance.wasm_sha256===host.provenance.wasm_sha256 && result.provenance.glue_sha256===host.provenance.glue_sha256);
    const raw=await readFile(pin.film);
    const accounts=recordedGameplaySources(raw,host.exporter_revision).accounts.filter(a=>a.own_player===pin.player);
    assert.ok(accounts.length<=1);
    verified.push({player:pin.player,file:join(output,'candidate','sniper.ndjson'),account:accounts[0]});
  }
  return verified;
}

export async function buildSniperKills(stage, film, encoding, hasTracks, exporterRevision, supplements=[]) {
  const host = await readEvidence(join(stage,'candidate','sniper.ndjson'));
  const extended=exporterRevision>=43 ? {excluded:host.excluded,points:new Map(),damageGraph:exporterRevision>=44} : null;
  if ((hasTracks || supplements.length) && host.deals.length) {
    const tracks = hasTracks ? JSON.parse(await readFile(join(stage,'match-tracks.json'),'utf8')).tracks : [];
    const raw = await readFile(film);
    const source=recordedGameplaySources(raw,exporterRevision), fires = new Map(), worlds = new Map();
    const divergent = new Map();
    for (const recorded of tracks) {
      // Viewer recovery does not upgrade shooter evidence for host analytics.
      const track=recorded.recovery ? {...recorded,status:'unavailable',failure:recorded.recovery.original_failure} : recorded;
      const part = track.part;
      if ((!extended && (track.status !== 'available' || !part.account_size))
          || track.envelope.recorded_own_player !== part.player
          || !(track.envelope.recorded_local_player_mask & (1 << part.player))) continue;
      let before=extended ? await verifiedPrefix(join(stage,track.id+'.h1film'),track) : Infinity;
      const resetEligible = exporterRevision >= 45 && track.failure?.reason === 'simulation_desync'
        && track.failure.played_ticks === track.envelope.ticks
        && track.failure.hash_checks === track.envelope.hash_samples && part.account_size;
      if (!before && !resetEligible) continue;
      let evidenceFile=join(stage,track.id,'candidate','sniper.ndjson');
      if (track.status==='unavailable') {
        const partial=join(stage,track.id+'.partial'), rerun=join(partial,'verified-sniper.ndjson');
        try { await access(rerun); evidenceFile=rerun; }
        catch (e) { if (e.code!=='ENOENT') throw e; evidenceFile=join(partial,'candidate','sniper.ndjson'); }
        if (resetEligible && !before && track.failure.network_refused) {
          try {
            const proof = JSON.parse(await readFile(join(partial,'sniper-prefix.json'),'utf8'));
            assert.equal(proof.source_sha256,track.source_film_sha256);
            before=proof.before;
            evidenceFile=join(partial,'sniper-prefix.ndjson');
          } catch (e) { if (e.code!=='ENOENT') throw e; }
        }
      }
      const evidence=await readEvidence(evidenceFile,before);
      unique(worlds,part.player,evidence);
      if (!part.account_size) continue;
      const account = raw.subarray(part.account_offset, part.account_offset + part.account_size);
      if (account.readInt32LE(28) !== part.player) continue;
      const hash = createHash('sha256').update(account).digest('hex');
      unique(fires, hash, evidence.fires);
      if (resetEligible) unique(divergent, hash, {track,anchors:evidence.anchors});
    }
    for (const entry of supplements) {
      const evidence=await readEvidence(entry.file);
      unique(worlds,entry.player,evidence);
      if (entry.account) {
        if (!source.accounts.some(a=>a.hash===entry.account.hash)) source.accounts.push(entry.account);
        unique(fires,entry.account.hash,evidence.fires);
      } else {
        // A Beta 5 client film may store the shooter's diagnostics only in its
        // mirrored host film. The accepted attachment binds the physical player,
        // original host bytes, map and match ID independently of the account.
        const accounts=source.accounts.filter(a=>a.own_player===entry.player && a.own_machine_slot>=0);
        if (accounts.length===1) unique(fires,accounts[0].hash,evidence.fires);
      }
    }
    if (extended) extended.points=impactScopes(host,source,worlds);
    const remote=remoteScopes(host,source,fires);
    if (divergent.size) {
      extended.resets = new Set();
      for (const [hash, data] of divergent) {
        if (!data) continue;
        const shots = [];
        for (const death of host.deaths.values()) {
          const client = remote.get(death?.deal);
          if (client?.account !== hash || !death?.impact || client.tag !== death.tag
              || client.owner !== death.owner || client.unit !== death.impact[3]) continue;
          shots.push({deal:death.deal, clock:client.clock, body:death.impact[2]});
        }
        const account=source.accounts.find(a=>a.hash===hash);
        if (!shots.length || !account) continue;
        const resets = await originalUnzoomedShots(join(stage,data.track.id+'.h1film'),
          data.track,rows(account,'client','hits'),shots,data.anchors);
        for (const deal of resets) extended.resets.add(deal);
      }
    }
    return classifySniperKills(encoding.native_analytics.combat,host.deaths,remote,extended);
  }
  return classifySniperKills(encoding.native_analytics.combat, host.deaths, new Map(),extended);
}
