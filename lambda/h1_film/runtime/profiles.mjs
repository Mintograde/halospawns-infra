import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const REGISTRY_SCHEMA = 'halospawns.h1EngineRegistry.v1';
const ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const IDENTITY = ['format', 'protocol_revision', 'tick_rate', 'build'];

export function validateRegistry(document) {
  assert.equal(document?.schema, REGISTRY_SCHEMA, 'Unsupported engine registry');
  assert.ok(Array.isArray(document.profiles) && document.profiles.length > 0
    && document.profiles.length <= 64, 'Invalid engine profile count');
  const ids = new Set(), identities = new Set();
  const profiles = document.profiles.map(entry => {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry));
    const profile = { ...entry };
    assert.match(profile.id, ID, 'Invalid engine profile ID');
    assert.match(profile.port, ID, 'Invalid engine port');
    assert.equal(profile.adapter, 'film-v2-120-v1', 'Unsupported film adapter');
    assert.equal(profile.format, 2, 'Adapter requires format 2');
    assert.equal(profile.tick_rate, 120, 'Adapter requires 120 Hz');
    assert.ok(Number.isSafeInteger(profile.protocol_revision) && profile.protocol_revision > 0);
    assert.ok(typeof profile.build === 'string' && profile.build.length > 0
      && Buffer.byteLength(profile.build) < 64 && !profile.build.includes('\0'));
    assert.equal(profile.export_contract, 'HSFT0001', 'Unsupported engine export contract');
    assert.equal(profile.analytics_contract, 'halospawns.h1AnalyticsSource.v1');
    assert.equal(profile.map_cache_version, 7, 'Unsupported map cache format');
    for (const key of ['wasm_sha256', 'glue_sha256']) assert.match(profile[key], /^[0-9a-f]{64}$/);
    const identity = JSON.stringify(IDENTITY.map(key => profile[key]));
    assert.ok(!ids.has(profile.id), 'Duplicate engine profile ID');
    assert.ok(!identities.has(identity), 'Ambiguous film engine identity');
    ids.add(profile.id); identities.add(identity);
    return Object.freeze(profile);
  });
  return Object.freeze(profiles);
}

export const ENGINE_PROFILES = validateRegistry(JSON.parse(
  readFileSync(new URL('../profiles/registry.json', import.meta.url), 'utf8')));

export function selectProfile(envelope, profiles = ENGINE_PROFILES) {
  const matches = profiles.filter(profile => IDENTITY.every(key => profile[key] === envelope[key]));
  assert.equal(matches.length, 1, 'Unsupported film engine profile');
  return matches[0];
}

export function profileById(id, profiles = ENGINE_PROFILES) {
  const profile = profiles.find(profile => profile.id === id);
  assert.ok(profile, 'Unknown engine profile');
  return profile;
}

export function assertRetainedProfiles(current, previous) {
  for (const profile of previous) {
    assert.deepEqual(profileById(profile.id, current), profile,
      `Previously supported engine profile changed: ${profile.id}`);
  }
}

export function verifyEngine(profile, hashes) {
  assert.equal(hashes.wasm_sha256, profile.wasm_sha256, 'WASM differs from the pinned engine profile');
  assert.equal(hashes.glue_sha256, profile.glue_sha256, 'Node glue differs from the pinned engine profile');
}

// This catalog is trusted deployment/API input, never a browser-supplied map ID.
// Format 2 records a name and size, not a cryptographic map hash. A reviewed
// build-to-map binding plus clean simulation hashes is required for exactness.
export function resolveMap(profile, envelope, catalog) {
  selectProfile(envelope, [profile]);
  assert.equal(catalog.schema, 'halospawns.h1FilmMapCatalog.v1');
  assert.ok(Array.isArray(catalog.maps) && catalog.maps.length <= 4096, 'Invalid map catalog');
  assert.match(envelope.map, /^[a-zA-Z0-9_-]+$/, 'Invalid scenario name');
  const matches = catalog.maps.filter(map => map.engine_profile === profile.id
    && map.scenario === envelope.map && map.size_bytes === envelope.map_bytes);
  assert.equal(matches.length, 1, matches.length ? 'Ambiguous map binding' : 'Matching raw map unavailable');
  const map = matches[0];
  assert.match(map.sha256, /^[0-9a-f]{64}$/, 'Invalid raw map hash');
  assert.ok(Number.isSafeInteger(map.size_bytes) && map.size_bytes > 0 && map.size_bytes <= 512 * 1024 * 1024);
  if (map.map_id !== undefined) {
    assert.match(map.map_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
  if (map.game_release_key !== undefined) assert.match(map.game_release_key, /^[a-z0-9][a-z0-9_]{0,79}$/);
  return Object.fromEntries(['engine_profile', 'scenario', 'size_bytes', 'sha256', 'map_id', 'game_release_key']
    .filter(key => map[key] !== undefined).map(key => [key, map[key]]));
}
