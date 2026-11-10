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
const presentation = JSON.parse(await readFile(new URL('../contracts/h1film-settings-presentation.v1.json', import.meta.url), 'utf8'));
const legacySettings = new Set(['beta3', 'h1arena', 'beta4', 'beta5']);
for (const profile of ENGINE_PROFILES.filter(profile => !legacySettings.has(profile.port))) {
  const metadata = presentation.profiles[profile.id];
  assert.ok(metadata, `Generate and sync settings presentation before releasing ${profile.id}`);
  assert.equal(metadata.source_commit, profile.source.git_commit);
  assert.equal(metadata.source_sha256, profile.source.sha256);
}
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
  const current = JSON.parse(await readFile(new URL('../profiles/registry.json', import.meta.url), 'utf8'));
  for (const [id, recipes] of Object.entries(previous.processing?.client_view_recipes ?? {})) {
    assert.equal(current.processing.requirements.client_view, previous.processing.requirements.client_view);
    for (const recipe of recipes) assert.ok(current.processing.client_view_recipes?.[id]?.some(r =>
      JSON.stringify(r) === JSON.stringify(recipe)), 'Previously supported client recipe removed');
  }
}
for (const profile of [...ENGINE_PROFILES, ...ENGINE_EXPORTERS.map(entry =>
  selectExporter(profileById(entry.engine_profile), entry.revision))]) {
  const engine = await resolveEngine(profile, values['engine-root']);
  console.log(JSON.stringify({ profile: profile.id, exporter_revision: profile.exporter_revision,
    status: 'verified', ...engine.hashes, ...(profile.source ? { source: profile.source } : {}) }));
}
