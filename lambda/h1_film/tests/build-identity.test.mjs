import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { matchesProfile, validateBuildMatching, SOURCE_COMMIT_RULE } from '../runtime/build-identity.mjs';
import { ENGINE_PROFILES, BUILD_MATCHING, selectProfile, resolveMap } from '../runtime/profiles.mjs';
import { createReleaseManifest } from '../tools/release-manifest.mjs';

const cases = JSON.parse(readFileSync(new URL('./fixtures/recorded-builds.json', import.meta.url)));
const beta5 = ENGINE_PROFILES.find(p => p.port === 'beta5');

test('PB2 recorder labels match clean source commits without rewriting evidence', () => {
  for (const [kind, labels] of Object.entries(cases)) for (const build of labels) {
    const film = { ...beta5, build };
    assert.equal(matchesProfile(beta5, film, SOURCE_COMMIT_RULE), kind === 'accepted', build);
    if (kind === 'accepted') {
      assert.equal(selectProfile(film), beta5);
      assert.equal(film.build, build);
      for (const key of ['format', 'protocol_revision', 'tick_rate']) {
        assert.throws(() => selectProfile({ ...film, [key]: 1 }));
      }
    } else assert.throws(() => selectProfile(film));
  }
  const beta4 = ENGINE_PROFILES.find(p => p.port === 'beta4');
  assert.equal(selectProfile({ ...beta4, build: 'Repack - e78e4daa' }), beta4);
  const arena = ENGINE_PROFILES.find(p => p.port === 'h1arena');
  assert.throws(() => selectProfile({ ...arena, build: `Repack - ${arena.source.git_commit.slice(0, 8)}` }));
  assert.throws(() => selectProfile({ ...beta5, build: cases.accepted[1] }, ENGINE_PROFILES, {}));
  const map = { engine_profile: beta5.id, scenario: 'dread', size_bytes: 123, sha256: 'a'.repeat(64) };
  assert.deepEqual(resolveMap(beta5, { ...beta5, build: cases.accepted[1], map: 'dread', map_bytes: 123 },
    { schema: 'halospawns.h1FilmMapCatalog.v1', maps: [map] }), map);
});

test('recorded build rules require explicit registration, source and reader contract', () => {
  const other = { ...beta5, id: 'ambiguous', build: 'Other',
    source: { ...beta5.source, git_commit: `fbbfae27${'0'.repeat(32)}` } };
  assert.throws(() => validateBuildMatching([beta5, other], {
    [beta5.id]: BUILD_MATCHING[beta5.id], ambiguous: SOURCE_COMMIT_RULE,
  }), /Ambiguous/);
  assert.throws(() => validateBuildMatching([beta5, { ...other, build: 'Repack - fbbfae27' }], {
    [beta5.id]: BUILD_MATCHING[beta5.id],
  }), /Ambiguous/);
  assert.throws(() => validateBuildMatching([beta5], { unknown: SOURCE_COMMIT_RULE }));
  assert.throws(() => validateBuildMatching([beta5], { [beta5.id]: 'any_build' }));
  assert.throws(() => validateBuildMatching([{ ...beta5, source: undefined }], { [beta5.id]: SOURCE_COMMIT_RULE }));
  const registry = JSON.parse(readFileSync(new URL('../profiles/registry.json', import.meta.url)));
  createReleaseManifest(registry, '20261031-r2', `sha256:${'a'.repeat(64)}`);
  delete registry.processing.requirements.recorded_build;
  assert.throws(() => createReleaseManifest(registry, '20261031-r2', `sha256:${'a'.repeat(64)}`));
});
