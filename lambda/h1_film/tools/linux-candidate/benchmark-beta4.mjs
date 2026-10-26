import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readEnvelope, adapterFor } from '../../runtime/film.mjs';
import { selectProfile, selectExporter } from '../../runtime/profiles.mjs';
import { resolveEngine, sha256 } from '../../runtime/engine-store.mjs';

const { values } = parseArgs({ options: Object.fromEntries(
  ['film', 'map', 'native', 'measure', 'encoder', 'candidate-encoder', 'output', 'repeats', 'phase', 'cpus', 'image-id']
    .map(name => [name, { type: 'string' }])) });
assert.equal(process.platform, 'linux');
for (const name of ['film', 'map', 'native', 'measure', 'encoder', 'output']) assert.ok(values[name], `Missing --${name}`);
const repeats = Number(values.repeats ?? 3);
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
const phase = values.phase ?? 'compare';
assert.ok(['compare', 'training'].includes(phase));
const output = resolve(values.output);
await mkdir(output);
const envelope = await readEnvelope(values.film);
const profile = selectExporter(selectProfile(envelope), 10);
assert.equal(profile.port, 'beta4');
const engine = await resolveEngine(profile, process.env.H1_ENGINE_ROOT);
assert.equal((await stat(values.map)).size, envelope.map_bytes);
const filmHash = await sha256(values.film), mapHash = await sha256(values.map);
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
await mkdir(join(output, 'maps'));
await copyFile(values.map, join(output, 'maps', envelope.map + '.map'));
await copyFile(values.film, join(output, 'input.h1film'));
assert.equal(await sha256(join(output, 'input.h1film')), filmHash);
assert.equal(await sha256(join(output, 'maps', envelope.map + '.map')), mapHash);
const request = {
  ticks: envelope.ticks, players: envelope.players, map: envelope.map,
  replay_id: `h1-${filmHash}`, zstd_level: 6,
  recorded_at: envelope.created_utc ? new Date(envelope.created_utc * 1000).toISOString().replace('.000Z', 'Z') : '1970-01-01T00:00:00Z',
  source_tick_rate: profile.tick_rate, export_contract: profile.export_contract,
  transport_contract: profile.transport_contract, analytics_revision: 4,
  combat_network_recording: Boolean(envelope.network?.records), viewer_profile_revision: 5,
  source_viewer_only: true, incremental_state: true, typed_poses: true,
  analytics_context: { engine_profile: profile.id, gametype: envelope.gametype,
    map: envelope.map, map_sha256: mapHash, film_sha256: filmHash },
};
await save(join(output, 'request.json'), request);
const environment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(BLAMPC_|H1_EXPORT_|VIEWER_ARTIFACT_)/i.test(key)));
function completion(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolveExit() : reject(new Error(`Child failed: ${code ?? signal}`)));
  });
}
async function run(kind, label, capture) {
  const directory = join(output, `${label}-${kind}`);
  await mkdir(directory);
  await mkdir(join(directory, 'stats'));
  await mkdir(join(directory, 'films'));
  const env = { ...environment, BLAMPC_FILM_RING: '0', BLAMPC_FILM_KEYFRAME_TICKS: '432001',
    BLAMPC_FILM_VIEW_DELIVERED: '1', BLAMPC_STATS_DIR: join(directory, 'stats'),
    BLAMPC_FILM_DIR: join(directory, 'films'), H1_EXPORT_HANDLE: '3' };
  const command = kind === 'native' ? [values.native] : [process.execPath, engine.glue];
  command.push('--film', 'input.h1film', '--deterministic', '--ticks', String(envelope.ticks + 10), '--dump', 'NUL');
  const log = openSync(join(directory, 'playback.log'), 'wx');
  let encoder, encoderDone, simulator, sink;
  const started = performance.now();
  try {
    if (capture) sink = openSync(join(directory, 'capture.hsft'), 'wx');
    else {
      const encoderLog = openSync(join(directory, 'encoder.log'), 'wx');
      try {
        encoder = spawn(values.measure, [join(directory, 'encoder-metrics.json'),
          kind === 'native' ? (values['candidate-encoder'] ?? values.encoder) : values.encoder,
          'encode', join(output, 'request.json'), join(directory, 'products')],
        { cwd: output, env: { ...env, ...(phase === 'training' && kind === 'native'
          ? { LLVM_PROFILE_FILE: join(output, 'encoder-%m-%p.profraw') } : {}) },
          stdio: ['pipe', encoderLog, encoderLog], timeout: 1800000, killSignal: 'SIGKILL' });
      } finally { closeSync(encoderLog); }
      encoderDone = completion(encoder);
      encoderDone.catch(() => simulator?.kill('SIGKILL'));
      encoder.stdin.on('error', () => simulator?.kill('SIGKILL'));
      assert.equal(encoder.stdin._handle.setBlocking(true), 0);
      sink = encoder.stdin;
    }
    simulator = spawn(values.measure, [join(directory, 'engine-metrics.json'), ...command],
      { cwd: output, env: { ...env, ...(phase === 'training' && kind === 'native'
        ? { LLVM_PROFILE_FILE: join(output, 'native-%m-%p.profraw') } : {}) },
        stdio: ['ignore', log, log, sink], timeout: 1800000, killSignal: 'SIGKILL' });
    await completion(simulator);
    if (encoder) { encoder.stdin.end(); await encoderDone; }
  } catch (error) {
    simulator?.kill('SIGKILL');
    encoder?.kill('SIGKILL');
    if (encoderDone) await encoderDone.catch(() => {});
    throw new Error(`${directory}: ${error.message}`, { cause: error });
  } finally {
    closeSync(log);
    if (typeof sink === 'number') closeSync(sink);
  }
  const seconds = (performance.now() - started) / 1000;
  const simulation = adapterFor(profile).verifyPlayback(await readFile(join(directory, 'playback.log'), 'utf8'), envelope);
  const products = {};
  if (capture) products.stream = { sha256: await sha256(join(directory, 'capture.hsft')), bytes: (await stat(join(directory, 'capture.hsft'))).size };
  else {
    for (const name of (await readdir(join(directory, 'products'))).sort()) {
      const path = join(directory, 'products', name);
      if ((await stat(path)).isFile() && name !== 'encoding.json') products[name] = { sha256: await sha256(path), bytes: (await stat(path)).size };
    }
    assert.equal(JSON.parse(await readFile(join(directory, 'products/encoding.json'), 'utf8')).source_ticks, envelope.ticks);
  }
  const result = { kind, label, seconds, simulation, products,
    engine: JSON.parse(await readFile(join(directory, 'engine-metrics.json'), 'utf8')),
    ...(capture ? {} : { encoder: JSON.parse(await readFile(join(directory, 'encoder-metrics.json'), 'utf8')) }) };
  await save(join(directory, 'result.json'), result);
  console.log(JSON.stringify({ kind, label, seconds }));
  return result;
}
const parity = [await run('wasm', 'parity', true), await run('native', 'parity', true)];
assert.deepEqual(parity[0].products, parity[1].products, 'Native export differs from the released WASM');
const runs = [];
let expected;
for (let iteration = 0; iteration <= (phase === 'training' ? 0 : repeats); iteration++) {
  for (const kind of iteration % 2 ? ['native', 'wasm'] : ['wasm', 'native']) {
    const result = await run(kind, iteration ? `run-${iteration}` : 'warmup', false);
    expected ??= result.products;
    assert.deepEqual(result.products, expected, 'Encoded products differ');
    if (iteration) runs.push(result);
  }
}
await save(join(output, 'summary.json'), {
  schema: 'halospawns.h1Beta4LinuxBenchmark.v1', phase, cpus: Number(values.cpus), memory_mib: 3008,
  image_id: values['image-id'], scope: 'Offline simulation, export, encoding and analytics; excludes staging, Lambda startup, Python finalization and S3/API.',
  envelope, film_sha256: filmHash, map_sha256: mapHash,
  native_sha256: await sha256(values.native), ...engine.hashes,
  encoder_sha256: await sha256(values.encoder), candidate_encoder_sha256: await sha256(values['candidate-encoder'] ?? values.encoder),
  parity, runs });
