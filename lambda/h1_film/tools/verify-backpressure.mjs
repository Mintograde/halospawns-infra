// Offline integration check using a real retained engine and private film/map.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { convertFilm } from '../runtime/convert.mjs';

const { values } = parseArgs({ options: {
  film: { type: 'string' }, assets: { type: 'string' }, output: { type: 'string' },
} });
assert.equal(process.platform, 'linux');
assert.ok(values.film && values.assets && values.output);
const directory = resolve(values.output);
await mkdir(directory);
// The Lambda-like /tmp mount is noexec; only the test output mount is executable.
const temporary = await mkdtemp(join(directory, 'encoders-'));
const results = [];
const watchdog = setTimeout(() => {
  console.error('Backpressure verification stalled');
  process.exit(1);
}, 30000);
watchdog.unref();
try {
  for (const [name, script, expected] of [
    ['blocked', 'setTimeout(() => {}, 30000);', /timed out or was interrupted/],
    ['failed', 'process.exit(42);', /Simulator failed|Encoder failed|Cannot configure encoder pipe/],
  ]) {
    const encoder = join(temporary, name);
    await writeFile(encoder, `#!${process.execPath}\n${script}\n`, { mode: 0o755, flag: 'wx' });
    const output = join(directory, name);
    const started = performance.now();
    await assert.rejects(convertFilm({
      film: values.film, assets: values.assets, output, encoder, timeout: '2',
      'trusted-local': true, 'skip-readback': true, 'source-viewer-only': true,
      'engine-permissions': true,
    }), expected);
    const seconds = (performance.now() - started) / 1000;
    assert.ok(seconds < 15, `Child cleanup stalled: ${seconds} seconds`);
    await assert.rejects(access(output), { code: 'ENOENT' });
    const report = JSON.parse(await readFile(join(output + '.partial', 'report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.match(report.error, expected);
    results.push({ name, seconds, status: 'rejected_without_publishing', error: report.error });
  }
  await writeFile(join(directory, 'verification.json'), JSON.stringify(results, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(results));
} finally {
  clearTimeout(watchdog);
  await rm(temporary, { recursive: true });
}
