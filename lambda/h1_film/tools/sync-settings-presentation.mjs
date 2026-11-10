import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  profile: { type: 'string', multiple: true, default: [] }, api: { type: 'string' }, frontend: { type: 'string' }
} });
const path = join(root, 'contracts/h1film-settings-presentation.v1.json');
let bundle;
try { bundle = JSON.parse(await readFile(path)); }
catch (error) { if (error.code !== 'ENOENT') throw error; bundle = { schema: 'halospawns.h1SettingsPresentationCatalogue.v1', profiles: {} }; }
const registry = JSON.parse(await readFile(join(root, 'profiles/registry.json')));
for (const file of values.profile) {
  const metadata = JSON.parse(await readFile(resolve(file)));
  assert.equal(metadata.schema, 'halospawns.h1SettingsPresentation.v1');
  bundle.profiles[metadata.engine_profile] = metadata;
}
const legacy = new Set(['beta3', 'h1arena', 'beta4', 'beta5']);
for (const engine of registry.profiles) {
  if (legacy.has(engine.port)) continue;
  const metadata = bundle.profiles[engine.id];
  assert(metadata, `Generate settings metadata for ${engine.id} before syncing`);
  assert.equal(metadata.source_commit, engine.source.git_commit);
  assert.equal(metadata.source_sha256, engine.source.sha256);
}
const bytes = JSON.stringify(bundle, null, 2) + '\n';
await writeFile(path, bytes);
for (const destination of [
  values.api && join(resolve(values.api), 'contracts/h1film/settings-presentation.v1.json'),
  values.frontend && join(resolve(values.frontend), 'packages/shared/src/contracts/h1film-settings-presentation.v1.json')
].filter(Boolean)) {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}
console.log(`Synced ${Object.keys(bundle.profiles).length} source-bound settings profiles`);
