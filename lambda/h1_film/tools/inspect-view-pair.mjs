// Offline discovery only: this does not validate playback or authorize ingestion.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {selectProfile} from '../runtime/profiles.mjs';

export function inspectViewIdentity(bytes) {
  assert.ok(bytes.length >= 504 && bytes.length <= 512*1024*1024, 'Invalid film size');
  const u = offset => bytes.readUInt32LE(offset);
  assert.ok(u(0) === 0x314d4c46 && u(4) === 2 && u(8) === 9818 && u(12) === 120 && u(64) === 504,
    'Expected Beta 5 film');
  assert.equal(u(28) & ~123, 0, 'Unknown film flags');
  assert.equal(u(28) & 10, 10, 'Expected network UNIVERSAL recording');
  assert.ok(u(44)>0 && u(44)<=432000, 'Invalid frame count');
  const text = (a,b) => bytes.subarray(a,b).toString('utf8').split('\0')[0];
  const profile = selectProfile({format:2,protocol_revision:9818,tick_rate:120,build:text(384,448)});
  const matchId = bytes.subarray(488,496).readBigUInt64LE().toString(16).padStart(16,'0');
  assert.notEqual(matchId,'0000000000000000','Missing match identity');
  return {sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length,
    engine_profile:profile.id,match_id:matchId,map:text(128,256),
    recording_kind:u(28)&64?'client-view':'host',frame_count:u(44),first_update:u(40),tick_rate:120};
}

export function inspectViewPair(hostBytes, clientBytes) {
  const host=inspectViewIdentity(hostBytes), client=inspectViewIdentity(clientBytes);
  assert.equal(host.recording_kind,'host','First input must be the host recording');
  assert.equal(client.recording_kind,'client-view','Second input must be the client view');
  for(const key of ['engine_profile','match_id','map']) assert.equal(client[key],host[key],`Pair ${key} mismatch`);
  return {schema:'halospawns.h1ViewPairInspection.v1',playback_validated:false,host,client};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length,4,'Usage: node inspect-view-pair.mjs HOST.h1film CLIENT-view.h1film');
  const inputs=await Promise.all(process.argv.slice(2).map(path=>readFile(path)));
  console.log(JSON.stringify(inspectViewPair(...inputs),null,2));
}
