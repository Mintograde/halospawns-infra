import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '../runtime/engine-store.mjs';

// Hash input contents and relative paths, never absolute paths or mtimes. Only
// CMakeLists.txt, engine and host are mounted as upstream WASM build inputs.
export async function fingerprintTree(root, entries) {
  const records = [];
  async function visit(path) {
    const info = await lstat(join(root, path));
    assert.ok(!info.isSymbolicLink(), 'Source snapshots cannot contain symlinks');
    if (info.isDirectory()) {
      for (const child of (await readdir(join(root, path))).sort()) {
        await visit(path ? `${path}/${child}` : child);
      }
    } else {
      assert.ok(info.isFile(), 'Source snapshot contains a non-file');
      records.push([path, info.size, await sha256(join(root, path))]);
    }
  }
  for (const entry of [...entries].sort()) await visit(entry);
  return { algorithm: 'halospawns.sourceTreeSha256.v1', files: records.length,
    sha256: createHash('sha256').update(JSON.stringify(records)).digest('hex') };
}
