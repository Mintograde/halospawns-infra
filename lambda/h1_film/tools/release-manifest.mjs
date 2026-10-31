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
  const { defaults, recipes, requirements } = registry.processing;
  for (const profile of registry.profiles) {
    assert.ok(recipes[profile.id]?.some(recipe =>
      JSON.stringify(recipe) === JSON.stringify(defaults[profile.id])), 'Missing default recipe');
    for (const recipe of recipes[profile.id]) {
      assert.ok(recipe.exporter_revision === 1 || registry.exporters.some(exporter =>
        exporter.engine_profile === profile.id && exporter.revision === recipe.exporter_revision));
      assert.ok([1, 2, 3, 4].includes(recipe.analytics_revision));
      assert.ok([2, 4, 5].includes(recipe.viewer_revision));
      assert.ok(Number.isInteger(recipe.max_players) && recipe.max_players >= 1 && recipe.max_players <= 16);
    }
  }
  return { schema: 'halospawns.h1FilmRelease.v1', release_id: releaseId,
    image_digest: imageDigest, registry, defaults, recipes, requirements };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [releaseId, imageDigest, output, registryPath] = process.argv.slice(2);
  const registry = JSON.parse(readFileSync(registryPath ?? new URL('../profiles/registry.json', import.meta.url)));
  writeFileSync(output, JSON.stringify(createReleaseManifest(registry, releaseId, imageDigest), null, 2) + '\n');
}
