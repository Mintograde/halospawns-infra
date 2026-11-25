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
    if(profile.port==='beta8') assert.equal(requirements.beta8,'halospawns.h1Beta8.v1');
    if(profile.port==='beta7') assert.equal(requirements.beta7,'halospawns.h1Beta7.v1');
    for (const recipe of recipes[profile.id]) {
      assert.equal(recipe.viewer_revision===15,recipe.exporter_revision>=50,'Capped client network recipe differs');
      if (recipe.viewer_revision===15) {
        assert.ok(['beta6','beta7','beta8'].includes(profile.port));
        assert.equal(requirements.capped_client_network,'halospawns.h1MatchReplay.v10');
      }
      if(recipe.exporter_revision>=40) {
        assert.equal(requirements.tick_rates,"halospawns.h1TickRates.v1");
        if(recipe.exporter_revision<42) assert.ok(['beta4','beta5','beta6','beta7','beta8'].includes(profile.port));
        if(['beta6','beta7','beta8'].includes(profile.port))assert.ok([14,15].includes(recipe.viewer_revision));
      }
      if(recipe.viewer_revision===14)assert.ok(recipe.exporter_revision>=40);
      if(recipe.exporter_revision>=39)
        assert.equal(requirements.client_melee_timing,'halospawns.h1GameplayMetrics.v1');
      if(recipe.exporter_revision>=42) assert.equal(requirements.sniper,'halospawns.h1SniperKills.v1');
      if(recipe.exporter_revision>=43) assert.equal(requirements.sniper_evidence,'halospawns.h1SniperKills.v2');
      if(recipe.exporter_revision>=45) assert.equal(requirements.sniper_zoom_reset,'halospawns.h1SniperZoomReset.v1');
      if(recipe.exporter_revision>=46) {
        assert.equal(requirements.verified_pov_recovery,'halospawns.h1VerifiedPovRecovery.v1');
        assert.ok([14,15].includes(recipe.viewer_revision));
      }
      if(recipe.exporter_revision>=44) assert.equal(requirements.sniper_damage,'halospawns.h1SniperKills.v3');
      if(recipe.exporter_revision>=36 && ['beta5','beta6','beta7','beta8'].includes(profile.port)) {
        assert.equal(requirements.remote_melee_timing,'halospawns.h1GameplayMetrics.v1');
        assert.equal(recipe.analytics_revision,5);
      }
      if(recipe.exporter_revision>=34)
        assert.equal(requirements.spawn_neutral_baseline,'halospawns.h1SpawnMetrics.v1');
      if(recipe.exporter_revision>=32)
        assert.equal(requirements.spawn_metrics,'halospawns.h1SpawnMetrics.v1');
      if(recipe.exporter_revision>=30)
        assert.equal(requirements.player_camo_amount,'halospawns.h1PlayerCamoAmount.v1');
      if(recipe.exporter_revision>=29 && (recipe.exporter_revision<30 || ['beta5','beta6','beta7','beta8'].includes(profile.port))) {
        assert.equal(requirements.melee_metrics,'halospawns.h1GameplayMetrics.v1');
        assert.equal(recipe.analytics_revision,5);
      }
      if(recipe.exporter_revision>=28) {
        assert.equal(requirements.pistol_accuracy,'halospawns.h1PistolAccuracy.v1');
        assert.ok(recipe.analytics_revision>=4);
      }
      if(recipe.exporter_revision>=26 && (recipe.exporter_revision<28 || ['beta6','beta7','beta8'].includes(profile.port))) {
        assert.ok(['beta6','beta7','beta8'].includes(profile.port));
        assert.equal(requirements.network_host_bots,'halospawns.h1NetworkHostBots.v1');
      }
      if(recipe.viewer_revision<14)assert.equal(profile.port==='beta8',recipe.viewer_revision===13);
      if(profile.port==='beta8') assert.ok([35,36,37,38,39,40,42,43,44,45,46,47,48,49,50,51].includes(recipe.exporter_revision));
      if(recipe.viewer_revision<14)assert.equal(profile.port==='beta7',[11,12].includes(recipe.viewer_revision));
      if(profile.port==='beta7')assert.equal(recipe.exporter_revision>=33,[12,14,15].includes(recipe.viewer_revision));
      if(recipe.viewer_revision===12)assert.equal(requirements.large_match_replay,'halospawns.h1MatchReplay.v7');
      assert.ok(recipe.exporter_revision === 1 || registry.exporters.some(exporter =>
        exporter.engine_profile === profile.id && exporter.revision === recipe.exporter_revision));
      assert.ok([1, 2, 3, 4, 5].includes(recipe.analytics_revision));
      if(recipe.analytics_revision===5) {
        assert.ok(['beta5','beta6','beta7','beta8'].includes(profile.port)&&recipe.exporter_revision>=19);
        assert.equal(requirements.gameplay_metrics,'halospawns.h1GameplayMetrics.v1');
      }
      if(recipe.exporter_revision>=21 && (recipe.exporter_revision<28 || recipe.analytics_revision===5)) {
        assert.ok(['beta5','beta6','beta7','beta8'].includes(profile.port) && recipe.analytics_revision===5);
        assert.equal(requirements.gameplay_estimates,'halospawns.h1GameplayEstimates.v1');
      }
      if(recipe.exporter_revision>=24)
        assert.equal(requirements.three_shot_headshot,'halospawns.h1GameplayMetrics.v1');
      assert.ok([2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].includes(recipe.viewer_revision));
      if(['beta6','beta7','beta8'].includes(profile.port)) {
        assert.equal(recipe.exporter_revision>=16,recipe.viewer_revision>=7);
        assert.equal(recipe.exporter_revision>=17,recipe.viewer_revision>=8);
        assert.equal(recipe.exporter_revision>=18,recipe.viewer_revision>=9);
        assert.equal(recipe.exporter_revision>=22,recipe.viewer_revision>=10);
      }
      if(recipe.viewer_revision>=7) {
        assert.ok(['beta6','beta7','beta8'].includes(profile.port));assert.ok(recipe.exporter_revision>=16);
        assert.equal(requirements.partial_match_replay,'halospawns.h1MatchReplay.v2');
      }
      if(recipe.viewer_revision>=8) {
        assert.ok(recipe.exporter_revision>=17);
        assert.equal(requirements.compact_match_replay,'halospawns.h1MatchReplay.v3');
      }
      if(recipe.viewer_revision>=9) assert.equal(requirements.client_roster_mismatch,'halospawns.h1MatchReplay.v4');
      if(recipe.viewer_revision>=10) assert.equal(requirements.unsupported_client_build,'halospawns.h1MatchReplay.v5');
      assert.ok(Number.isInteger(recipe.max_players) && recipe.max_players >= 1 && recipe.max_players <= 16);
    }
  }
  if (client_view_recipes !== undefined) {
    assert.equal(requirements.client_view, 'halospawns.h1ClientView.v1');
    assert.deepEqual(Object.keys(client_view_recipes), ['h1-performance-beta5-p9818-wasm-v1']);
    for (const [id, entries] of Object.entries(client_view_recipes)) {
      assert.ok(Array.isArray(entries) && entries.length > 0);
      for (const recipe of entries) {
        if(recipe.exporter_revision>=41)assert.equal(requirements.tick_rates,'halospawns.h1TickRates.v1');
        if(recipe.exporter_revision>=30)
          assert.equal(requirements.player_camo_amount,'halospawns.h1PlayerCamoAmount.v1');
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
