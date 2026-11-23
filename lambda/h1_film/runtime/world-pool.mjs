import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {connect} from 'node:net';
import {createReadStream} from 'node:fs';
import {dirname, join} from 'node:path';
import {readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {orderedPool} from './ordered-pool.mjs';
import {fnv1a} from './format3-codec.mjs';
import {sha256} from './engine-store.mjs';
import {sourceRateKey, sourceReplayName} from './tick-rates.mjs';
import {EMPTY_CLIENT_BUILD_EXPORTER} from './client-build.mjs';

// The trusted Python parent owns the socket, Lambda credentials and S3 reads.
// Each response names a private directory containing one checked fragment.
async function requestWorld(socket, index, simulation, deadline) {
  const remaining = Math.floor(deadline - performance.now());
  assert.ok(remaining > 0, 'Match conversion timed out');
  const client = connect(socket);
  const timer = setTimeout(() => client.destroy(new Error('World worker timed out')), remaining);
  try {
    client.write(JSON.stringify({index, simulation:simulation ?? null}) + '\n');
    let response = '';
    for await (const chunk of client) {
      response += chunk;
      assert.ok(response.length <= 128, 'Invalid world worker response');
    }
    const token = JSON.parse(response);
    if (token === null) return null;
    assert.match(token, /^[0-9a-f]{32}$/);
    return join(dirname(socket), token);
  } finally {
    clearTimeout(timer);
    client.destroy();
  }
}

async function checkWorld(folder, bytes, part, host) {
  const id = 'client-' + part.index;
  const track = JSON.parse(await readFile(join(folder, 'track.json'), 'utf8'));
  assert.equal(track.id, id);
  assert.deepEqual(track.part, part);
  assert.equal(track.envelope.recorded_own_player, part.player);
  assert.equal(track.envelope.match_id, part.envelope.match_id);
  assert.equal(track.envelope.ticks, part.envelope.frame_count);
  for (const key of ['map', 'format', 'protocol_revision', 'tick_rate'])
    assert.equal(track.envelope[key], part.envelope[key]);
  const restored = join(folder, id + '.h1film');
  if (part.rest.flags & 1) {
    assert.equal((await stat(restored)).size, part.rest.whole_size);
    const digest = createHash('sha256');
    let checksum = 0x811c9dc5;
    for await (const chunk of createReadStream(restored, {highWaterMark:1024*1024})) {
      digest.update(chunk);
      if (part.rest.fnv1a) checksum = fnv1a(chunk, checksum);
    }
    assert.equal(digest.digest('hex'), track.source_film_sha256);
    if (part.rest.fnv1a) assert.equal(checksum, part.rest.fnv1a);
  } else {
    const source = bytes.subarray(part.offset, part.offset + part.size);
    assert.equal(source.length, part.rest.whole_size);
    assert.equal(createHash('sha256').update(source).digest('hex'), track.source_film_sha256, 'Client source differs');
    await writeFile(restored, source, {flag:'wx'});
  }
  if (track.status === 'unavailable') {
    assert.ok(host.exporter_revision >= 16 && track.failure && !track.world);
    return track;
  }
  const directory = id + (track.recovery ? '-recovered' : '');
  const report = JSON.parse(await readFile(join(folder, directory, 'report.json'), 'utf8'));
  assert.equal(report.status, 'simulation_and_encoding_verified');
  assert.equal(report.engine_profile, host.engine_profile);
  assert.equal(report.exporter_revision, host.exporter_revision);
  assert.deepEqual(report.envelope, track.envelope);
  assert.equal(report.provenance.film_sha256, track.source_film_sha256);
  for (const key of ['map_sha256','wasm_sha256','glue_sha256','encoder_sha256'])
    assert.equal(report.provenance[key], host.provenance[key]);
  assert.deepEqual(report.simulation, track.verification);
  assert.deepEqual(report.pov_recovery, track.recovery);
  assert.equal(report.simulation.hash_checks, track.envelope.hash_samples);
  assert.equal(report.simulation.played_ticks, track.envelope.ticks);
  assert.equal(report.simulation.hash_mismatches, 0);
  assert.equal(report.simulation.seed_mismatches, 0);
  assert.equal(track.world, directory + '/candidate/' + sourceReplayName(track.envelope.tick_rate));
  const world = report.encoding[sourceRateKey(track.envelope.tick_rate)];
  assert.equal(world.tickCount, track.envelope.ticks);
  assert.equal((await stat(join(folder, track.world))).size, world.sizeBytes);
  assert.equal(track.world_sha256, world.sha256);
  assert.equal(await sha256(join(folder, track.world)), world.sha256);
  return track;
}

export async function remoteMatchTracks({bytes, match, report, stage, socket, hostReady, deadline, concurrency, local}) {
  const needsHost = part => report.exporter_revision >= EMPTY_CLIENT_BUILD_EXPORTER && !part.envelope.build;
  // Let identified clients run while the host is playing even in mixed matches.
  const ordered = [...match.parts].sort((a,b) => Number(needsHost(a)) - Number(needsHost(b)));
  const tracks = new Array(ordered.length);
  await orderedPool(ordered, concurrency, async part => {
    if (needsHost(part) && hostReady && !await hostReady) throw new Error('Host playback failed');
    const id = 'client-' + part.index;
    let folder, track, names;
    try {
      folder = await requestWorld(socket, part.index, needsHost(part) ? report.simulation : null, deadline);
      if (!folder) return;
      track = await checkWorld(folder, bytes, part, report);
      names = (await readdir(folder)).filter(name => name !== 'track.json');
      for (const name of names) assert.ok([id, id+'.h1film', id+'.partial', id+'-recovered', id+'-recovered.partial'].includes(name));
    } catch (error) {
      if (folder) await rm(folder, {recursive:true, force:true});
      console.warn('Discarded remote world %d (%s), using local conversion', part.index, error.name);
      return;
    }
    for (const name of names) await rename(join(folder, name), join(stage, name));
    tracks[part.index] = track;
  });
  const remote = tracks.filter(Boolean).length;
  report.world_pool = {remote, local:match.parts.length - remote};
  // Fall back sequentially so a throttled pool cannot overload one Lambda.
  for (const part of match.parts) {
    if (tracks[part.index]) continue;
    if (hostReady && !await hostReady) throw new Error('Host playback failed');
    tracks[part.index] = await local(part);
  }
  return tracks;
}
