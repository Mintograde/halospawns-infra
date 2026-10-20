import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../runtime/engine-store.mjs';
import { fingerprintTree } from '../source-fingerprint.mjs';

const [argument] = process.argv.slice(2);
assert.ok(argument, 'Supply the private evidence root');
const root = resolve(argument);
const native = join(root, 'native-final');
const inputs = JSON.parse(await readFile(join(native, 'generated/inputs.json'), 'utf8'));
const receipt = JSON.parse((await readFile(join(native, 'build.json'), 'utf8')).replace(/^\uFEFF/, ''));
assert.equal(await sha256(join(native, 'h1-film-linux')), receipt.executable_sha256);
const source = await fingerprintTree(join(root, 'src'), ['CMakeLists.txt', 'engine', 'host', 'tools', 'linux_server', 'scripts']);
assert.deepEqual(source, inputs.source.native_tree, 'Archived source changed during the experiment');
const baselinePort = await fingerprintTree(join(root, 'wasm-worker-r3/engines'), ['h1arena', 'beta3']);
assert.deepEqual(await fingerprintTree(join(root, 'wasm-worker-final/engines'), ['h1arena', 'beta3']), baselinePort,
  'Reproducible baseline preparation differs from the measured port');
const report = { schema: 'halospawns.h1LinuxCandidateEvidence.v1', status: 'offline-experiment-only',
  source: inputs.source, native: receipt,
  measurement: { binary_sha256: await sha256(join(native, 'measure')),
    source_sha256: await sha256(fileURLToPath(new URL('./measure.c', import.meta.url))) },
  wasm: { glue_sha256: await sha256(join(root, 'wasm-r5/h1-film.js')),
    wasm_sha256: await sha256(join(root, 'wasm-r5/h1-film.wasm')), port: baselinePort,
    toolchain: 'emscripten/emsdk:4.0.10@sha256:90b757eb11fa9a0e3ce4d2d9f76d932a56018e4accc37b5a28b2783751e60eb7' },
  experiment_code: await fingerprintTree(fileURLToPath(new URL('./', import.meta.url)),
    ['CMakeLists.txt', 'include', 'platform.c', 'headless-extra.c', 'measure.c', 'build.ps1', 'prepare.mjs',
      'prepare-wasm.mjs', 'trap-stubs.mjs', 'benchmark.mjs', 'run.ps1', 'collect.mjs', 'seal.mjs']) };
await writeFile(join(root, 'candidate-evidence.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
