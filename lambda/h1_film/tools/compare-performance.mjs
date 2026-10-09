import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, candidate: { type: 'string' }, output: { type: 'string' },
} });
assert.ok(values.baseline && values.candidate);
const load = async (directory, name) => JSON.parse(await readFile(join(directory, name), 'utf8'));
const before = await load(values.baseline, 'report.json');
const after = await load(values.candidate, 'report.json');
for (const field of ['envelope', 'simulation', 'engine_profile', 'map_binding']) {
  assert.deepEqual(after[field], before[field], field);
}
for (const field of ['film_sha256', 'map_sha256', 'wasm_sha256', 'glue_sha256']) {
  assert.equal(after.provenance[field], before.provenance[field], field);
}

function stableCallback(value) {
  const result = structuredClone(value);
  const metrics = result.viewer_artifact?.metadata?.metrics;
  for (const field of [
    'chunk_encode_duration_ms', 'chunk_write_duration_ms', 'compression_and_assembly_duration_ms',
    'compression_duration_ms', 'native_finalization_duration_ms', 'native_viewer_duration_ms',
    'process_peak_rss_kib', 'process_tree_peak_rss_kib', 'source_projection_duration_ms',
    'tick_hash_duration_ms', 'tmp_used_bytes', 'validation_duration_ms',
  ]) {
    if (metrics) delete metrics[field];
  }
  if (result.spatial_artifact?.metadata) delete result.spatial_artifact.metadata.process_peak_rss_kib;
  return result;
}

for (const name of ['finalization.json', 'full-reparse-completion.json', 'viewer-rebuild-completion.json']) {
  assert.deepEqual(stableCallback(await load(values.candidate, name)),
    stableCallback(await load(values.baseline, name)), name);
}
const baseline = await load(values.baseline, 'verification.json');
const candidate = await load(values.candidate, 'verification.json');
for (const field of ['status', 'aws_access', 'api_access', 'film_sha256', 'source_ticks',
  'hash_checks', 'conversions', 'idempotent_callbacks', 'product_modes', 'viewer_bytes']) {
  assert.deepEqual(candidate[field], baseline[field], field);
}
const summary = {
  status: 'identical_products_except_operational_metrics', film_sha256: candidate.film_sha256,
  source_ticks: candidate.source_ticks, hash_checks: candidate.hash_checks,
  baseline_conversion_seconds: before.timing.total_seconds,
  candidate_conversion_seconds: after.timing.total_seconds,
  conversion_speedup: before.timing.total_seconds / after.timing.total_seconds,
  baseline_harness_seconds: baseline.total_seconds, candidate_harness_seconds: candidate.total_seconds,
  harness_speedup: baseline.total_seconds / candidate.total_seconds,
  runtime_fraction: candidate.total_seconds / baseline.total_seconds,
};
if (values.output) await writeFile(values.output, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary, null, 2));
