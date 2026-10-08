// Stage reviewed artifacts into a private release bundle, never replace a profile.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { profileById } from '../runtime/profiles.mjs';
import { inspectEngine } from '../runtime/engine-store.mjs';

const { values } = parseArgs({ options: {
  profile: { type: 'string' }, from: { type: 'string' }, 'engine-root': { type: 'string' },
} });
assert.ok(values.from && values['engine-root'] && values.profile,
  'Use --profile <id> --from <h1-film.js> --engine-root <private directory>');
const profile = profileById(values.profile);
const engine = await inspectEngine(profile, values.from);
const root = resolve(values['engine-root']);
await mkdir(root, { recursive: true });
const destination = join(root, profile.id), partial = destination + '.partial';
assert.equal(dirname(partial), root, 'Stage directory must remain inside the engine store');
await assert.rejects(lstat(destination), { code: 'ENOENT' }, 'Engine profile already staged');
// The unique new directory is ours; an interrupted prior stage requires review.
await mkdir(partial);
try {
  await copyFile(engine.glue, join(partial, 'h1-film.js'), constants.COPYFILE_EXCL);
  await copyFile(engine.wasm, join(partial, 'h1-film.wasm'), constants.COPYFILE_EXCL);
  await writeFile(join(partial, 'package.json'), '{"type":"commonjs"}\n', { flag: 'wx' });
  await inspectEngine(profile, join(partial, 'h1-film.js'));
  await rename(partial, destination);
} catch (error) {
  await rm(partial, { recursive: true });
  throw error;
}
console.log(JSON.stringify({ profile: profile.id, directory: destination, ...engine.hashes }));
