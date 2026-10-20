import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, openSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [runArgument, encoderArgument, outputArgument] = process.argv.slice(2);
assert.ok(runArgument && encoderArgument && outputArgument, 'Supply comparison, encoder and new output paths');
const run = resolve(runArgument), encoder = resolve(encoderArgument), output = resolve(outputArgument);
const summary = JSON.parse(await readFile(join(run, 'summary.json'), 'utf8'));
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
assert.equal(await digest(encoder), summary.candidate_encoder_sha256, 'Verify the measured encoder');
await mkdir(output);
const results = [];
for (const result of summary.results) {
  const name = result.fixture.name;
  assert.match(name, /^[a-z0-9-]+$/);
  const capture = join(run, `${name}-parity-wasm`, 'capture.hsft');
  assert.equal(await digest(capture), result.capture.find(entry => entry.kind === 'wasm').products.stream.sha256);
  const directory = join(output, name);
  await mkdir(directory);
  const request = JSON.parse(await readFile(join(run, `${name}-run-1-native`, 'request.json'), 'utf8'));
  request.verify_incremental_state = true;
  const requestPath = join(directory, 'request.json');
  await writeFile(requestPath, JSON.stringify(request, null, 2) + '\n', { flag: 'wx' });
  const input = openSync(capture, 'r'), log = openSync(join(directory, 'encoder.log'), 'wx');
  try {
    const child = spawnSync(encoder, ['encode', requestPath, join(directory, 'products')], {
      stdio: [input, log, log], timeout: 1800000, killSignal: 'SIGKILL',
      env: Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !/^(BLAMPC_|H1_EXPORT_|VIEWER_ARTIFACT_)/i.test(key))),
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, `${name}: full-source verification failed (${child.signal})`);
  } finally {
    closeSync(input);
    closeSync(log);
  }
  const products = {};
  for (const file of (await readdir(join(directory, 'products'))).sort()) {
    const path = join(directory, 'products', file);
    if ((await stat(path)).isFile() && file !== 'encoding.json') {
      products[file] = { sha256: await digest(path), bytes: (await stat(path)).size };
    }
  }
  assert.deepEqual(products, result.runs.find(entry => entry.kind === 'wasm').products);
  const encoding = JSON.parse(await readFile(join(directory, 'products/encoding.json'), 'utf8'));
  assert.equal(encoding.source_ticks, result.fixture.ticks);
  results.push({ fixture: name, ticks: encoding.source_ticks, products });
  console.log(JSON.stringify({ fixture: name, verified_ticks: encoding.source_ticks }));
}
await writeFile(join(output, 'verification.json'), JSON.stringify({
  schema: 'halospawns.h1LinuxSourceVerification.v1', candidate_encoder_sha256: summary.candidate_encoder_sha256,
  source_comparison: run, results,
}, null, 2) + '\n', { flag: 'wx' });
