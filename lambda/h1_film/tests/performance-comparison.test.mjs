import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('performance comparison ignores spatial timings but preserves artifact identity', () => {
  const temporary = realpathSync(tmpdir());
  const directory = realpathSync(mkdtempSync(join(temporary, 'h1-performance-')));
  const baseline = join(directory, 'baseline'), candidate = join(directory, 'candidate');
  const save = (root, name, value) => writeFileSync(join(root, name), JSON.stringify(value));
  const payload = duration => ({ spatial_artifact: { sha256: 'retained-artifact',
    metadata: { parser: 'halospawns-replay-parser', parse_duration_ms: duration, process_peak_rss_kib: duration } } });
  const compare = () => spawnSync(process.execPath, [fileURLToPath(new URL('../tools/compare-performance.mjs', import.meta.url)),
    '--baseline', baseline, '--candidate', candidate], { encoding: 'utf8', timeout: 10000 });
  try {
    for (const root of [baseline, candidate]) {
      mkdirSync(root);
      save(root, 'report.json', { envelope: {}, simulation: {}, engine_profile: 'retained',
        provenance: { film_sha256: 'film', map_sha256: 'map', wasm_sha256: 'wasm', glue_sha256: 'glue' },
        timing: { total_seconds: 1 } });
      save(root, 'verification.json', { status: 'verified', total_seconds: 1 });
      for (const name of ['finalization.json', 'full-reparse-completion.json', 'viewer-rebuild-completion.json']) {
        save(root, name, payload(root === baseline ? 1 : 0));
      }
    }
    const matched = compare();
    assert.equal(matched.status, 0, matched.stderr);
    const changed = payload(0);
    changed.spatial_artifact.sha256 = 'different-artifact';
    save(candidate, 'full-reparse-completion.json', changed);
    const rejected = compare();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /full-reparse-completion.json/);
  } finally {
    assert.equal(dirname(realpathSync(directory)), temporary);
    rmSync(directory, { recursive: true });
  }
});
