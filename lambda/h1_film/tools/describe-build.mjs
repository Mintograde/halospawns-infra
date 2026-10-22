import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fingerprintTree } from './source-fingerprint.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const { values } = parseArgs({ options: { source: { type: 'string' }, port: { type: 'string' } } });
assert.ok(values.source, 'Missing --source');
assert.match(values.port, /^[a-z0-9][a-z0-9-]{0,95}$/, 'Invalid --port');
const port = JSON.parse(await readFile(new URL(`../engines/${values.port}/port.json`, import.meta.url), 'utf8'));
assert.equal(port.schema, 'halospawns.h1EnginePort.v1');
assert.equal(port.id, values.port);
assert.match(port.toolchain_image, /^emscripten\/emsdk:[0-9.]+@sha256:[0-9a-f]{64}$/);
const entries = port.source_entries ?? ['CMakeLists.txt', 'engine', 'host'];
const source = await fingerprintTree(values.source, entries);
if (port.source_project) {
  const revision = JSON.parse(await readFile(join(values.source, 'source-revision.json'), 'utf8'));
  assert.equal(revision.project, port.source_project);
  assert.match(revision.git_commit, /^[0-9a-f]{40}$/);
  if (port.source_commit) assert.equal(revision.git_commit, port.source_commit, 'Source commit differs from the pinned port');
  assert.match(revision.git_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(revision.algorithm, source.algorithm);
  assert.equal(revision.sha256, source.sha256, 'Snapshot changed since its Git revision was recorded');
  assert.equal(revision.files, source.files);
  Object.assign(source, { project: revision.project, git_commit: revision.git_commit, git_date: revision.git_date });
}
const shared = port.shared_ports ?? [];
for (const dependency of shared) assert.match(dependency, /^[a-z0-9][a-z0-9-]{0,95}$/);
console.log(JSON.stringify({ schema: 'halospawns.h1EngineBuildInputs.v1', port, source,
  port_source: await fingerprintTree(fileURLToPath(new URL('../engines/', import.meta.url)),
    [values.port, ...shared]) }));
