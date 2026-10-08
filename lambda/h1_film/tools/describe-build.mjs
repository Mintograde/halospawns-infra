import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fingerprintTree } from './source-fingerprint.mjs';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: { source: { type: 'string' }, port: { type: 'string' } } });
assert.ok(values.source, 'Missing --source');
assert.match(values.port, /^[a-z0-9][a-z0-9-]{0,95}$/, 'Invalid --port');
const directory = fileURLToPath(new URL(`../engines/${values.port}/`, import.meta.url));
const port = JSON.parse(await readFile(new URL(`../engines/${values.port}/port.json`, import.meta.url), 'utf8'));
assert.equal(port.schema, 'halospawns.h1EnginePort.v1');
assert.equal(port.id, values.port);
assert.match(port.toolchain_image, /^emscripten\/emsdk:[0-9.]+@sha256:[0-9a-f]{64}$/);
console.log(JSON.stringify({ schema: 'halospawns.h1EngineBuildInputs.v1', port,
  source: await fingerprintTree(values.source, ['CMakeLists.txt', 'engine', 'host']),
  port_source: await fingerprintTree(directory, ['']) }));
