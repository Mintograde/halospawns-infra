import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, candidate: { type: 'string' }, output: { type: 'string' },
  'baseline-engine': { type: 'string' }, 'candidate-engine': { type: 'string' },
} });
assert.ok(values.baseline && values.candidate);
const load = async (directory, name) => JSON.parse(await readFile(join(directory, name), 'utf8'));
const before = await load(values.baseline, 'report.json');
const after = await load(values.candidate, 'report.json');
for (const field of ['envelope', 'simulation', 'engine_profile', 'map_binding']) {
  assert.deepEqual(after[field], before[field], field);
}
const changedExporter = values['baseline-engine'] !== undefined || values['candidate-engine'] !== undefined;
if (changedExporter) {
  assert.ok(values['baseline-engine'] && values['candidate-engine'], 'Both full-export proofs are required');
  const proofs = await Promise.all(['baseline-engine', 'candidate-engine'].map(async key =>
    JSON.parse(await readFile(values[key], 'utf8'))));
  for (const [i, report] of [before, after].entries()) {
    for (const key of ['film_sha256', 'map_sha256', 'wasm_sha256', 'glue_sha256']) {
      assert.equal(proofs[i][key], report.provenance[key], `Engine proof ${key}`);
    }
    assert.equal(proofs[i].exporter_revision, report.exporter_revision);
    assert.equal(proofs[i].transport_contract ?? 'HSFT0001', report.encoding.transport_contract ?? 'HSFT0001');
    assert.deepEqual(proofs[i].simulation, report.simulation);
    assert.ok(!proofs[i].aot_module_sha256, 'Proof must use the registered WASM');
    assert.match(proofs[i].transport_sha256, /^[a-f0-9]{64}$/);
    assert.equal(proofs[i].transport_bytes, report.encoding.transport_bytes);
    assert.ok(proofs[i].transport_bytes > 0);
  }
  for (const proof of proofs) {
    if (proof.transport_contract === 'HSFT0002') {
      assert.match(proof.canonical_sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(proof.canonical_bytes) && proof.canonical_bytes > 8);
    } else {
      assert.ok(proof.transport_contract === undefined || proof.transport_contract === 'HSFT0001');
      if (proof.canonical_sha256 !== undefined) assert.equal(proof.canonical_sha256, proof.transport_sha256);
      if (proof.canonical_bytes !== undefined) assert.equal(proof.canonical_bytes, proof.transport_bytes);
    }
  }
  assert.equal(proofs[0].canonical_sha256 ?? proofs[0].transport_sha256,
    proofs[1].canonical_sha256 ?? proofs[1].transport_sha256, 'Unprojected engine stream changed');
  assert.equal(proofs[0].canonical_bytes ?? proofs[0].transport_bytes,
    proofs[1].canonical_bytes ?? proofs[1].transport_bytes);
}
for (const field of changedExporter ? ['film_sha256', 'map_sha256']
  : ['film_sha256', 'map_sha256', 'wasm_sha256', 'glue_sha256']) {
  assert.equal(after.provenance[field], before.provenance[field], field);
}

function stableCallback(value, report) {
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
  if (result.spatial_artifact?.metadata) {
    for (const field of ['process_peak_rss_kib', 'parse_duration_ms']) delete result.spatial_artifact.metadata[field];
  }
  if (changedExporter) {
    for (const key of ['wasm_sha256', 'glue_sha256', 'exporter_revision']) {
      assert.equal(result.h1film[key], key === 'exporter_revision' ? report[key] : report.provenance[key]);
      delete result.h1film[key];
    }
  }
  return result;
}

for (const name of ['finalization.json', 'full-reparse-completion.json', 'viewer-rebuild-completion.json']) {
  assert.deepEqual(stableCallback(await load(values.candidate, name), after),
    stableCallback(await load(values.baseline, name), before), name);
}
const baseline = await load(values.baseline, 'verification.json');
const candidate = await load(values.candidate, 'verification.json');
for (const field of ['status', 'aws_access', 'api_access', 'film_sha256', 'source_ticks',
  'hash_checks', 'conversions', 'idempotent_callbacks', 'product_modes', 'viewer_bytes']) {
  assert.deepEqual(candidate[field], baseline[field], field);
}
const summary = {
  status: changedExporter ? 'identical_products_with_verified_exporter_change'
    : 'identical_products_except_operational_metrics', film_sha256: candidate.film_sha256,
  full_export_parity: changedExporter,
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
