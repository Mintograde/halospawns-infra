import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ENGINE_PROFILES, ENGINE_EXPORTERS, validateRegistry, validateExporters,
  assertRetainedProfiles, assertRetainedExporters, profileById, selectExporter } from '../runtime/profiles.mjs';
import { resolveEngine } from '../runtime/engine-store.mjs';
import { BUILD_MATCHING } from '../runtime/profiles.mjs';

const { values } = parseArgs({ options: {
  'engine-root': { type: 'string' }, 'previous-registry': { type: 'string' },
} });
assert.ok(values['engine-root'], 'Use --engine-root <private release directory>');
const retained = validateRegistry(JSON.parse(await readFile(
  new URL('../tests/fixtures/retained-profiles.json', import.meta.url), 'utf8')));
assertRetainedProfiles(ENGINE_PROFILES, retained);
if (values['previous-registry']) {
  const previous = JSON.parse(await readFile(values['previous-registry'], 'utf8'));
  assertRetainedProfiles(ENGINE_PROFILES, validateRegistry(previous));
  assertRetainedExporters(ENGINE_EXPORTERS, validateExporters(previous));
  for (const [name, rule] of Object.entries(previous.build_matching ?? {})) {
    assert.equal(BUILD_MATCHING[name], rule, 'Previously supported recorded build rule changed');
  }
}
for (const profile of [...ENGINE_PROFILES, ...ENGINE_EXPORTERS.map(entry =>
  selectExporter(profileById(entry.engine_profile), entry.revision))]) {
  const engine = await resolveEngine(profile, values['engine-root']);
  console.log(JSON.stringify({ profile: profile.id, exporter_revision: profile.exporter_revision,
    status: 'verified', ...engine.hashes, ...(profile.source ? { source: profile.source } : {}) }));
}
