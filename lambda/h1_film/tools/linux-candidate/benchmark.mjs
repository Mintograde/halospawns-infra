import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyPlayback } from '../../runtime/adapters/film-v2-120.mjs';

const { values } = parseArgs({ options: Object.fromEntries(
  ['mode', 'native', 'wasm', 'encoder', 'candidate-encoder', 'measure', 'maps', 'fixtures', 'output', 'only', 'repeats', 'cpus']
    .map(name => [name, { type: 'string' }])) });
for (const name of ['mode', 'native', 'measure', 'maps', 'output']) assert.ok(values[name], `Missing --${name}`);
assert.equal(process.platform, 'linux');
for (const name of ['native', 'wasm', 'encoder', 'candidate-encoder', 'measure', 'maps', 'fixtures', 'output']) {
  if (values[name]) values[name] = resolve(values[name]);
}
const cases = [
  { name: 'smoke', map: 'prisoner', players: 4, ticks: 1200, seed: 1234 },
  { name: 'prisoner-movement', map: 'prisoner', players: 2, ticks: 36000, seed: 1234 },
  { name: 'chillout-combat', map: 'chillout', players: 4, ticks: 72000, seed: 4567 },
  { name: 'dammy-combat', map: 'dammy', players: 4, ticks: 72000, seed: 8910 },
  { name: 'wizard-training', map: 'wizard', players: 4, ticks: 18000, seed: 113, training: true },
  { name: 'hangemhigh-training', map: 'hangemhigh', players: 4, ticks: 18000, seed: 991, training: true },
].filter(item => values.only ? item.name === values.only : item.name !== 'smoke' && !item.training);
assert.ok(cases.length, 'Unknown fixture');
await mkdir(values.output);
const environment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(BLAMPC_|H1_EXPORT_|VIEWER_ARTIFACT_)/i.test(key)));
Object.assign(environment, { BLAMPC_LOG_FILE: '0', BLAMPC_FILM_RING: '0',
  BLAMPC_FILM_KEYFRAME_TICKS: '432001', BLAMPC_FILM_VIEW_DELIVERED: '1' });
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function workspace(path) {
  await mkdir(path);
  await mkdir(join(path, 'films'));
  await mkdir(join(path, 'stats'));
  await symlink(values.maps, join(path, 'maps'));
}
function completion(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolveExit();
      else reject(new Error(`Child failed: ${code ?? signal}`));
    });
  });
}
function launch(command, args, cwd, log, output) {
  const descriptor = openSync(log, 'wx');
  try {
    return spawn(command, args, { cwd, env: { ...environment,
      BLAMPC_FILM_DIR: join(cwd, 'films'), BLAMPC_STATS_DIR: join(cwd, 'stats'),
      ...(output === undefined ? {} : { H1_EXPORT_HANDLE: '3' }) },
    stdio: output === undefined ? ['ignore', descriptor, descriptor] : ['ignore', descriptor, descriptor, output],
    timeout: 1800000, killSignal: 'SIGKILL' });
  } finally { closeSync(descriptor); }
}
async function envelope(path) {
  const film = await readFile(path);
  assert.ok(film.length >= 480 && film.length <= 512 * 1024 * 1024);
  const word = offset => film.readUInt32LE(offset);
  assert.equal(word(0), 0x314d4c46);
  assert.equal(word(4), 2);
  assert.equal(word(8), 9606, 'This experiment only accepts the pinned source protocol');
  assert.equal(word(12), 120);
  assert.equal(word(20), 32);
  assert.equal(word(24), 4);
  assert.equal(word(64), 480);
  assert.equal(word(28) & ~1, 0, 'Synthetic offline films only');
  assert.ok(word(44) > 0 && word(44) <= 432000);
  assert.ok(word(100) > 0 && word(100) <= 4);
  assert.ok(word(68) >= 480 && word(68) < word(48) && word(48) <= film.length - 8);
  assert.equal(word(word(48)), 0x314c5254);
  const samples = word(word(48) + 4);
  assert.ok(samples > 0 && word(48) + 8 + samples * 16 <= film.length);
  assert.ok([1, 2].includes(word(56)));
  const text = (start, stop) => film.subarray(start, stop).toString('utf8').split('\0')[0];
  const map = text(128, 256);
  assert.match(map, /^[a-z0-9_-]+$/);
  assert.equal(text(384, 448), 'UNIVERSAL Only - 2026-10-20 - 865d1b3d');
  return { format: 2, protocol_revision: word(8), ticks: word(44), players: word(100),
    map, map_bytes: word(60), hash_samples: samples, tick_rate: 120 };
}
function inputScript(item) {
  const rows = [];
  for (let tick = 0; tick < item.ticks; tick += 30) {
    for (let seat = 0; seat < item.players; seat++) {
      const phase = Math.floor(tick / 30) + seat * 7;
      const forward = phase % 40 < 32 ? 24000 : -24000;
      const strafe = phase % 24 < 12 ? 14000 : -14000;
      const yaw = phase % 32 < 16 ? 6000 : -6000;
      const buttons = 0x80 | (phase % 19 === 0 ? 1 : 0) | (phase % 23 === 0 ? 0x40 : 0)
        | (phase % 17 === 0 ? 2 : 0) | (phase % 29 === 0 ? 0x4000 : 0)
        | (phase % 13 === 0 ? 0x400 : 0);
      rows.push(`${tick} ${seat} ${strafe} ${forward} ${yaw} 0 ${buttons.toString(16).padStart(4, '0')}`);
    }
  }
  return rows.join('\n') + '\n';
}
const results = [];
if (values.mode === 'record') {
  for (const item of cases) {
    const cwd = join(values.output, item.name);
    await workspace(cwd);
    await writeFile(join(cwd, 'input.txt'), inputScript(item), { flag: 'wx' });
    await completion(launch(values.measure, [join(cwd, 'record-metrics.json'), values.native,
      '--map', item.map, '--players', String(item.players), '--gametype', 'ts50', '--score', '1000',
      '--deterministic', '--ticks', String(item.ticks), '--seed', String(item.seed), '--input', 'input.txt',
      '--film-record', 'input.h1film'], cwd, join(cwd, 'record.log')));
    const header = await envelope(join(cwd, 'input.h1film'));
    assert.equal(header.ticks, item.ticks);
    assert.equal(header.map_bytes, (await stat(join(values.maps, item.map + '.map'))).size);
    const result = { ...item, envelope: header, film_sha256: await digest(join(cwd, 'input.h1film')),
      input_sha256: await digest(join(cwd, 'input.txt')), map_sha256: await digest(join(values.maps, item.map + '.map')) };
    await save(join(cwd, 'fixture.json'), result);
    results.push(result);
    console.log(JSON.stringify(result));
  }
} else {
  assert.equal(values.mode, 'compare');
  for (const name of ['fixtures', 'wasm', 'encoder']) assert.ok(values[name], `Missing --${name}`);
  const repeats = Number(values.repeats ?? 3);
  assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
  for (const item of cases) {
    const source = join(values.fixtures, item.name), film = join(source, 'input.h1film');
    const fixture = JSON.parse(await readFile(join(source, 'fixture.json'), 'utf8'));
    const header = await envelope(film);
    assert.equal(await digest(film), fixture.film_sha256);
    assert.equal(await digest(join(values.maps, item.map + '.map')), fixture.map_sha256);
    assert.equal(header.map_bytes, (await stat(join(values.maps, item.map + '.map'))).size);
    const request = { ticks: header.ticks, players: header.players, map: header.map,
      replay_id: 'h1-' + fixture.film_sha256, recorded_at: '2026-10-19T00:00:00Z', zstd_level: 6,
      source_tick_rate: 120, export_contract: 'HSFT0001', transport_contract: 'HSFT0002',
      analytics_revision: 3, viewer_profile_revision: 4, source_viewer_only: true,
      incremental_state: true, typed_poses: true,
      analytics_context: { engine_profile: 'experimental-linux-865d1b3d', gametype: 'ts50',
        map: header.map, map_sha256: fixture.map_sha256, film_sha256: fixture.film_sha256 } };
    const run = async (kind, label, capture) => {
      const cwd = join(values.output, `${item.name}-${label}-${kind}`);
      await workspace(cwd);
      await copyFile(film, join(cwd, 'input.h1film'));
      await save(join(cwd, 'request.json'), request);
      const command = kind === 'native' ? [values.native] : [process.execPath, values.wasm];
      command.push('--film', 'input.h1film', '--deterministic', '--ticks', String(header.ticks + 10), '--dump', 'NUL');
      let encoder, encoderDone, output, engine;
      const started = performance.now();
      try {
        if (capture) output = openSync(join(cwd, 'capture.hsft'), 'wx');
        else {
          const log = openSync(join(cwd, 'encoder.log'), 'wx');
          const encoderPath = kind === 'native' ? (values['candidate-encoder'] ?? values.encoder) : values.encoder;
          encoder = spawn(values.measure, [join(cwd, 'encoder-metrics.json'), encoderPath,
            'encode', join(cwd, 'request.json'), join(cwd, 'products')], {
            cwd, env: environment, stdio: ['pipe', log, log], timeout: 1800000, killSignal: 'SIGKILL' });
          closeSync(log);
          encoder.stdin.on('error', () => engine?.kill('SIGKILL'));
          encoderDone = completion(encoder);
          encoderDone.catch(() => engine?.kill('SIGKILL'));
          assert.equal(encoder.stdin._handle.setBlocking(true), 0);
          output = encoder.stdin;
        }
        engine = launch(values.measure, [join(cwd, 'engine-metrics.json'), ...command], cwd, join(cwd, 'playback.log'), output);
        await completion(engine);
        if (encoder) encoder.stdin.end();
        if (encoder) await encoderDone;
      } catch (error) {
        engine?.kill('SIGKILL');
        encoder?.kill('SIGKILL');
        throw new Error(`${cwd}: ${error.message}`, { cause: error });
      } finally { if (typeof output === 'number') closeSync(output); }
      const seconds = (performance.now() - started) / 1000;
      const simulation = verifyPlayback(await readFile(join(cwd, 'playback.log'), 'utf8'), header);
      const engineMetrics = JSON.parse(await readFile(join(cwd, 'engine-metrics.json'), 'utf8'));
      const products = {};
      let encoding;
      if (capture) {
        products.stream = { sha256: await digest(join(cwd, 'capture.hsft')), bytes: (await stat(join(cwd, 'capture.hsft'))).size };
      } else {
        for (const file of (await readdir(join(cwd, 'products'))).sort()) {
          const path = join(cwd, 'products', file);
          if ((await stat(path)).isFile() && file !== 'encoding.json') products[file] = { sha256: await digest(path), bytes: (await stat(path)).size };
        }
        encoding = JSON.parse(await readFile(join(cwd, 'products/encoding.json'), 'utf8'));
        assert.equal(encoding.source_ticks, header.ticks);
      }
      const result = { kind, label, seconds, simulation, engine: engineMetrics, products,
        ...(encoding ? { observations: { max_objects: encoding.max_objects, shots: encoding.max_player_shots,
          deaths: encoding.max_player_deaths, body_replacements: encoding.body_handle_replacements },
        encoder: JSON.parse(await readFile(join(cwd, 'encoder-metrics.json'), 'utf8')) } : {}) };
      await save(join(cwd, 'result.json'), result);
      console.log(JSON.stringify({ fixture: item.name, kind, label, seconds, max_rss_kib: engineMetrics.max_rss_kib }));
      return result;
    };
    const captured = [await run('native', 'parity', true), await run('wasm', 'parity', true)];
    assert.deepEqual(captured[0].products, captured[1].products, `${item.name}: full export differs`);
    const runs = [];
    let expected;
    for (let iteration = 0; iteration <= repeats; iteration++) {
      const order = iteration % 2 ? ['wasm', 'native'] : ['native', 'wasm'];
      for (const kind of order) {
        const result = await run(kind, iteration === 0 ? 'warmup' : `run-${iteration}`, false);
        expected ??= result.products;
        assert.deepEqual(result.products, expected, `${item.name}: encoded products differ`);
        if (iteration) runs.push(result);
      }
    }
    const result = { fixture, capture: captured, runs };
    await save(join(values.output, `${item.name}.json`), result);
    results.push(result);
  }
}
await save(join(values.output, 'summary.json'), { schema: 'halospawns.h1LinuxBenchmark.v1',
  cpus: Number(values.cpus ?? 2), memory_mib: 3008,
  native_sha256: await digest(values.native), measure_sha256: await digest(values.measure),
  ...(values.mode === 'compare' ? { wasm_sha256: await digest(values.wasm.replace(/\.js$/, '.wasm')),
    glue_sha256: await digest(values.wasm), encoder_sha256: await digest(values.encoder),
    candidate_encoder_sha256: await digest(values['candidate-encoder'] ?? values.encoder) } : {}), results });
