import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRegistry } from '../runtime/profiles.mjs';
import { BUILD_MATCHING_CONTRACT, validateBuildMatching } from '../runtime/build-identity.mjs';

export function createReleaseManifest(registry, releaseId, imageDigest) {
  const profiles = validateRegistry(registry);
  const rules = validateBuildMatching(profiles, registry.build_matching);
  if (Object.keys(rules).length) assert.equal(registry.processing.requirements.recorded_build, BUILD_MATCHING_CONTRACT);
  assert.match(releaseId, /^\d{8}-r[1-9]\d*$/);
  assert.match(imageDigest, /^sha256:[0-9a-f]{64}$/);
  const { defaults, recipes, requirements, client_view_recipes } = registry.processing;
  for (const profile of registry.profiles) {
    assert.ok(recipes[profile.id]?.some(recipe =>
      JSON.stringify(recipe) === JSON.stringify(defaults[profile.id])), 'Missing default recipe');
    for (const recipe of recipes[profile.id]) {
      assert.ok(recipe.exporter_revision === 1 || registry.exporters.some(exporter =>
        exporter.engine_profile === profile.id && exporter.revision === recipe.exporter_revision));
      assert.ok([1, 2, 3, 4].includes(recipe.analytics_revision));
      assert.ok([2, 4, 5, 6, 7, 8, 9].includes(recipe.viewer_revision));
      if(profile.port==='beta6') {
        assert.equal(recipe.exporter_revision>=16,recipe.viewer_revision>=7);
        assert.equal(recipe.exporter_revision>=17,recipe.viewer_revision>=8);
        assert.equal(recipe.exporter_revision>=18,recipe.viewer_revision===9);
      }
      if(recipe.viewer_revision>=7) {
        assert.equal(profile.port,'beta6');assert.ok(recipe.exporter_revision>=16);
        assert.equal(requirements.partial_match_replay,'halospawns.h1MatchReplay.v2');
      }
      if(recipe.viewer_revision>=8) {
        assert.ok(recipe.exporter_revision>=17);
        assert.equal(requirements.compact_match_replay,'halospawns.h1MatchReplay.v3');
      }
      if(recipe.viewer_revision===9) assert.equal(requirements.client_roster_mismatch,'halospawns.h1MatchReplay.v4');
      assert.ok(Number.isInteger(recipe.max_players) && recipe.max_players >= 1 && recipe.max_players <= 16);
    }
  }
  if (client_view_recipes !== undefined) {
    assert.equal(requirements.client_view, 'halospawns.h1ClientView.v1');
    assert.deepEqual(Object.keys(client_view_recipes), ['h1-performance-beta5-p9818-wasm-v1']);
    for (const [id, entries] of Object.entries(client_view_recipes)) {
      assert.ok(Array.isArray(entries) && entries.length > 0);
      for (const recipe of entries) {
        assert.ok(recipe.exporter_revision >= 13 && recipe.analytics_revision === 2 && recipe.viewer_revision === 5);
        assert.ok(Number.isInteger(recipe.max_players) && recipe.max_players >= 1 && recipe.max_players <= 16);
        assert.ok(registry.exporters.some(e => e.engine_profile === id && e.revision === recipe.exporter_revision));
        assert.ok(!recipes[id].some(r => r.exporter_revision === recipe.exporter_revision), 'Client exporter appears in host recipes');
      }
    }
  }
  return { schema: 'halospawns.h1FilmRelease.v1', release_id: releaseId,
    image_digest: imageDigest, registry, defaults, recipes, requirements,
    ...(client_view_recipes === undefined ? {} : {client_view_recipes}) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [releaseId, imageDigest, output, registryPath] = process.argv.slice(2);
  const registry = JSON.parse(readFileSync(registryPath ?? new URL('../profiles/registry.json', import.meta.url)));
  writeFileSync(output, JSON.stringify(createReleaseManifest(registry, releaseId, imageDigest), null, 2) + '\n');
}
