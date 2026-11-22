import assert from 'node:assert/strict';
import test from 'node:test';
import {unsupportedClientBuild, compatibleClientBuild, hostForEmptyClientBuild, playbackBuildMatches} from '../runtime/client-build.mjs';
import {profileById,BUILD_MATCHING,selectProfile,resolveMap} from '../runtime/profiles.mjs';
const profile=profileById('h1-performance-beta6-p9839-wasm-v1'),rule=BUILD_MATCHING[profile.id];
const envelope={format:3,protocol_revision:9839,tick_rate:120,recording_kind:'client-view',build:'2026-11-08 - ec92e0bb'};

test('an unlabeled 120 Hz Beta 8 client requires its verified host and the new recipe', () => {
  const beta8=profileById('h1-performance-beta8-p9848-wasm-v1');
  const host={format:3,protocol_revision:9848,tick_rate:120,map:'dread',match_id:'0123456789abcdef'};
  const report={engine_profile:beta8.id,exporter_revision:49,provenance:{engine_source:beta8.source},simulation:{hash_checks:440}};
  const client={...host,build:'',recording_kind:'client-view',recorded_own_player:1,recorded_local_player_mask:2,hash_samples:440};
  const playback={embeddedClient:true,exporterRevision:49,verifiedClientHost:hostForEmptyClientBuild(report,host,1)};
  assert.equal(selectProfile(client,undefined,undefined,playback).id,beta8.id);
  assert.equal(hostForEmptyClientBuild({...report,exporter_revision:48},host,1),undefined);
  assert.throws(()=>selectProfile(client,undefined,undefined,{...playback,exporterRevision:48}));
  for(const change of [{tick_rate:30},{match_id:'0000000000000000'},{recorded_local_player_mask:1},{recorded_own_player:0}])
    assert.throws(()=>selectProfile({...client,...change},undefined,undefined,playback));
});

test('alternate options require the engine to read both recorded texts', () => {
  const client={text_settings_options_bytes:13368,gametype:'TEAM SLAYER 50'};
  const build='[film] RECORDED BY ANOTHER BUILD -- "unnamed", wire revision 9848 (this build is 9848). Its settings were read from their TEXT, so it replays exactly';
  const variant='[film] gametype: the film\'s own record of "TEAM SLAYER 50" (from its text)';
  const log=build+'\n'+variant+'\n';
  assert.equal(playbackBuildMatches(log,client),true);
  for(const bad of [build,variant,log.replace('9848','9839'),log.replace('from its text','raw'),log+build])
    assert.equal(playbackBuildMatches(bad,client),false);
  assert.equal(playbackBuildMatches(log,{}),false);
});

test('a verified Beta 8 host can select its pinned engine for its own unlabeled 30 Hz client', () => {
  const beta8 = profileById('h1-performance-beta8-p9848-wasm-v1');
  const host = {format:3, protocol_revision:9848, tick_rate:30, map:'prisoner', match_id:'0123456789abcdef'};
  const report = {engine_profile:beta8.id, exporter_revision:47, provenance:{engine_source:beta8.source}, simulation:{hash_checks:97}};
  const film = {...host, map_bytes:1024, recording_kind:'client-view', build:'', recorded_own_player:0,
    recorded_local_player_mask:1, hash_samples:97};
  const playback = {embeddedClient:true, exporterRevision:47, verifiedClientHost:hostForEmptyClientBuild(report,host,0)};
  const selected = selectProfile(film,undefined,undefined,playback);
  assert.equal(selected.id,beta8.id);
  assert.equal(selected.tick_rate,30);
  const map = {engine_profile:beta8.id, scenario:'prisoner', size_bytes:1024, sha256:'a'.repeat(64)};
  assert.deepEqual(resolveMap(selected,film,{schema:'halospawns.h1FilmMapCatalog.v1',maps:[map]},undefined,playback),map);
  assert.equal(film.build,'');
  for (const opts of [{},{...playback,embeddedClient:false},{...playback,verifiedClientHost:undefined},{...playback,exporterRevision:46}])
    assert.throws(() => selectProfile(film,undefined,undefined,opts),/Unsupported film engine/);
  for (const change of [{recording_kind:'host'},{build:' '},{build:'2026-11-14 - badc0ffe'},{tick_rate:120},
    {format:2},{protocol_revision:9844},{match_id:'0000000000000000'},{map:'chillout'},{recorded_own_player:1},
    {recorded_local_player_mask:0},{hash_samples:0}])
    assert.throws(() => selectProfile({...film,...change},undefined,undefined,playback),/Unsupported film engine/);
  for (const change of [{exporter_revision:46},{engine_profile:profile.id},{provenance:{engine_source:profile.source}},{simulation:undefined}])
    assert.equal(hostForEmptyClientBuild({...report,...change},host,0),undefined);
  for (const change of [{match_id:'0000000000000000'},{tick_rate:120},{format:2},{protocol_revision:9844}])
    assert.equal(hostForEmptyClientBuild(report,{...host,...change},0),undefined);
});

