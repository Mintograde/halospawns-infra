// Isolate simulator/export cost without encoder backpressure. Hashing and CPU
// profiling add diagnostic work; these timings are not worker latency.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hashCanonicalStream } from './canonical-transport.mjs';
import { readEnvelope, adapterFor } from '../runtime/film.mjs';
import { selectProfile, selectExporter } from '../runtime/profiles.mjs';
import { resolveEngine, sha256 } from '../runtime/engine-store.mjs';

const { values } = parseArgs({ options: {
  film: { type: 'string' }, map: { type: 'string' }, output: { type: 'string' },
  optimized: { type: 'boolean', default: false },
  'cpu-profile': { type: 'boolean', default: false },
  'aot-module': { type: 'string' },
  'hash-export': { type: 'boolean', default: false },
  'exporter-revision': { type: 'string', default: '1' },
} });
assert.ok(values.film && values.map && values.output);
assert.equal(process.platform, 'linux');
const envelope = await readEnvelope(values.film);
const profile = selectExporter(selectProfile(envelope), Number(values['exporter-revision']));
const engine = await resolveEngine(profile, process.env.H1_ENGINE_ROOT);
assert.match(envelope.map, /^[a-z0-9_-]+$/i);
assert.equal((await stat(values.map)).size, envelope.map_bytes, 'Map size differs from recorded cache');
const filmHash = await sha256(values.film), mapHash = await sha256(values.map);
const work = await mkdtemp(join(tmpdir(), 'h1-engine-bench-'));
const log = openSync(join(work, 'playback.log'), 'wx');
const sink = openSync('/dev/null', 'w');
try {
  await mkdir(join(work, 'maps'));
  await mkdir(join(work, 'stats'));
  await mkdir(join(work, 'films'));
  await copyFile(values.film, join(work, 'input.h1film'));
  await copyFile(values.map, join(work, 'maps', `${envelope.map}.map`));
  assert.equal(await sha256(join(work, 'input.h1film')), filmHash, 'Film changed while staging');
  assert.equal(await sha256(join(work, 'maps', `${envelope.map}.map`)), mapHash, 'Map changed while staging');
  const flags = values.optimized ? ['--no-liftoff'] : [];
  if (values['cpu-profile']) flags.push('--cpu-prof', `--cpu-prof-dir=${work}`, '--cpu-prof-name=engine.cpuprofile');
  if (values['aot-module']) flags.push('--import',
    fileURLToPath(new URL('./wasm2c/preload.mjs', import.meta.url)));
  const started = performance.now();
  const child = spawn(process.execPath, [...flags, '--import',
    fileURLToPath(new URL('../runtime/metrics.mjs', import.meta.url)), engine.glue,
    '--film', 'input.h1film', '--deterministic', '--ticks', String(envelope.ticks + 10), '--dump', 'NUL'], {
    cwd: work, stdio: ['ignore', log, log, values['hash-export'] ? 'pipe' : sink], timeout: 180000, killSignal: 'SIGKILL',
    env: { ...process.env, BLAMPC_FILM_RING: '0', BLAMPC_FILM_KEYFRAME_TICKS: '432001',
      BLAMPC_FILM_VIEW_DELIVERED: '1', BLAMPC_STATS_DIR: join(work, 'stats'),
      BLAMPC_FILM_DIR: join(work, 'films'), H1_EXPORT_HANDLE: '3',
      H1_EXPORT_METRICS: join(work, 'metrics.json'),
      ...(values['aot-module'] ? { H1_AOT_MODULE: values['aot-module'], H1_AOT_OFFLINE: '1' } : {}) },
  });
  const drained = values['hash-export']
    ? hashCanonicalStream(child.stdio[3], profile.transport_contract ?? profile.export_contract)
    : Promise.resolve({});
  drained.catch(() => child.kill('SIGKILL'));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0, await readFile(join(work, 'playback.log'), 'utf8'));
  const proof = await drained;
  const elapsed = (performance.now() - started) / 1000;
  assert.equal(await sha256(join(work, 'input.h1film')), filmHash, 'Staged film changed');
  assert.equal(await sha256(join(work, 'maps', `${envelope.map}.map`)), mapHash, 'Staged map changed');
  const report = { wall_seconds: elapsed, flags, exporter_revision: profile.exporter_revision,
    simulation: adapterFor(profile).verifyPlayback(await readFile(join(work, 'playback.log'), 'utf8'), envelope),
    resources: JSON.parse(await readFile(join(work, 'metrics.json'), 'utf8')),
    film_sha256: filmHash, map_sha256: mapHash, ...engine.hashes,
    ...(values['aot-module'] ? { execution_runtime: 'offline-wasm2c-experiment',
      aot_module_sha256: await sha256(values['aot-module']) } : {}),
    ...proof };
  await writeFile(values.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (values['cpu-profile']) await copyFile(join(work, 'engine.cpuprofile'), values.output + '.cpuprofile');
  console.log(JSON.stringify(report));
} finally {
  closeSync(log);
  closeSync(sink);
  await rm(work, { recursive: true });
}
