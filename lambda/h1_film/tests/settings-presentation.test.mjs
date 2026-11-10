import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const registry = read('../profiles/registry.json');
const metadata = read('../contracts/h1film-settings-presentation.v1.json');
test('every modern engine carries settings presentation bound to its exact source', () => {
  const legacy = new Set(['beta3', 'h1arena', 'beta4', 'beta5']);
  for (const engine of registry.profiles.filter(engine => !legacy.has(engine.port))) {
    const profile = metadata.profiles[engine.id];
    assert.ok(profile, `Generate settings metadata before releasing ${engine.id}`);
    assert.equal(profile.source_commit, engine.source.git_commit);
    assert.equal(profile.source_sha256, engine.source.sha256);
    assert.equal(profile.presets.length, 7);
    assert.equal(profile.presets[1].label, 'FFA 50');
    assert.equal(profile.presets[2].label, 'CTF 3');
    assert.equal(profile.presets[0].values['variant.footstep_sounds_level'], 0);
    assert.equal(profile.presets[0].values['variant.pickup_sounds'], 100);
    assert.equal(profile.presets[0].values['variant.overtime_length_min'], 2);
  }
});
