import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ENGINE_PROFILES, resolveMap, selectProfile, verifyEngine,
  validateRegistry, assertRetainedProfiles, REGISTRY_SCHEMA, selectExporter,
  validateExporters, assertRetainedExporters, ENGINE_EXPORTERS } from '../runtime/profiles.mjs';

const profile = ENGINE_PROFILES[0];
const envelope = { ...profile, map: 'dread', map_bytes: 2048 };
const map = { engine_profile: profile.id, scenario: 'dread', size_bytes: 2048, sha256: 'a'.repeat(64) };
const catalog = maps => ({ schema: 'halospawns.h1FilmMapCatalog.v1', maps });
const registry = profiles => ({ schema: REGISTRY_SCHEMA, profiles });

test('exporter revisions retain the simulation identity and reject unknown or rewritten pins', () => {
  assert.equal(selectExporter(profile, undefined), profile);
  const current = selectExporter(profile, 2);
  for (const key of ['id', 'format', 'protocol_revision', 'tick_rate', 'build']) {
    assert.equal(current[key], profile[key]);
  }
  assert.notEqual(current.wasm_sha256, profile.wasm_sha256);
  assert.equal(selectExporter(profile, 1).wasm_sha256, profile.wasm_sha256);
  const optimized = selectExporter(profile, 3);
  assert.notEqual(optimized.wasm_sha256, current.wasm_sha256);
  const packed = selectExporter(profile, 4);
  assert.equal(packed.transport_contract, 'HSFT0002');
  assert.equal(packed.export_contract, profile.export_contract);
  for (const retained of ENGINE_PROFILES) {
    const combat = selectExporter(retained, 5);
    assert.equal(combat.id, retained.id);
    assert.equal(combat.transport_contract, 'HSFT0002');
    if (retained.port === 'beta4') {
      assert.throws(() => selectExporter(retained, 4), /Unknown exporter revision/);
    } else {
      assert.notEqual(combat.wasm_sha256, selectExporter(retained, 4).wasm_sha256);
    }
    assert.deepEqual(combat.source, retained.source);
  }
  assert.equal(optimized.transport_contract, undefined);
  assert.equal(validateExporters({ exporters: [{ ...ENGINE_EXPORTERS[0], transport_contract: 'HSFT0001' }] })[0].transport_contract, 'HSFT0001');
  assert.throws(() => validateExporters({ exporters: [{ ...ENGINE_EXPORTERS.at(-1), transport_contract: 'HSFT9999' }] }));
  for (const key of ['id', 'format', 'protocol_revision', 'tick_rate', 'build']) {
    assert.equal(optimized[key], profile[key]);
  }
  for (const revision of [0, 999, true, '2']) assert.throws(() => selectExporter(profile, revision));
  assertRetainedExporters(ENGINE_EXPORTERS, ENGINE_EXPORTERS);
  assert.throws(() => assertRetainedExporters([], ENGINE_EXPORTERS));
  assert.throws(() => validateExporters({ exporters: [...ENGINE_EXPORTERS, ...ENGINE_EXPORTERS] }));
});

test('adding a later decompilation retains exact old film routing independent of order', () => {
  const later = { ...profile, id: 'future-fixture-only', protocol_revision: 46,
    build: 'Future test build', wasm_sha256: 'b'.repeat(64), glue_sha256: 'c'.repeat(64) };
  for (const order of [[profile, later], [later, profile]]) {
    const profiles = validateRegistry(registry(order));
    assert.equal(selectProfile(envelope, profiles).id, profile.id);
    assert.equal(selectProfile(later, profiles).id, later.id);
    assertRetainedProfiles(profiles, [profile]);
  }
  assert.throws(() => selectProfile({ ...envelope, protocol_revision: 999 }, [profile, later]));
  assert.throws(() => verifyEngine(profile, later), /pinned engine/);
});

test('registry rejects ambiguous, unsupported and path-escaping profiles', () => {
  for (const entries of [[profile, profile], [profile, { ...profile, id: 'ambiguous' }],
    [{ ...profile, id: '../engine' }], [{ ...profile, port: '../port' }],
    [{ ...profile, adapter: 'unknown' }], [{ ...profile, export_contract: 'HSFT0002' }],
    [{ ...profile, tick_rate: 60 }], [{ ...profile, build: '' }]]) {
    assert.throws(() => validateRegistry(registry(entries)));
  }
});

test('every retained profile stays present with identical identities, contracts and binaries', async () => {
  const previous = validateRegistry(JSON.parse(await readFile(
    new URL('./fixtures/retained-profiles.json', import.meta.url), 'utf8')));
  assertRetainedProfiles(ENGINE_PROFILES, previous);
  assert.throws(() => assertRetainedProfiles([], previous), /Unknown engine/);
  for (const key of ['wasm_sha256', 'glue_sha256', 'build', 'adapter', 'port', 'export_contract']) {
    assert.throws(() => assertRetainedProfiles([{ ...profile, [key]: 'changed' }], previous),
      /Previously supported/);
  }
});

test('dispatch binds format, protocol, rate, build and both engine artifacts', () => {
  assert.equal(selectProfile(envelope), profile);
  for (const key of ['format', 'protocol_revision', 'tick_rate', 'build']) {
    assert.throws(() => selectProfile({ ...envelope, [key]: 'unknown' }));
  }
  verifyEngine(profile, profile);
  assert.throws(() => verifyEngine(profile, { ...profile, wasm_sha256: 'b'.repeat(64) }));
  assert.throws(() => verifyEngine(profile, { ...profile, glue_sha256: 'b'.repeat(64) }));
});

test('map names and file sizes cannot cross builds or resolve ambiguous cache variants', () => {
  assert.deepEqual(resolveMap(profile, envelope, catalog([map])), map);
  for (const maps of [[], [{ ...map, engine_profile: 'another-build' }],
    [{ ...map, size_bytes: 2049 }], [map, { ...map, sha256: 'b'.repeat(64) }]]) {
    assert.throws(() => resolveMap(profile, envelope, catalog(maps)));
  }
  assert.throws(() => resolveMap(profile, { ...envelope, map: '../dread' }, catalog([map])));
  assert.throws(() => resolveMap(profile, { ...envelope, build: 'different build' }, catalog([map])));
  assert.throws(() => resolveMap(profile, envelope, catalog([{ ...map, sha256: 'not-a-hash' }])));
});
