import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {readEnvelope} from '../../runtime/film.mjs';
import {inspectMatchFilm} from '../../runtime/match-film.mjs';
import {recordedGameplaySources} from '../../runtime/gameplay-source.mjs';

const {values} = parseArgs({options:{films:{type:'string'},maps:{type:'string'},out:{type:'string'},
  family:{type:'string'},extra:{type:'string',multiple:true,default:[]},exploration:{type:'string'}}});
assert(values.films && values.maps && values.out && ['beta5','beta6'].includes(values.family),
  'Pass --films <directory> --maps <directory> --out <json> --family beta5|beta6 [--extra <film>] [--exploration <json>]');
assert(!fs.existsSync(values.out),'Use a new inventory filename');
const exploration = values.exploration ? JSON.parse(fs.readFileSync(values.exploration)) : [];
const explored = new Set(exploration.flatMap(c => [c.host_sha256,c.match_id].filter(Boolean)));
const files = fs.readdirSync(values.films,{recursive:true}).filter(n => n.endsWith('.h1film'))
  .map(n => path.join(values.films,n)).concat(values.extra);
const hash = b => createHash('sha256').update(b).digest('hex');
const unique = new Map(), skipped = [];
for (const film of files) {
  const fd = fs.openSync(film,'r'), h = Buffer.alloc(72); let length;
  try { length = fs.readSync(fd,h,0,h.length,0); } finally { fs.closeSync(fd); }
  const beta6 = values.family === 'beta6';
  if (length !== h.length || h.readUInt32LE(0) !== 0x314d4c46
    || h.readUInt32LE(4) !== (beta6 ? 3 : 2) || h.readUInt32LE(8) !== (beta6 ? 9839 : 9818)) continue;
  if (!beta6 && (h.readUInt32LE(28) & 64)) continue; // Original client worlds are not authoritative hosts.
  try {
    const envelope = await readEnvelope(film), raw = fs.readFileSync(film);
    const match = beta6 ? inspectMatchFilm(raw) : null;
    const host = match ? raw.subarray(match.host_offset,match.host_offset + match.host_size) : raw;
    const matchId = host.readBigUInt64LE(488).toString(16).padStart(16,'0');
    const sources = recordedGameplaySources(raw), hostSha = hash(host);
    const accounts = sources.accounts.map(a => ({player:a.own_player,machine:a.own_machine_slot,
      pulls:a.tables.find(t => t.name === 'pulls')?.count,capped:a.tables.filter(t => t.capped).map(t => t.name)}));
    assert(/^[a-zA-Z0-9_ .-]+$/.test(envelope.map) && !envelope.map.includes('..'),'Unsafe map name');
    const map = path.join(values.maps,envelope.map + '.map');
    if (!fs.existsSync(map)) { skipped.push({film,reason:'missing_map'}); continue; }
    const item = {film:path.resolve(film),family:values.family,source_sha256:hash(raw),host_sha256:hostSha,
      match_id:matchId,envelope,map:path.resolve(map),accounts,
      split:explored.has(hostSha) || explored.has(matchId) ? 'exploration' : 'validation'};
    const old = unique.get(hostSha), usable = a => a.filter(x => x.pulls && !x.capped.includes('pulls')).length;
    if (!old || usable(accounts) > usable(old.accounts)
      || (usable(accounts) === usable(old.accounts) && values.extra.includes(film))) unique.set(hostSha,item);
  } catch (e) { skipped.push({film,reason:e.message}); }
}
const cases = [...unique.values()].sort((a,b) => a.host_sha256.localeCompare(b.host_sha256));
fs.writeFileSync(values.out,JSON.stringify({family:values.family,cases,skipped},null,2) + '\n');
console.log(JSON.stringify({cases:cases.length,ticks:cases.reduce((n,c) => n + c.envelope.ticks,0),
  accounts:cases.reduce((n,c) => n + c.accounts.length,0),skipped}));
