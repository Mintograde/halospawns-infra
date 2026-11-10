import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,openSync,closeSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exportWriteBuffer} from '../runtime/export-write-buffer.mjs';

test('owns mutable engine bytes, handles partial writes, and flushes the final tail', () => {
  const output = [];
  const writer = exportWriteBuffer((fd, data, offset, length) => {
    assert.equal(fd, 3);
    const n = Math.min(length, 997);
    output.push(Buffer.from(data.subarray(offset, offset + n)));
    return n;
  }, 3, 4096);
  const source = Buffer.alloc(20000);
  for (let i = 0; i < source.length; i++) source[i] = (i * 71) % 251;
  const expected = Buffer.from(source);
  for (const [offset, length] of [[0, 8], [8, 4], [12, 17000], [17012, 2988]]) {
    assert.equal(writer.write(3, source, offset, length), length);
    source.fill(0, offset, offset + length);
  }
  assert.ok(Buffer.concat(output).length < expected.length);
  writer.flush();
  writer.flush();
  assert.deepEqual(Buffer.concat(output), expected);
  assert.equal(writer.stats.bytes, expected.length);
  assert.equal(writer.stats.calls, 4);
});

test('preserves other descriptors and rejects unsupported export signatures', () => {
  let received;
  const writer = exportWriteBuffer((...args) => { received = args; return 17; }, 3, 4096);
  assert.equal(writer.write(2, 'diagnostic', 'utf8'), 17);
  assert.deepEqual(received, [2, 'diagnostic', 'utf8']);
  assert.throws(() => writer.write(3, 'text', 0, 4));
  assert.throws(() => writer.write(3, Buffer.alloc(4), 0, 5));
  assert.throws(() => writer.write(3, Buffer.alloc(4), 0, 4, 0));
  for (const capacity of [0, 4095, 1048577, NaN, 4096.5]) {
    assert.throws(() => exportWriteBuffer(() => {}, 3, capacity));
  }
});

test('partial-write failures are terminal and cannot replay consumed bytes', () => {
  for (const result of ['EAGAIN', 'EPIPE', 'zero']) {
    let calls = 0;
    const writer = exportWriteBuffer(() => {
      if (++calls === 1) return 19;
      if (result === 'zero') return 0;
      throw Object.assign(new Error(result), {code: result});
    }, 3, 4096);
    assert.throws(() => writer.write(3, Buffer.alloc(4096), 0, 4096), /Buffered export write failed/);
    assert.throws(() => writer.flush(), /Buffered export write failed/);
    assert.throws(() => writer.write(3, Buffer.alloc(1), 0, 1), /Buffered export write failed/);
    assert.equal(calls, 2);
  }
});

test('sandboxed process exit drains pending bytes before metrics; final-write failures fail the process', () => {
  const directory = mkdtempSync(join(tmpdir(), 'h1-export-buffer-'));
  const metricsModule = fileURLToPath(new URL('../runtime/metrics.mjs', import.meta.url));
  const bufferModule = fileURLToPath(new URL('../runtime/export-write-buffer.mjs', import.meta.url));
  try {
    for (const broken of [false, true]) {
      const product = join(directory, broken ? 'broken.bin' : 'ok.bin');
      const metrics = join(directory, broken ? 'broken.json' : 'ok.json');
      const initial = openSync(product, 'wx');closeSync(initial);
      const descriptor = openSync(product, broken ? 'r' : 'w');
      let result;
      try {
        result = spawnSync(process.execPath, ['--permission',
          `--allow-fs-read=${metricsModule}`, `--allow-fs-read=${bufferModule}`,
          `--allow-fs-write=${directory}`, '--import', new URL('../runtime/metrics.mjs', import.meta.url).href, '--input-type=module', '-e',
          'import fs from "node:fs";const b=Buffer.alloc(37,71);fs.writeSync(3,b,0,b.length);b.fill(0);process.exit(0);'], {
          env: {...process.env, H1_EXPORT_HANDLE: '3', H1_EXPORT_BUFFER_BYTES: '4096', H1_EXPORT_METRICS: metrics},
          stdio: ['ignore', 'pipe', 'pipe', descriptor], timeout: 10000, windowsHide: true,
        });
      } finally {closeSync(descriptor);}
      assert.equal(result.error, undefined);
      if (broken) {
        assert.notEqual(result.status, 0);
        assert.equal(existsSync(metrics), false);
        assert.match(result.stderr.toString(), /Buffered export write failed/);
      } else {
        assert.equal(result.status, 0, result.stderr.toString());
        assert.deepEqual(readFileSync(product), Buffer.alloc(37, 71));
        assert.deepEqual(JSON.parse(readFileSync(metrics)).exportWriteBuffer,
          {capacity: 4096, calls: 1, writes: 1, bytes: 37});
      }
    }
  } finally {rmSync(directory, {recursive: true});}
});
