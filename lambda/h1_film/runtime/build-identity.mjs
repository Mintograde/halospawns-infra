import assert from 'node:assert/strict';

export const BUILD_MATCHING_CONTRACT = 'halospawns.h1RecordedBuild.v1';
export const SOURCE_COMMIT_RULE = 'source_commit_suffix_v1';
const SIMULATION_IDENTITY = ['format', 'protocol_revision', 'tick_rate'];

export function matchesProfile(profile, film, rule) {
  if (!SIMULATION_IDENTITY.every(key => film[key] === profile[key])) return false;
  if (film.build === profile.build) return true;
  if (rule !== SOURCE_COMMIT_RULE || typeof film.build !== 'string'
    || film.build.length < 1 || film.build.length > 63 || /[^\x20-\x7e]/.test(film.build)) return false;
  const commit = /(?:^| - )([0-9a-f]{8,40})$/.exec(film.build);
  return Boolean(commit && profile.source?.git_commit?.startsWith(commit[1]));
}

export function validateBuildMatching(profiles, rules = {}) {
  assert.ok(rules && typeof rules === 'object' && !Array.isArray(rules), 'Invalid recorded build rules');
  for (const [name, rule] of Object.entries(rules)) {
    const profile = profiles.find(profile => profile.id === name);
    assert.ok(profile && rule === SOURCE_COMMIT_RULE && profile.source?.project === 'h1arena'
      && /^[0-9a-f]{40}$/.test(profile.source.git_commit), 'Invalid recorded build rule or source');
  }
  for (const [index, profile] of profiles.entries()) {
    for (const other of profiles.slice(index + 1)) {
      if (!SIMULATION_IDENTITY.every(key => profile[key] === other[key])) continue;
      assert.ok(!(matchesProfile(profile, other, rules[profile.id])
        || matchesProfile(other, profile, rules[other.id])
        || (rules[profile.id] && rules[other.id]
          && profile.source.git_commit.slice(0, 8) === other.source.git_commit.slice(0, 8))),
      'Ambiguous recorded build matching rules');
    }
  }
  return Object.freeze({ ...rules });
}
