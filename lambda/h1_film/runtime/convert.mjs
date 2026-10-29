// Reusable local worker pipeline. Cloud intake/finalization remains separately gated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapterFor, readEnvelope } from './film.mjs';
import { resolveMap, selectProfile, selectExporter, validateRegistry, validateExporters } from './profiles.mjs';
import { inspectEngine, resolveEngine, sha256 } from './engine-store.mjs';
import { exportDiagnostics } from './export-diagnostics.mjs';

export async function convertFilm(options) {
  const values = { timeout: '1800', 'trusted-local': false, 'skip-readback': false,
    analytics: false, ...options };
  const totalStarted = performance.now();
  const analyticsRevision = Number(values['analytics-revision'] ?? 2);
  assert.ok([1, 2, 3, 4].includes(analyticsRevision), 'Unsupported analytics revision');
  for (const key of ['film', 'assets', 'encoder', 'output']) {
    assert.ok(values[key], `Missing --${key}`);
    values[key] = resolve(values[key]);
  }
  assert.ok(Boolean(values.reference) !== Boolean(values['trusted-local']), 'Use exactly one of --reference or --trusted-local');
  assert.ok(!values['skip-readback'] || values['trusted-local'], '--skip-readback requires --trusted-local');
  assert.ok(!values['source-viewer-only'] || (values['trusted-local'] && values['skip-readback']),
    '--source-viewer-only requires --trusted-local and --skip-readback');
  if (values.reference) values.reference = resolve(values.reference);
  const timeout = Number(values.timeout) * 1000;
  assert.ok(Number.isFinite(timeout) && timeout > 0 && timeout <= 3600000);
  async function save(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n'); }
  const envelope = await readEnvelope(values.film);
  const native = values.reference
    ? JSON.parse(await readFile(join(values.reference, 'report.json'), 'utf8'))
    : { envelope, provenance: {} };
  if (values.reference) {
    assert.equal(native.status, 'verified');
    assert.deepEqual(envelope, native.envelope, 'Film envelope differs from the native baseline');
  }
  let profiles, exporters;
  if (values['candidate-registry']) {
    assert.ok(values.engine, 'A candidate registry requires an explicit local engine');
    const candidate = JSON.parse(await readFile(values['candidate-registry'], 'utf8'));
    profiles = validateRegistry(candidate);
    exporters = validateExporters(candidate, profiles);
  }
  const profile = selectExporter(selectProfile(envelope, profiles), values['exporter-revision'] === undefined
    ? undefined : Number(values['exporter-revision']), exporters);
  const adapter = adapterFor(profile);
  if (envelope.bots) assert.ok(profile.exporter_revision >= 7, 'Bot films require exporter revision 7 or later');
  if (profile.port === 'beta4' && (envelope.players > 4 || envelope.network?.max_player_slot >= 4
    || envelope.network?.participant_count > 4)) {
    assert.ok(profile.exporter_revision >= 6, 'This Beta 4 roster requires exporter revision 6 or later');
  }
  if (values.profile) assert.equal(values.profile, profile.id, 'Requested profile does not match the film');
  assert.ok(!(values.engine && values['engine-root']), 'Choose --engine or --engine-root, not both');
  const engine = values.engine ? await inspectEngine(profile, values.engine)
    : await resolveEngine(profile, values['engine-root'] || process.env.H1_ENGINE_ROOT
      || fileURLToPath(new URL('../artifacts/', import.meta.url)));
  values.engine = engine.glue;
  assert.match(native.envelope.map, /^[a-z0-9_-]+$/i);
  assert.ok(native.envelope.ticks > 0 && native.envelope.ticks <= 432000);
  assert.ok((await stat(values.film)).size <= 512 * 1024 * 1024);
  const map = join(values.assets, 'maps', native.envelope.map + '.map');
  assert.equal((await stat(map)).size, native.envelope.map_bytes, 'Map size differs from recorded cache');
  const filmHash = await sha256(values.film), mapHash = await sha256(map);
  const engineHashes = engine.hashes;
  let mapBinding;
  if (values['map-catalog']) {
    assert.ok((await stat(values['map-catalog'])).size <= 4 * 1024 * 1024, 'Map catalog too large');
    mapBinding = resolveMap(profile, native.envelope,
      JSON.parse(await readFile(values['map-catalog'], 'utf8')));
    assert.equal(mapHash, mapBinding.sha256, 'Raw map differs from its catalog binding');
  }
  if (values.reference) {
    assert.equal(filmHash, native.provenance.film_sha256, 'Film differs from native baseline');
    assert.equal(mapHash, native.provenance.map_sha256, 'Map differs from native baseline');
  } else {
    native.provenance = { film_sha256: filmHash, map_sha256: mapHash };
  }
  await assert.rejects(stat(values.output), { code: 'ENOENT' });
  const stage = values.output + '.partial';
  await mkdir(stage);
  const work = join(stage, 'work');
  await mkdir(join(work, 'maps'), { recursive: true });
  await mkdir(join(work, 'stats'));
  await mkdir(join(work, 'films'));
  await copyFile(map, join(work, 'maps', native.envelope.map + '.map'));
  await copyFile(values.film, join(work, 'input.h1film'));
  if (values.reference) await copyFile(join(values.reference, 'request.json'), join(stage, 'request.json'));
  else await save(join(stage, 'request.json'), {
    ticks: native.envelope.ticks, players: native.envelope.players, map: native.envelope.map,
    replay_id: `h1-${filmHash}`, zstd_level: 6,
  });
  const requestPath = join(stage, 'request.json');
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  request.recorded_at = envelope.created_utc
    ? new Date(envelope.created_utc * 1000).toISOString().replace('.000Z', 'Z') : '1970-01-01T00:00:00Z';
  request.source_tick_rate = profile.tick_rate;
  request.export_contract = profile.export_contract;
  request.transport_contract = profile.transport_contract ?? profile.export_contract;
  request.analytics_revision = analyticsRevision;
  request.combat_network_recording = Boolean(envelope.network?.records);
  request.viewer_profile_revision = Number(values['viewer-revision'] ?? 4);
  assert.ok([1, 2, 3, 4, 5].includes(request.viewer_profile_revision), 'Unsupported viewer revision');
  request.source_viewer_only = Boolean(values['source-viewer-only']);
  request.incremental_state = !values['generic-state'];
  request.typed_poses = !values['generic-poses'];
  request.verify_incremental_state = Boolean(values['verify-incremental-state']);
  assert.ok(!request.verify_incremental_state || request.incremental_state,
    '--verify-incremental-state requires incremental state');
  if (values.analytics) {
    request.analytics_context = { engine_profile: profile.id, gametype: native.envelope.gametype,
      map: native.envelope.map, map_sha256: mapHash, film_sha256: filmHash,
      ...(mapBinding ? { map_binding: mapBinding } : {}) };
  }
  await save(requestPath, request);
  assert.equal(await sha256(join(work, 'input.h1film')), filmHash, 'Film changed while staging');
  assert.equal(await sha256(join(work, 'maps', native.envelope.map + '.map')), mapHash, 'Map changed while staging');
  const stagingSeconds = (performance.now() - totalStarted) / 1000;

  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(BLAMPC_|H1_EXPORT_|VIEWER_ARTIFACT_)/i.test(key)));
  Object.assign(environment, { BLAMPC_FILM_RING: '0', BLAMPC_FILM_KEYFRAME_TICKS: '432001',
    BLAMPC_FILM_VIEW_DELIVERED: '1', BLAMPC_STATS_DIR: join(work, 'stats'),
    BLAMPC_FILM_DIR: join(work, 'films'), H1_EXPORT_HANDLE: '3',
    H1_EXPORT_METRICS: join(stage, 'engine-metrics.json') });
  const engineLog = openSync(join(stage, 'playback.log'), 'wx');
  const encoderLog = openSync(join(stage, 'encode.log'), 'wx');
  let logsClosed = false;
  function closeLogs() {
    if (logsClosed) return;
    logsClosed = true;
    closeSync(engineLog);
    closeSync(encoderLog);
  }
  const children = [];
  const completions = [];
  let expired = false;
  const started = performance.now();
  const report = { schema: 'halospawns.h1FilmWasmComparisonRun.v1', status: 'started', input: values.film,
    envelope: native.envelope, reference: values.reference,
    benchmark_mode: values['trusted-local'], timing: { preflight_staging_seconds: stagingSeconds },
    engine_profile: profile.id, export_contract: profile.export_contract,
    ...(values['candidate-registry'] ? { candidate_registry: true } : {}),
    ...(profile.exporter_revision === undefined ? {} : { exporter_revision: profile.exporter_revision }),
    ...(mapBinding ? { map_binding: mapBinding } : {}),
    provenance: { film_sha256: native.provenance.film_sha256, map_sha256: native.provenance.map_sha256,
      ...(profile.source ? { engine_source: profile.source } : {}),
      ...engineHashes, encoder_sha256: await sha256(values.encoder), node: process.version } };
  const kill = () => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); };
  const timer = setTimeout(() => { expired = true; kill(); }, timeout);
  let monitor, monitorDone;
  const interrupted = () => { expired = true; kill(); };
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  function completion(child) {
    children.push(child);
    const promise = new Promise(resolve => {
      let error;
      child.once('error', failure => { error = failure.message; });
      child.once('close', (code, signal) => resolve({ code, signal, ...(error ? { error } : {}) }));
    });
    completions.push(promise);
    return promise;
  }
  try {
    const encoder = spawn(values.encoder, ['encode', join(stage, 'request.json'), join(stage, 'candidate')],
      { cwd: work, env: environment, windowsHide: true, stdio: ['pipe', encoderLog, encoderLog] });
    const encoded = completion(encoder);
    encoder.stdin.on('error', () => kill());
    // The retained exporter retries EAGAIN with a 2 ms sleep. It owns all writes
    // to this descriptor, so blocking backpressure avoids polling latency.
    if (process.platform === 'linux' && typeof encoder.stdin._handle?.setBlocking === 'function') {
      assert.equal(encoder.stdin._handle.setBlocking(true), 0, 'Cannot configure encoder pipe');
    }
    const permissions = values['engine-permissions'] ? ['--permission',
      `--allow-fs-read=${work}`, `--allow-fs-read=${dirname(values.engine)}`,
      `--allow-fs-read=${fileURLToPath(new URL('./metrics.mjs', import.meta.url))}`,
      `--allow-fs-read=${fileURLToPath(new URL('./engine-permissions.mjs', import.meta.url))}`,
      `--allow-fs-write=${work}`, `--allow-fs-write=${environment.H1_EXPORT_METRICS}`,
      '--import', new URL('./engine-permissions.mjs', import.meta.url).href] : [];
    const engine = spawn(process.execPath, [...permissions, '--max-old-space-size=4096',
      '--import', new URL('./metrics.mjs', import.meta.url).href, values.engine,
      '--film', 'input.h1film', '--deterministic', '--ticks', String(native.envelope.ticks + 10), '--dump', 'NUL'],
      { cwd: work, env: environment, windowsHide: true, stdio: ['ignore', engineLog, engineLog, encoder.stdin] });
    const simulated = completion(engine);
    if (process.platform === 'win32' && values['trusted-local']) {
      monitor = spawn('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('../tools/measure-windows.ps1', import.meta.url)),
        '-RunnerId', String(process.pid), '-EngineId', String(engine.pid), '-EncoderId', String(encoder.pid),
        '-Output', join(stage, 'pipeline-metrics.json'), '-StopFile', join(stage, 'monitor.stop')],
      { windowsHide: true, stdio: ['ignore', encoderLog, encoderLog] });
      monitorDone = new Promise(resolve => {
        monitor.once('error', error => resolve({ error: error.message }));
        monitor.once('close', code => resolve({ code }));
      });
    }
    encoded.then(result => { if (result.code !== 0) kill(); }, kill);
    report.engine_exit = await simulated;
    encoder.stdin.end();
    report.encoder_exit = await encoded;
    assert.ok(!expired, 'Conversion timed out or was interrupted');
    assert.equal(report.engine_exit.code, 0, 'Simulator failed; see playback.log');
    assert.equal(report.encoder_exit.code, 0, 'Encoder failed; see encode.log');
    report.wall_seconds = (performance.now() - started) / 1000;
    report.timing.pipeline_seconds = report.wall_seconds;
    if (monitorDone) {
      await writeFile(join(stage, 'monitor.stop'), 'done');
      assert.equal((await monitorDone).code, 0, 'Resource monitor failed');
      report.pipeline_resources = JSON.parse((await readFile(join(stage, 'pipeline-metrics.json'), 'utf8')).replace(/^\uFEFF/, ''));
    }
    report.engine_resources = JSON.parse(await readFile(join(stage, 'engine-metrics.json'), 'utf8'));
    const log = await readFile(join(stage, 'playback.log'), 'utf8');
    report.simulation = adapter.verifyPlayback(log, native.envelope);
    if (values.reference) assert.equal(report.simulation.control_pushes, native.simulation.control_pushes);
    assert.equal(await sha256(join(work, 'maps', native.envelope.map + '.map')), native.provenance.map_sha256);
    assert.equal(await sha256(join(work, 'input.h1film')), filmHash);
    report.status = 'simulation_verified_pending_artifact_comparison';
    if (values.analytics) {
      const path = join(stage, 'candidate', 'analytics.30hz.json.zst');
      const encoding = JSON.parse(await readFile(join(stage, 'candidate', 'encoding.json'), 'utf8'));
      const end = encoding.analytics.match_end_source_tick;
      assert.ok(end === null || (Number.isInteger(end) && end >= 0 && end < native.envelope.ticks));
      const statisticsTicks = analyticsRevision === 1 || end === null ? native.envelope.ticks : end + 1;
      assert.equal(encoding.analytics_revision, analyticsRevision);
      assert.equal(encoding.analytics.analytics_revision, analyticsRevision);
      assert.equal(encoding.analytics.statistics_source_ticks, statisticsTicks);
      assert.equal(encoding.analytics.ticks, Math.ceil(statisticsTicks / 4));
      assert.equal((await stat(path)).size, encoding.analytics.size_bytes);
      report.analytics = { ...encoding.analytics, sha256: await sha256(path) };
    }
    if (values['trusted-local']) {
      const encoding = JSON.parse(await readFile(join(stage, 'candidate', 'encoding.json'), 'utf8'));
      report.encoding = Object.fromEntries(Object.entries(encoding).filter(([key]) => key !== 'source_events'));
      assert.equal(encoding.source_ticks, native.envelope.ticks);
      const rates = [['120hz', native.envelope.ticks]];
      if (!values['source-viewer-only']) rates.push(['30hz', Math.ceil(native.envelope.ticks / 4)]);
      if (values['source-viewer-only']) {
        assert.equal(encoding['30hz'], null);
        assert.deepEqual(encoding.verification, { mode: [4, 5].includes(request.viewer_profile_revision) ? 'inline-bounded-poses' : 'inline-lossless', '120hz': native.envelope.ticks, '30hz': null });
      }
      for (const [rate, count] of rates) {
        const replay = join(stage, 'candidate', `replay.${rate}.hsrdc`);
        assert.equal(encoding[rate].tickCount, count);
        assert.equal((await stat(replay)).size, encoding[rate].sizeBytes);
        assert.equal(await sha256(replay), encoding[rate].sha256);
      }
      report.status = 'simulation_and_encoding_verified';
      report.additional_readback = !values['skip-readback'];
    }
    if (values['trusted-local'] && !values['skip-readback']) {
      const verificationStarted = performance.now();
      const validationLog = openSync(join(stage, 'validation.json'), 'wx');
      try {
        const validator = spawn(values.encoder, ['verify', join(stage, 'candidate', 'replay.120hz.hsrdc'),
          join(stage, 'candidate', 'replay.30hz.hsrdc')],
        { windowsHide: true, env: environment, stdio: ['ignore', validationLog, encoderLog] });
        const validated = completion(validator);
        if (process.platform === 'win32') {
          monitor = spawn('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('../tools/measure-windows.ps1', import.meta.url)),
            '-RunnerId', String(process.pid), '-ValidatorId', String(validator.pid),
            '-Output', join(stage, 'validation-metrics.json'), '-StopFile', join(stage, 'monitor.stop.validation')],
          { windowsHide: true, stdio: ['ignore', encoderLog, encoderLog] });
          monitorDone = new Promise(resolve => {
            monitor.once('error', error => resolve({ error: error.message }));
            monitor.once('close', code => resolve({ code }));
          });
        }
        report.validator_exit = await validated;
        report.timing.validation_process_seconds = (performance.now() - verificationStarted) / 1000;
        if (process.platform === 'win32' && monitorDone) {
          await writeFile(join(stage, 'monitor.stop.validation'), 'done');
          assert.equal((await monitorDone).code, 0, 'Validation resource monitor failed');
          report.validation_resources = JSON.parse((await readFile(join(stage, 'validation-metrics.json'), 'utf8')).replace(/^\uFEFF/, ''));
        }
        assert.equal(report.validator_exit.code, 0, 'Artifact verification failed');
        report.validation = JSON.parse(await readFile(join(stage, 'validation.json'), 'utf8'));
        assert.equal(report.validation.status, 'verified');
        assert.equal(report.validation['120hz'].ticks, native.envelope.ticks);
        assert.equal(report.validation['30hz'].ticks, Math.ceil(native.envelope.ticks / 4));
        report.status = 'simulation_and_artifacts_verified';
      } finally { closeSync(validationLog); }
      report.timing.validation_seconds = (performance.now() - verificationStarted) / 1000;
    }
    if (profile.port === 'beta5' && profile.exporter_revision >= 11) {
      report.client_diagnostics = await exportDiagnostics(join(work, 'input.h1film'),
        join(stage, 'candidate', 'client-diagnostics.h1diag'), {
          film_sha256: filmHash, raw_map_sha256: mapHash, engine_profile: profile.id,
          source_tick_count: native.envelope.ticks, source_tick_rate: profile.tick_rate,
        });
    }
    report.timing.total_seconds = (performance.now() - totalStarted) / 1000;
    await save(join(stage, 'report.json'), report);
    await save(join(stage, 'candidate', 'report.json'), report);
    closeLogs();
    await rename(stage, values.output);
    return report;
  } catch (error) {
    kill();
    await Promise.all(completions);
    if (monitorDone) {
      await writeFile(join(stage, 'monitor.stop'), 'failed');
      await writeFile(join(stage, 'monitor.stop.validation'), 'failed');
      await monitorDone;
    }
    report.status = 'failed';
    report.error = error.message;
    report.wall_seconds = (performance.now() - started) / 1000;
    await save(join(stage, 'report.json'), report);
    throw new Error(`${error.message}\nDiagnostics: ${stage}`, { cause: error });
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', interrupted);
    closeLogs();
  }
}
