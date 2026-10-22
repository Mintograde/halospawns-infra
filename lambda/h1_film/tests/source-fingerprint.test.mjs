import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fingerprintTree } from '../tools/source-fingerprint.mjs';

test('beta4 build rejects a different archived commit even with a valid tree fingerprint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beta4-source-'));
  try {
    for (const directory of ['engine', 'host', 'tools']) await mkdir(join(root, directory));
    await writeFile(join(root, 'CMakeLists.txt'), 'candidate');
    const tree = await fingerprintTree(root, ['CMakeLists.txt', 'engine', 'host', 'tools']);
    await writeFile(join(root, 'source-revision.json'), JSON.stringify({ ...tree, project: 'h1arena',
      git_commit: '197bb65ca6e9cef94c126904bf39ecdd1ea5929d', git_date: '2026-10-14' }));
    assert.throws(() => execFileSync(process.execPath,
      [fileURLToPath(new URL('../tools/describe-build.mjs', import.meta.url)), '--port', 'beta4', '--source', root],
      { stdio: 'pipe' }), /Source commit differs from the pinned port/);
  } finally { await rm(root, { recursive: true }); }
});

test('source fingerprints survive relocation but change on content, additions and removals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h1-source-'));
  try {
    for (const name of ['a', 'b']) {
      await mkdir(join(root, name, 'engine'), { recursive: true });
      await writeFile(join(root, name, 'engine', 'test.c'), 'test source');
    }
    const a = await fingerprintTree(join(root, 'a'), ['engine']);
    assert.deepEqual(await fingerprintTree(join(root, 'b'), ['engine']), a);
    await writeFile(join(root, 'b', 'engine', 'test.c'), 'next source');
    assert.notEqual((await fingerprintTree(join(root, 'b'), ['engine'])).sha256, a.sha256);
    await writeFile(join(root, 'a', 'engine', 'new.h'), 'header');
    assert.notEqual((await fingerprintTree(join(root, 'a'), ['engine'])).sha256, a.sha256);
    await rm(join(root, 'a', 'engine', 'new.h'));
    assert.deepEqual(await fingerprintTree(join(root, 'a'), ['engine']), a);
  } finally { await rm(root, { recursive: true }); }
});
