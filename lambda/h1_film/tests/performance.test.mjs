import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('exporter performance comparisons require full stream parity and unchanged replay products', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h1-performance-'));
  const save = (name, value) => writeFile(join(root, name), JSON.stringify(value));
  const hash = c => c.repeat(64);
  const simulation = { played_ticks: 10, hash_checks: 2, seed_mismatches: 0, hash_mismatches: 0 };
  const proofs = [];
  try {
    for (const [index, side] of ['baseline', 'candidate'].entries()) {
      await mkdir(join(root, side));
      const provenance = { film_sha256: hash('a'), map_sha256: hash('b'),
        wasm_sha256: hash(index ? 'd' : 'c'), glue_sha256: hash('e') };
      const exporter_revision = index + 2;
      await save(`${side}/report.json`, { envelope: {}, simulation, engine_profile: 'test',
        map_binding: {}, provenance, exporter_revision, encoding: { transport_bytes: 100 },
        timing: { total_seconds: 2 - index } });
      const callback = { h1film: { exporter_revision, wasm_sha256: provenance.wasm_sha256,
        glue_sha256: provenance.glue_sha256 }, viewer_artifact: { sha256: hash('f'), size_bytes: 50 } };
      for (const name of ['finalization', 'full-reparse-completion', 'viewer-rebuild-completion']) {
        await save(`${side}/${name}.json`, callback);
      }
      await save(`${side}/verification.json`, { status: 'offline_cloud_worker_verified',
        film_sha256: provenance.film_sha256, total_seconds: 3 - index, viewer_bytes: 50 });
      const proof = { ...provenance, exporter_revision, simulation, transport_bytes: 100, transport_sha256: hash('1') };
      proofs.push(proof);
      await save(`${side}-engine.json`, proof);
    }
    const baseArgs = [fileURLToPath(new URL('../tools/compare-performance.mjs', import.meta.url)),
      '--baseline', join(root, 'baseline'), '--candidate', join(root, 'candidate')];
    const args = [...baseArgs, '--baseline-engine', join(root, 'baseline-engine.json'),
      '--candidate-engine', join(root, 'candidate-engine.json')];
    const run = (flags = args) => execFileSync(process.execPath, flags, { encoding: 'utf8', stdio: 'pipe' });
    assert.throws(() => run(baseArgs), /Command failed/);
    assert.equal(JSON.parse(run()).full_export_parity, true);
    for (const wrong of [
      { transport_sha256: hash('2') }, { transport_bytes: 101 },
      { film_sha256: hash('3') }, { wasm_sha256: hash('4') }, { exporter_revision: 2 },
      { simulation: { ...simulation, hash_mismatches: 1 } }, { aot_module_sha256: hash('5') },
    ]) {
      await save('candidate-engine.json', { ...proofs[1], ...wrong });
      assert.throws(() => run(), /Command failed/);
    }
    await save('candidate-engine.json', proofs[1]);
    const packedReport = JSON.parse(await readFile(join(root, 'candidate/report.json'), 'utf8'));
    packedReport.encoding = { transport_bytes: 60, transport_contract: 'HSFT0002' };
    await save('candidate/report.json', packedReport);
    const packedProof = { ...proofs[1], transport_contract: 'HSFT0002', transport_bytes: 60,
      transport_sha256: hash('7'), canonical_bytes: 100, canonical_sha256: hash('1') };
    await save('candidate-engine.json', packedProof);
    assert.equal(JSON.parse(run()).full_export_parity, true);
    for (const wrong of [{ canonical_sha256: hash('8') }, { canonical_bytes: 101 },
      { canonical_sha256: undefined }, { transport_contract: 'HSFT0001' }, { transport_bytes: 61 }]) {
      await save('candidate-engine.json', { ...packedProof, ...wrong });
      assert.throws(() => run(), /Command failed/);
    }
    await save('candidate-engine.json', packedProof);
    await save('candidate/finalization.json', { h1film: { exporter_revision: 3,
      wasm_sha256: proofs[1].wasm_sha256, glue_sha256: proofs[1].glue_sha256 },
      viewer_artifact: { sha256: hash('9'), size_bytes: 50 } });
    assert.throws(() => run(), /Command failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
