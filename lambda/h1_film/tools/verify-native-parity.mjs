import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readEnvelope } from '../runtime/film.mjs';
import { sha256 } from '../runtime/engine-store.mjs';
import { verifyPlayback as verifyBeta3 } from '../runtime/adapters/film-v2-120.mjs';
import { verifyPlayback as verifyArena } from '../runtime/adapters/h1arena-v2-120.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  native: { type: 'string' }, engine: { type: 'string' }, assets: { type: 'string' }, output: { type: 'string' },
} });
for (const key of ['native', 'engine', 'assets', 'output']) {
  assert.ok(values[key], `Missing --${key}`);
  values[key] = resolve(values[key]);
}
assert.ok(positionals.length > 0, 'Supply one or more recorded films');
await mkdir(values.output);
const environment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(BLAMPC_|H1_EXPORT_|VIEWER_ARTIFACT_)/i.test(key)));
Object.assign(environment, { BLAMPC_FILM_RING: '0', BLAMPC_FILM_KEYFRAME_TICKS: '432001',
  BLAMPC_FILM_VIEW_DELIVERED: '1' });

async function replay(kind, cwd, envelope) {
  const stream = join(cwd, `${kind}.hsft`), logPath = join(cwd, `${kind}.log`);
  const log = openSync(logPath, 'wx');
  const output = kind === 'wasm' ? openSync(stream, 'wx') : undefined;
  const args = ['--film', 'input.h1film', '--deterministic', '--ticks', String(envelope.ticks + 10),
    '--dump', kind === 'wasm' ? 'NUL' : stream];
  try {
    const child = spawn(kind === 'wasm' ? process.execPath : values.native,
      kind === 'wasm' ? [values.engine, ...args] : args, {
        cwd, windowsHide: true, timeout: 1800000,
        env: { ...environment, ...(kind === 'wasm' ? { H1_EXPORT_HANDLE: '3' } : {}) },
        stdio: output === undefined ? ['ignore', log, log] : ['ignore', log, log, output],
      });
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', resolveExit);
    });
    assert.equal(code, 0, `${kind} replay failed: ${logPath}`);
  } finally {
    closeSync(log);
    if (output !== undefined) closeSync(output);
  }
  const verify = envelope.protocol_revision === 9111 ? verifyArena : verifyBeta3;
  verify(await readFile(logPath, 'utf8'), envelope);
  return { sha256: await sha256(stream), bytes: (await stat(stream)).size };
}

const results = [];
for (const [index, input] of positionals.entries()) {
  const film = resolve(input), envelope = await readEnvelope(film);
  const cwd = join(values.output, String(index));
  await mkdir(join(cwd, 'maps'), { recursive: true });
  await copyFile(film, join(cwd, 'input.h1film'));
  const map = join(values.assets, 'maps', `${envelope.map}.map`);
  assert.equal((await stat(map)).size, envelope.map_bytes);
  await copyFile(map, join(cwd, 'maps', `${envelope.map}.map`));
  const native = await replay('native', cwd, envelope);
  const wasm = await replay('wasm', cwd, envelope);
  assert.deepEqual(wasm, native, `Native/WASM export differs: ${film}`);
  const result = { film: basename(film), film_sha256: await sha256(film), map_sha256: await sha256(map),
    envelope, stream: native };
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(join(values.output, 'parity.json'), JSON.stringify({
  schema: 'halospawns.h1NativeParity.v1', native_sha256: await sha256(values.native),
  glue_sha256: await sha256(values.engine), wasm_sha256: await sha256(values.engine.replace(/\.js$/, '.wasm')),
  results,
}, null, 2) + '\n');
