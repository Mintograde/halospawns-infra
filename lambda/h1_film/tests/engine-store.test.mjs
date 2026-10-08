import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveEngine } from '../runtime/engine-store.mjs';
import { ENGINE_PROFILES, selectProfile, validateRegistry, REGISTRY_SCHEMA } from '../runtime/profiles.mjs';

test('bundled old and new engines coexist; missing or corrupt old files never use newest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h1-engine-store-'));
  try {
    const profiles = [];
    for (const [index, id] of ['old-fixture', 'new-fixture'].entries()) {
      const directory = join(root, id), glue = `glue ${id}`, wasm = `wasm ${id}`;
      await mkdir(directory);
      await writeFile(join(directory, 'h1-film.js'), glue);
      await writeFile(join(directory, 'h1-film.wasm'), wasm);
      await writeFile(join(directory, 'package.json'), '{"type":"commonjs"}');
      profiles.push({ ...ENGINE_PROFILES[0], id, build: id, protocol_revision: 45 + index,
        wasm_sha256: createHash('sha256').update(wasm).digest('hex'),
        glue_sha256: createHash('sha256').update(glue).digest('hex') });
    }
    const registry = validateRegistry({ schema: REGISTRY_SCHEMA, profiles: profiles.toReversed() });
    for (const profile of profiles) {
      const selected = selectProfile(profile, registry);
      assert.equal((await resolveEngine(selected, root)).glue, join(root, profile.id, 'h1-film.js'));
    }
    await writeFile(join(root, profiles[0].id, 'h1-film.wasm'), 'tampered');
    await assert.rejects(resolveEngine(profiles[0], root), /pinned engine/);
    await rm(join(root, profiles[0].id, 'h1-film.wasm'));
    await assert.rejects(resolveEngine(profiles[0], root), { code: 'ENOENT' });
    await resolveEngine(profiles[1], root);
    await writeFile(join(root, profiles[1].id, 'package.json'), '{"type":"module"}');
    await assert.rejects(resolveEngine(profiles[1], root), /CommonJS/);
  } finally { await rm(root, { recursive: true }); }
});
