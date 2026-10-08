import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ENGINE_PROFILES, validateRegistry, assertRetainedProfiles } from '../runtime/profiles.mjs';
import { resolveEngine } from '../runtime/engine-store.mjs';

const { values } = parseArgs({ options: {
  'engine-root': { type: 'string' }, 'previous-registry': { type: 'string' },
} });
assert.ok(values['engine-root'], 'Use --engine-root <private release directory>');
const retained = validateRegistry(JSON.parse(await readFile(
  new URL('../tests/fixtures/retained-profiles.json', import.meta.url), 'utf8')));
assertRetainedProfiles(ENGINE_PROFILES, retained);
if (values['previous-registry']) {
  assertRetainedProfiles(ENGINE_PROFILES, validateRegistry(JSON.parse(
    await readFile(values['previous-registry'], 'utf8'))));
}
for (const profile of ENGINE_PROFILES) {
  const engine = await resolveEngine(profile, values['engine-root']);
  console.log(JSON.stringify({ profile: profile.id, status: 'verified', ...engine.hashes }));
}
