import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const [evidence, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: node summarize.mjs EVIDENCE_DIRECTORY NEW_RESULTS.json');
const json = async name => JSON.parse(await readFile(path.join(evidence, name), 'utf8'));
const corpus = await json('corpus-fine-r1/corpus.json');
assert.equal(corpus.results.length, 32);
const rows = corpus.results.sort((a, b) => a.name.localeCompare(b.name));
const sum = fn => rows.reduce((n, r) => n + fn(r), 0);
const max = fn => Math.max(...rows.map(fn));
let filmBytes = 0;
for (const row of rows) {
  assert.equal(row.report.partial, false);
  assert.equal(row.report.readback.all_non_pose_fields_exact, true);
  assert.equal(row.report.readback.reverse_chunk_seeks_passed, true);
  assert.equal(row.report.readback.ticks, row.envelope.ticks);
  assert.equal(row.report.errors.nodes, row.report.readback.errors.nodes);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(row.film)) { hash.update(bytes); filmBytes += bytes.length; }
  assert.equal(hash.digest('hex'), row.provenance.film_sha256, `Original film changed: ${row.name}`);
}
const input = sum(r => r.report.input_bytes), packed = sum(r => r.report.output_bytes);
const byMap = new Map();
for (const row of rows) {
  const m = byMap.get(row.envelope.map) ?? { map: row.envelope.map, films: 0, input_bytes: 0, output_bytes: 0, ticks: 0 };
  m.films++; m.input_bytes += row.report.input_bytes; m.output_bytes += row.report.output_bytes; m.ticks += row.report.ticks;
  byMap.set(m.map, m);
}
const balanced = await json('prisoner-balanced.report.json');
const canary = await json('viewer3-canary.report.json');
const js = await json('rust-js-crosscheck.json');
const jsCorpus = await json('js-corpus/summary.json');
assert.equal(jsCorpus.results.length, rows.length);
assert.deepEqual(jsCorpus.results.map(r => r.ordinal).sort(), rows.map(r => r.name.slice(0, 3)).sort());
for (const row of jsCorpus.results) {
  assert.equal(row.all_non_pose_fields_exact, true);
  assert.ok(row.max_point_bound <= rows[0].report.settings.point_error_limit);
}
const browser = await json('browser-wire/browser-check.json');
assert.equal(browser.errors.length, 0);
assert.equal(js.all_non_pose_fields_exact, true);
assert.equal(js.rust_cross_check, true);
assert.ok(browser.geometry.browserDecodedChunks >= 1);
const rigs = await json('rig-geometry.json');
const concise = r => ({ input_bytes: r.input_bytes, output_bytes: r.output_bytes, ratio: r.ratio,
  ticks: r.ticks, raw_fallback_poses: r.counts.raw_poses, maximum_position_error: r.errors.max_position,
  maximum_point_bound: r.errors.max_point_bound, maximum_rotation_degrees: r.errors.max_angle_degrees,
  all_non_pose_fields_exact: r.readback.all_non_pose_fields_exact, reverse_chunk_seeks_passed: r.readback.reverse_chunk_seeks_passed });
const result = {
  schema: 'halospawns.poseCodecPocSummary.v1', date: '2026-10-10', preset: 'local3-fine', deployed: false,
  settings: rows[0].report.settings,
  corpus: { films: rows.length, maps: byMap.size, tick_rate: 120, ticks: sum(r => r.report.ticks),
    bone_matrices_checked: sum(r => r.report.errors.nodes), input_bytes: input, output_bytes: packed,
    reduction_percent: 100 * (1 - packed / input), size_ratio: input / packed,
    minimum_file_ratio: Math.min(...rows.map(r => r.report.ratio)), maximum_file_ratio: max(r => r.report.ratio),
    raw_fallback_poses: sum(r => r.report.counts.raw_poses), poses: sum(r => r.report.counts.poses),
    maximum_position_error: max(r => r.report.errors.max_position),
    rms_position_error: Math.sqrt(sum(r => r.report.errors.sum_squared_position) / sum(r => r.report.errors.nodes)),
    maximum_rotation_degrees: max(r => r.report.errors.max_angle_degrees),
    maximum_point_bound: max(r => r.report.errors.max_point_bound),
    non_pose_compressed_payload_bytes: sum(r => r.report.counts.base_bytes),
    pose_compressed_payload_bytes: sum(r => r.report.counts.pose_bytes),
    original_film_bytes: filmBytes, original_film_hashes_rechecked: true,
    all_non_pose_fields_exact: true, all_reverse_chunk_seeks_passed: true,
    source_note: 'Cached Beta 3 120 Hz conversions of the 32 supplied LAN demos. Earlier runs verified simulation/encoding for all and independent artifact readback for nine. This pass decodes and checks every source and experimental chunk for all 32.' },
  maps: [...byMap.values()].sort((a, b) => a.map.localeCompare(b.map)).map(m => ({ ...m, ratio: m.input_bytes / m.output_bytes })),
  prisoner_precision_comparison: { fine: concise(rows[0].report), balanced: concise(balanced) },
  additional_revision_3_artifact: concise(canary),
  independent_js: { ticks: js.ticks, bone_matrices: js.nodes, all_non_pose_fields_exact: js.all_non_pose_fields_exact,
    rust_cross_check: js.rust_cross_check, maximum_rust_component_difference: js.max_rust_component_difference },
  independent_js_corpus_samples: { films: jsCorpus.results.length, mode: jsCorpus.mode,
    ticks: jsCorpus.results.reduce((n, r) => n + r.ticks, 0),
    bone_matrices: jsCorpus.results.reduce((n, r) => n + r.nodes, 0),
    maximum_position_error: Math.max(...jsCorpus.results.map(r => r.max_position)),
    maximum_point_bound: Math.max(...jsCorpus.results.map(r => r.max_point_bound)),
    all_non_pose_fields_exact: true },
  browser: { ...browser.geometry, viewports: browser.views.map(v => v.viewport), canvas_nonblank_motion_and_orbit_passed: true, page_errors: browser.errors },
  measured_glb_geometry: rigs.map(r => ({ tag: r.tag, glb_sha256: r.source_glb_sha256, ...r.geometry_validation })),
  per_film: rows.map(r => ({ ordinal: r.name.slice(0, 3), map: r.envelope.map,
    film_sha256: r.provenance.film_sha256, experiment_sha256: r.report.output_sha256, ...concise(r.report) })),
  limitations: [
    'Lossy poses; exact non-pose fields. No source ticks removed.',
    'Experimental format has a separate reader. Existing app/API does not select or load .h1pc.',
    'Browser geometry checks cover the reported clip/worst-pose samples, not every tick of the full corpus.',
    'No cloud job, deploy, original film/map modification or Lambda performance measurement.',
    'Batch ran up to eight offline jobs concurrently; timings are not isolated conversion benchmarks.'
  ]
};
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ corpus: result.corpus, maps: result.maps, prisoner: result.prisoner_precision_comparison }, null, 2));
