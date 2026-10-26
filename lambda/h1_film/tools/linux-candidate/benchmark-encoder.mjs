import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sha256 } from '../../runtime/engine-store.mjs';

const [runPath, baseline, candidate, outputPath] = process.argv.slice(2);
assert.ok(runPath && baseline && candidate && outputPath);
const source = resolve(runPath), output = resolve(outputPath);
await mkdir(output);
const summary = JSON.parse(await readFile(join(source, 'summary.json'), 'utf8'));
const capture = join(source, 'parity-wasm/capture.hsft');
assert.equal(await sha256(capture), summary.parity[0].products.stream.sha256);
const request = JSON.parse(await readFile(join(source, 'request.json'), 'utf8'));
const results = [];
for (let iteration = 0; iteration <= 4; iteration++) {
    for (const [name, executable] of iteration % 2 ? [['candidate', candidate], ['baseline', baseline]] : [['baseline', baseline], ['candidate', candidate]]) {
        const directory = join(output, `${iteration}-${name}`);
        await mkdir(directory);
        const requestPath = join(directory, 'request.json');
        await writeFile(requestPath, JSON.stringify({ ...request, verify_incremental_state: iteration === 4 }));
        const input = openSync(capture, 'r'), log = openSync(join(directory, 'encoder.log'), 'wx');
        const started = performance.now();
        try {
            const child = spawnSync(executable, ['encode', requestPath, join(directory, 'products')], {
                stdio: [input, log, log], timeout: 1800000, killSignal: 'SIGKILL',
                env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(BLAMPC_|H1_EXPORT_|VIEWER_ARTIFACT_)/i.test(key))),
            });
            if (child.error) throw child.error;
            assert.equal(child.status, 0, `${directory}: ${child.signal}`);
        } finally { closeSync(input); closeSync(log); }
        const seconds = (performance.now() - started) / 1000;
        const products = {};
        for (const name of (await readdir(join(directory, 'products'))).sort()) {
            const path = join(directory, 'products', name);
            if ((await stat(path)).isFile() && name !== 'encoding.json') products[name] = { sha256: await sha256(path), bytes: (await stat(path)).size };
        }
        assert.deepEqual(products, summary.runs[0].products);
        const result = { iteration, name, seconds, full_source_proof: iteration === 4 };
        results.push(result);
        console.log(JSON.stringify(result));
    }
}
await writeFile(join(output, 'summary.json'), JSON.stringify({ baseline_sha256: await sha256(baseline), candidate_sha256: await sha256(candidate), results }, null, 2));
