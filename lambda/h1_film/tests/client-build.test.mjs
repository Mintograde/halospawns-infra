import assert from 'node:assert/strict';
import test from 'node:test';
import {unsupportedClientBuild} from '../runtime/client-build.mjs';
import {profileById,BUILD_MATCHING,selectProfile} from '../runtime/profiles.mjs';
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