test('an unsupported embedded build is explicit and never claims a simulated world',()=>{
  assert.deepEqual(unsupportedClientBuild(envelope,profile,22,rule),{reason:'unsupported_build',
    recorded_build:envelope.build,format:3,protocol_revision:9839,tick_rate:120});
  assert.throws(()=>selectProfile(envelope),/Unsupported film engine profile/);
  for(const revision of [14,15,16,17,18,19,20,21])assert.equal(unsupportedClientBuild(envelope,profile,revision,rule),null);
  for(const build of [profile.build,'Windows - 86c52285',profile.source.git_commit])
    assert.equal(unsupportedClientBuild({...envelope,build},profile,22,rule),null);
  for(const change of [{format:2},{protocol_revision:9840},{tick_rate:30},{recording_kind:'authoritative'},
    {build:''},{build:'a'.repeat(64)},{build:'bad\nlabel'},{build:'non-ascii-é'}])
    assert.equal(unsupportedClientBuild({...envelope,...change},profile,22,rule),null);
  assert.equal(unsupportedClientBuild(envelope,{...profile,id:'another-engine'},22,rule),null);
});

test('the exact authorized client identity routes through exporter 23 without rewriting source identity',()=>{
  const playback={embeddedClient:true,exporterRevision:23},before=structuredClone(envelope);
  assert.equal(compatibleClientBuild(envelope,profile,23),true);
  assert.equal(selectProfile(envelope,undefined,undefined,playback),profile);
  assert.equal(unsupportedClientBuild(envelope,profile,23,rule),null);
  const film={...envelope,map:'dread',map_bytes:2048};
  const map={engine_profile:profile.id,scenario:'dread',size_bytes:2048,sha256:'a'.repeat(64)};
  const catalog={schema:'halospawns.h1FilmMapCatalog.v1',maps:[map]};
  assert.deepEqual(resolveMap(profile,film,catalog,undefined,playback),map);
  assert.throws(()=>resolveMap(profile,film,{...catalog,maps:[{...map,size_bytes:2049}]},undefined,playback),/map unavailable/);
  assert.deepEqual(envelope,before);
  // Intake, hosts, separate clients and every older recipe retain strict matching.
  for(const options of [{},{embeddedClient:false,exporterRevision:23},
    {embeddedClient:true},{embeddedClient:true,exporterRevision:22}])
    assert.throws(()=>selectProfile(envelope,undefined,undefined,options),/Unsupported film engine profile/);
  for(const revision of [14,21,22,undefined,'23',23.5])assert.equal(compatibleClientBuild(envelope,profile,revision),false);
  for(const change of [{build:'Windows - ec92e0bb'},{build:'2026-11-08 - ec92e0bc'},
    {build:'2026-11-08 - ec92e0bb - modified'},{recording_kind:'host'},
    {format:2},{protocol_revision:9818},{tick_rate:30}])
    assert.throws(()=>selectProfile({...envelope,...change},undefined,undefined,playback),/Unsupported film engine profile/);
  for(const change of [{id:'another-engine'},{source:{...profile.source,git_commit:'a'.repeat(40)}},
    {protocol_revision:9818},{format:2},{tick_rate:30}])
    assert.equal(compatibleClientBuild(envelope,{...profile,...change},23),false);
  assert.equal(unsupportedClientBuild({...envelope,build:'2026-11-08 - deadbeef'},profile,23,rule).reason,'unsupported_build');
  assert.equal(unsupportedClientBuild(envelope,profile,22,rule).reason,'unsupported_build');
});
