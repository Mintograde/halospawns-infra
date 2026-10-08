import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fingerprintTree } from '../tools/source-fingerprint.mjs';

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
