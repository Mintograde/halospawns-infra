import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {linkedPull, pairShotVerdicts} from './diagnostics-codec.mjs';
import {bindGameplayDeals, recordedGameplaySources, rows} from './gameplay-source.mjs';

const SNIPER = 'weapons/sniper rifle/sniper rifle';
const scopeNames = ['unknown', 'unzoomed', 'zoomed'];
const fireKey = (clock, owner, tag) => `${clock}/${owner}/${tag}`;

function unique(index, key, value) {
  index.set(key, index.has(key) ? null : value);
}

async function readEvidence(file) {
  assert.ok((await stat(file)).size <= 128 * 1024 * 1024, 'Oversized sniper evidence');
  const fires = new Map(), deaths = new Map(), deals = [];
  for await (const line of createInterface({input: createReadStream(file), crlfDelay: Infinity})) {
    const {source_tick, events} = JSON.parse(line);
    for (const event of events) {
      const [kind, a, b, c, d, e, f, killer, victim] = event;
      if (kind === 0) unique(fires, fireKey(a,b,c), d);
      else if (kind === 1) unique(deaths, `${source_tick}/${a}`,
        {scope:b, deal:c, tag:d, owner:e, unit:f, killer, victim});
      else {
        assert.equal(kind, 2);
        deals.push({kind:3, clock:a, deal:b, physical:c, unit:d});
      }
    }
  }
  return {fires, deaths, deals};
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
      unique(byVerdict, v.index, {scope:fires.get(key), tag:pull.weapon_tag, owner:v.owner, unit:v.object});
    }
  }
  for (const [deal, verdictIndex] of links) scopes.set(deal, byVerdict.get(verdictIndex));
  return scopes;
}

export function classifySniperKills(combat, observations, remote) {
  const rifles = new Set(combat.weapons.filter(w => w.category === 'weapon'
    && w.tag_path.toLowerCase().replaceAll('\\','/') === SNIPER).map(w => w.weapon_id));
  const kills = [];
  let previousTick = -1, offset = 0;
  for (const death of combat.deaths) {
    if (death.source_tick !== previousTick) { previousTick = death.source_tick; offset = 0; }
    const key = `${death.source_tick}/${offset++}`;
    if (death.kind !== 'kill' || !rifles.has(death.weapon_id)) continue;
    const shot = observations.get(key);
    assert.ok(shot && shot.killer === death.killer_slot && shot.victim === death.victim_slot,
      'Sniper observation differs from combat death');
    let scope = shot.scope, method = 'projectile';
    if (shot.deal) {
      const client = remote.get(shot.deal);
      scope = client && client.tag === shot.tag && client.unit === shot.unit && client.owner === shot.owner
        ? client.scope : 0;
      method = 'client_pull';
    }
    const zoom = scopeNames[scope] ?? 'unknown';
    kills.push({event_index:death.event_index, zoom, method:zoom === 'unknown' ? 'unavailable' : method});
  }
  return {schema:'halospawns.h1SniperKills.v1', kills};
}

export async function buildSniperKills(stage, film, encoding, hasTracks, exporterRevision) {
  const host = await readEvidence(join(stage,'candidate','sniper.ndjson'));
  const remote = new Map();
  if (hasTracks && host.deals.length) {
    const tracks = JSON.parse(await readFile(join(stage,'match-tracks.json'),'utf8')).tracks;
    const raw = await readFile(film);
    const fires = new Map();
    for (const track of tracks) {
      const part = track.part;
      if (track.status !== 'available' || !part.account_size
          || track.envelope.recorded_own_player !== part.player
          || !(track.envelope.recorded_local_player_mask & (1 << part.player))) continue;
      const account = raw.subarray(part.account_offset, part.account_offset + part.account_size);
      if (account.readInt32LE(28) !== part.player) continue;
      const hash = createHash('sha256').update(account).digest('hex');
      unique(fires, hash, (await readEvidence(join(stage,track.id,'candidate','sniper.ndjson'))).fires);
    }
    return classifySniperKills(encoding.native_analytics.combat, host.deaths,
      remoteScopes(host, recordedGameplaySources(raw, exporterRevision), fires));
  }
  return classifySniperKills(encoding.native_analytics.combat, host.deaths, remote);
}
