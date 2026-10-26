import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { sha256 } from '../runtime/engine-store.mjs';

const { values } = parseArgs({ options: {
  ...Object.fromEntries(['film', 'assets', 'baseline', 'candidate', 'runtime', 'candidate-runtime', 'output', 'repeats', 'image-id', 'cpus', 'exporter-revision', 'analytics-revision', 'viewer-revision']
    .map(name => [name, { type: 'string' }])),
  'verify-source': { type: 'boolean', default: false },
} });
assert.equal(process.platform, 'linux');
for (const name of ['film', 'assets', 'baseline', 'candidate', 'runtime', 'output', 'image-id', 'cpus']) {
  assert.ok(values[name], `Missing --${name}`);
}
const repeats = Number(values.repeats ?? 3);
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
const cpus = Number(values.cpus);
assert.ok(Number.isFinite(cpus) && cpus >= 1 && cpus <= 4);
const output = resolve(values.output);
const configuration = {
  'exporter-revision': values['exporter-revision'] ?? '10',
  'analytics-revision': values['analytics-revision'] ?? '4',
  'viewer-revision': values['viewer-revision'] ?? '5',
};
await mkdir(output);
const runtimes = Object.fromEntries(await Promise.all(['baseline', 'candidate'].map(async kind => {
  const path = kind === 'candidate' ? values['candidate-runtime'] ?? values.runtime : values.runtime;
  return [kind, { path, ...(await import(pathToFileURL(resolve(path)).href)) }];
})));
const runs = [];
let expectedProducts, expectedSimulation, expectedProvenance;
const median = numbers => {
  const ordered = [...numbers].sort((first, second) => first - second);
  return (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2;
};
for (let iteration = 0; iteration <= repeats + Number(values['verify-source']); iteration++) {
  const proof = iteration > repeats;
  for (const kind of proof ? ['candidate'] : iteration % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
    const directory = join(output, `${iteration}-${kind}`);
    const report = await runtimes[kind].convertFilm({
      film: values.film, assets: values.assets, encoder: values[kind], output: directory,
      'trusted-local': true, 'skip-readback': true, 'source-viewer-only': true,
      'engine-permissions': true, ...configuration,
      analytics: true, 'verify-incremental-state': proof,
    });
    const products = {};
    for (const name of (await readdir(join(directory, 'candidate'))).sort()) {
      const path = join(directory, 'candidate', name);
      if ((await stat(path)).isFile() && !['encoding.json', 'report.json'].includes(name)) {
        products[name] = { sha256: await sha256(path), bytes: (await stat(path)).size };
      }
    }
    const { encoder_sha256, ...provenance } = report.provenance;
    expectedProducts ??= products;
    expectedSimulation ??= report.simulation;
    expectedProvenance ??= provenance;
    assert.deepEqual(products, expectedProducts, 'Candidate changes replay or analytics bytes');
    assert.deepEqual(report.simulation, expectedSimulation, 'Candidate changes simulation verification');
    assert.deepEqual(provenance, expectedProvenance, 'Inputs or engine pins changed during comparison');
    assert.equal(report.status, 'simulation_and_encoding_verified');
    assert.equal(report.encoding.source_ticks, report.envelope.ticks);
    const result = { iteration, kind, full_source_proof: proof, timing: report.timing, encoder_sha256,
      engine_resources: report.engine_resources, state_reuse: report.encoding.state_reuse };
    runs.push(result);
    console.log(JSON.stringify({ iteration, kind, full_source_proof: proof, ...report.timing }));
  }
}
const measurements = Object.fromEntries(['baseline', 'candidate'].map(kind => {
  const selected = runs.filter(run => run.iteration > 0 && !run.full_source_proof && run.kind === kind);
  return [kind, Object.fromEntries(['pipeline_seconds', 'total_seconds'].map(metric => {
    const seconds = selected.map(run => run.timing[metric]);
    return [metric, { median: median(seconds), minimum: Math.min(...seconds), maximum: Math.max(...seconds) }];
  }))];
}));
await writeFile(join(output, 'summary.json'), JSON.stringify({
  schema: 'halospawns.h1WasmEncoderBenchmark.v1',
  scope: 'Offline production WASM converter including staging, hash checks and inline artifact verification; excludes Python finalization, S3/API and Lambda startup.',
  image_id: values['image-id'], cpus, memory_mib: 3008,
  configuration,
  full_source_proof: values['verify-source'],
  runtime_sha256: await sha256(runtimes.baseline.path),
  candidate_runtime_sha256: await sha256(runtimes.candidate.path), provenance: expectedProvenance,
  film: JSON.parse(await readFile(join(output, '0-baseline/report.json'), 'utf8')).envelope,
  simulation: expectedSimulation, products: expectedProducts, measurements, runs,
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(measurements));
