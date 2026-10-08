import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { verifyEngine } from './profiles.mjs';

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

export async function inspectEngine(profile, gluePath) {
  const glue = resolve(gluePath);
  assert.equal(glue.endsWith('.js'), true, 'Engine entry point must end in .js');
  const wasm = glue.slice(0, -3) + '.wasm';
  for (const path of [glue, wasm]) {
    const info = await lstat(path);
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'Engine artifacts must be regular files');
    assert.ok(info.size > 0 && info.size <= 128 * 1024 * 1024, 'Engine artifact size exceeds limit');
  }
  const hashes = { glue_sha256: await sha256(glue), wasm_sha256: await sha256(wasm) };
  verifyEngine(profile, hashes);
  return { glue, wasm, hashes };
}

export async function resolveEngine(profile, root) {
  const base = await realpath(root);
  assert.match(profile.id, /^[a-z0-9][a-z0-9-]{0,95}$/, 'Invalid engine profile ID');
  const path = join(base, profile.id);
  assert.ok(!(await lstat(path)).isSymbolicLink(), 'Engine profiles cannot be symlinks');
  const directory = await realpath(path);
  // Exactly one immutable directory per profile. Never fall back to newest.
  assert.equal(dirname(directory), base, 'Engine profile must be a direct store child');
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')),
    { type: 'commonjs' }, 'Pinned Emscripten glue requires a CommonJS package boundary');
  return inspectEngine(profile, join(directory, 'h1-film.js'));
}
