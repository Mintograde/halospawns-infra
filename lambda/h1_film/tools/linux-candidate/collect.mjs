import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [sourceArgument, fixturesArgument, outputArgument] = process.argv.slice(2);
assert.ok(sourceArgument && fixturesArgument && outputArgument, 'Supply run, fixture and new output directories');
const source = resolve(sourceArgument), fixtures = resolve(fixturesArgument), output = resolve(outputArgument);
const summary = JSON.parse(await readFile(join(source, 'summary.json'), 'utf8'));
await mkdir(output);
await copyFile(join(source, 'summary.json'), join(output, 'summary.json'));
const rows = [];
function statistics(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return { median: ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
    min: ordered[0], max: ordered.at(-1) };
}
for (const result of summary.results) {
  const native = result.runs.filter(run => run.kind === 'native');
  const wasm = result.runs.filter(run => run.kind === 'wasm');
  const nativeTime = statistics(native.map(run => run.seconds));
  const wasmTime = statistics(wasm.map(run => run.seconds));
  rows.push({ fixture: result.fixture.name, ticks: result.fixture.ticks, players: result.fixture.players,
    native_seconds: nativeTime, wasm_seconds: wasmTime,
    native_time_increase_percent: (nativeTime.median / wasmTime.median - 1) * 100,
    native_fraction_of_wasm: nativeTime.median / wasmTime.median,
    half_time_goal_met: nativeTime.median <= wasmTime.median / 2,
    native_engine_rss_mib: statistics(native.map(run => run.engine.max_rss_kib / 1024)),
    wasm_engine_rss_mib: statistics(wasm.map(run => run.engine.max_rss_kib / 1024)),
    native_encoder_rss_mib: statistics(native.map(run => run.encoder.max_rss_kib / 1024)),
    wasm_encoder_rss_mib: statistics(wasm.map(run => run.encoder.max_rss_kib / 1024)),
    transport_bytes: result.capture[0].products.stream.bytes,
    transport_sha256: result.capture[0].products.stream.sha256,
    observations: native[0].observations,
    products: native[0].products });
  const fixtureOutput = join(output, result.fixture.name);
  await mkdir(fixtureOutput);
  for (const file of ['input.h1film', 'input.txt', 'fixture.json', 'record.log', 'record-metrics.json']) {
    await copyFile(join(fixtures, result.fixture.name, file), join(fixtureOutput, file));
  }
}
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const destination = join(output, entry.name);
  await mkdir(destination);
  for (const file of await readdir(join(source, entry.name))) {
    const path = join(source, entry.name, file);
    if (/\.(json|log)$/.test(file) && (await stat(path)).isFile()) await copyFile(path, join(destination, file));
  }
  if (entry.name.includes('-run-1-')) {
    const products = join(source, entry.name, 'products');
    await mkdir(join(destination, 'products'));
    for (const file of await readdir(products)) {
      if ((await stat(join(products, file))).isFile()) await copyFile(join(products, file), join(destination, 'products', file));
    }
  }
}
const nativeTotal = rows.reduce((total, row) => total + row.native_seconds.median, 0);
const wasmTotal = rows.reduce((total, row) => total + row.wasm_seconds.median, 0);
const report = { schema: 'halospawns.h1LinuxBenchmarkSummary.v1', rows,
  cpus: summary.cpus ?? 2, memory_mib: summary.memory_mib ?? 3008,
  native_sum_median_seconds: nativeTotal, wasm_sum_median_seconds: wasmTotal,
  native_time_increase_percent: (nativeTotal / wasmTotal - 1) * 100,
  native_fraction_of_wasm: nativeTotal / wasmTotal,
  aggregate_half_time_goal_met: nativeTotal <= wasmTotal / 2,
  every_fixture_half_time_goal_met: rows.every(row => row.half_time_goal_met),
  scope: 'Offline simulation, full typed export, Rust encoding and analytics; source viewer only. Excludes Python finalization, S3/API, Lambda startup and input staging.',
  raw_stream_location: source };
await writeFile(join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
