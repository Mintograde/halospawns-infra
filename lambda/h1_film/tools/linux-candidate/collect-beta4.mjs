import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const [output, ...sources] = process.argv.slice(2);
assert.ok(output && sources.length);
await mkdir(output);
const rows = [];
function statistics(values) {
    assert.ok(values.length >= 3);
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        min: sorted[0], max: sorted.at(-1) };
}
let identity;
for (const source of sources) {
    const summary = JSON.parse(await readFile(join(source, 'summary.json'), 'utf8'));
    assert.equal(summary.schema, 'halospawns.h1Beta4LinuxBenchmark.v1');
    assert.equal(summary.phase, 'compare');
    assert.ok(summary.cpus > 0);
    const configuration = Object.fromEntries(['cpus', 'memory_mib', 'image_id', 'native_sha256',
        'encoder_sha256', 'candidate_encoder_sha256', 'scope'].map(key => [key, summary[key]]));
    identity ??= configuration;
    assert.deepEqual(configuration, identity, 'Do not combine different benchmark configurations');
    assert.deepEqual(summary.parity[0].products, summary.parity[1].products);
    const native = summary.runs.filter(run => run.kind === 'native');
    const wasm = summary.runs.filter(run => run.kind === 'wasm');
    assert.equal(native.length, wasm.length);
    for (const run of summary.runs) assert.deepEqual(run.products, summary.runs[0].products);
    const nativeSeconds = statistics(native.map(run => run.seconds));
    const wasmSeconds = statistics(wasm.map(run => run.seconds));
    rows.push({ name: basename(source), ticks: summary.envelope.ticks,
        hash_checks: summary.envelope.hash_samples, film_sha256: summary.film_sha256, map_sha256: summary.map_sha256,
        native_seconds: nativeSeconds, wasm_seconds: wasmSeconds,
        reduction_percent: (1 - nativeSeconds.median / wasmSeconds.median) * 100,
        half_time_goal_met: nativeSeconds.median <= wasmSeconds.median / 2,
        native_engine_rss_mib: statistics(native.map(run => run.engine.max_rss_kib / 1024)),
        wasm_engine_rss_mib: statistics(wasm.map(run => run.engine.max_rss_kib / 1024)),
        native_encoder_rss_mib: statistics(native.map(run => run.encoder.max_rss_kib / 1024)),
        products: summary.runs[0].products });
    const destination = join(output, basename(source));
    await mkdir(destination);
    await copyFile(join(source, 'summary.json'), join(destination, 'summary.json'));
    await copyFile(join(source, 'request.json'), join(destination, 'request.json'));
    for (const entry of await readdir(source, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^(parity|warmup|run-\d+)-(native|wasm)$/.test(entry.name)) continue;
        const target = join(destination, entry.name);
        await mkdir(target);
        for (const name of await readdir(join(source, entry.name))) {
            const path = join(source, entry.name, name);
            if (/\.(json|log)$/.test(name) && (await stat(path)).isFile()) await copyFile(path, join(target, name));
        }
    }
}
const nativeTotal = rows.reduce((sum, row) => sum + row.native_seconds.median, 0);
const wasmTotal = rows.reduce((sum, row) => sum + row.wasm_seconds.median, 0);
const report = { schema: 'halospawns.h1Beta4LinuxBenchmarkSummary.v1', ...identity, rows,
    native_sum_median_seconds: nativeTotal, wasm_sum_median_seconds: wasmTotal,
    reduction_percent: (1 - nativeTotal / wasmTotal) * 100,
    half_time_goal_met: nativeTotal <= wasmTotal / 2 };
await writeFile(join(output, 'comparison.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
