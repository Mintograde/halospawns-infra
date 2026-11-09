import assert from 'node:assert/strict';
import test from 'node:test';
import {unsupportedClientBuild,compatibleClientBuild} from '../runtime/client-build.mjs';
import {profileById,BUILD_MATCHING,selectProfile,resolveMap} from '../runtime/profiles.mjs';
const profile=profileById('h1-performance-beta6-p9839-wasm-v1'),rule=BUILD_MATCHING[profile.id];
const envelope={format:3,protocol_revision:9839,tick_rate:120,recording_kind:'client-view',build:'2026-11-08 - ec92e0bb'};

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
