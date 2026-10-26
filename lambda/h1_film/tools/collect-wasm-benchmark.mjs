import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const [output, ...sources] = process.argv.slice(2);
assert.ok(output && sources.length);
await mkdir(output);
let configuration;
const rows = [], films = new Set();
function statistics(seconds) {
  assert.ok(seconds.length >= 3);
  const sorted = [...seconds].sort((first, second) => first - second);
  return { median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    minimum: sorted[0], maximum: sorted.at(-1) };
}
for (const source of sources) {
  const summary = JSON.parse(await readFile(join(source, 'summary.json'), 'utf8'));
  assert.equal(summary.schema, 'halospawns.h1WasmEncoderBenchmark.v1');
  assert.equal(summary.full_source_proof,
    summary.runs.some(run => run.kind === 'candidate' && run.full_source_proof));
  const identity = { ...Object.fromEntries(['image_id', 'cpus', 'memory_mib', 'runtime_sha256',
    'candidate_runtime_sha256', 'configuration', 'scope'].map(key => [key, summary[key]])),
    encoder_sha256: Object.fromEntries(['baseline', 'candidate'].map(kind => {
      const hashes = new Set(summary.runs.filter(run => run.kind === kind).map(run => run.encoder_sha256));
      assert.equal(hashes.size, 1);
      return [kind, [...hashes][0]];
    })) };
  configuration ??= identity;
  assert.deepEqual(identity, configuration, 'Cannot combine different configurations');
  assert.ok(!films.has(summary.provenance.film_sha256), 'Duplicate film');
  films.add(summary.provenance.film_sha256);
  const runs = summary.runs.filter(run => run.iteration > 0 && !run.full_source_proof);
  const kinds = Object.fromEntries(['baseline', 'candidate'].map(kind => [kind, runs.filter(run => run.kind === kind)]));
  assert.deepEqual(kinds.baseline.map(run => run.iteration), kinds.candidate.map(run => run.iteration));
  const measurements = Object.fromEntries(['pipeline_seconds', 'total_seconds'].map(metric => [metric,
    Object.fromEntries(Object.entries(kinds).map(([kind, runs]) => [kind, statistics(runs.map(run => run.timing[metric]))]))]));
  const total = measurements.total_seconds;
  rows.push({ name: basename(source), ticks: summary.film.ticks, hash_checks: summary.film.hash_samples,
    full_source_proof: summary.full_source_proof,
    provenance: summary.provenance, measurements,
    reduction_percent: (1 - total.candidate.median / total.baseline.median) * 100,
    paired_total_reduction_percent: (1 - kinds.candidate.reduce((sum, run) => sum + run.timing.total_seconds, 0)
      / kinds.baseline.reduce((sum, run) => sum + run.timing.total_seconds, 0)) * 100,
    products: summary.products });
  const destination = join(output, basename(source));
  await mkdir(destination);
  await copyFile(join(source, 'summary.json'), join(destination, 'summary.json'));
  for (const run of summary.runs) {
    const name = `${run.iteration}-${run.kind}`;
    await mkdir(join(destination, name));
    for (const file of ['report.json', 'request.json', 'encode.log', 'playback.log', 'engine-metrics.json']) {
      await copyFile(join(source, name, file), join(destination, name, file));
    }
  }
}
const baseline = rows.reduce((sum, row) => sum + row.measurements.total_seconds.baseline.median, 0);
const candidate = rows.reduce((sum, row) => sum + row.measurements.total_seconds.candidate.median, 0);
const report = { schema: 'halospawns.h1WasmEncoderBenchmarkSummary.v1', ...configuration, rows,
  baseline_sum_median_seconds: baseline, candidate_sum_median_seconds: candidate,
  reduction_percent: (1 - candidate / baseline) * 100 };
await writeFile(join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
