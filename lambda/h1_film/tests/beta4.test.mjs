import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readEnvelope, adapterFor } from '../runtime/film.mjs';
import * as beta4 from '../runtime/adapters/beta4-v2-120.mjs';
import { readEnvelope as readArena } from '../runtime/adapters/h1arena-v2-120.mjs';
import { ENGINE_PROFILES, selectProfile, selectExporter } from '../runtime/profiles.mjs';

test('beta4 selects its exact release identity and exporter without repinning the prerelease', () => {
  const profile = ENGINE_PROFILES.find(entry => entry.port === 'beta4');
  assert.equal(profile.source.git_commit, 'e78e4daa4b6d6b3e9ca290e3ebfe7a993ed558ad');
  assert.equal(profile.build, '2026-10-20 - BETA 4 - e78e4daa');
  assert.equal(selectProfile(profile), profile);
  assert.equal(selectExporter(profile, 5).transport_contract, 'HSFT0002');
  assert.throws(() => selectProfile({ ...profile, build: '2026-10-20 - BETA 4 - e78e4dab' }));
  const retained = ENGINE_PROFILES.find(entry => entry.port === 'h1arena');
  assert.equal(retained.source.git_commit, '197bb65ca6e9cef94c126904bf39ecdd1ea5929d');
  assert.equal(selectProfile(retained), retained);
});

function fixture() {
  const shift = 12376 - 32;
  const film = Buffer.alloc(650 + shift);
  const fields = { 0: 0x314d4c46, 1: 2, 2: 9803, 3: 120, 4: 12376, 5: 32, 6: 4, 7: 10,
    11: 1, 12: 526 + shift, 13: 120, 14: 2, 15: 100, 16: 480, 17: 516 + shift, 18: 480, 19: 512 + shift, 20: 4, 25: 1,
    31: 2 };
  for (const [word, value] of Object.entries(fields)) film.writeUInt32LE(value, Number(word) * 4);
  film.write('dread', 128);
  film.write('2026-10-20 - BETA 4 - e78e4daa', 384);
  film.writeBigUInt64LE(1792540800n, 464);
  film.writeUInt32LE(550 + shift, 448);
  film.writeUInt32LE(100, 452);
  film.writeUInt32LE(0x314c5254, 526 + shift);
  film.writeUInt32LE(1, 530 + shift);
  for (const [index, value] of [0x54454e46, 2, 32, 1, 44, 0, 1, 68, 44, 44, 0, 0, 1, 0].entries()) {
    film.writeUInt32LE(value, 550 + shift + index * 4);
  }
  film.writeUInt16LE(7, 610 + shift);
  film.writeUInt16LE(36, 612 + shift);
  film.writeUInt32LE(2, 614 + shift);
  film.writeInt32LE(360, 622 + shift);
  return film;
}

test('beta4 routes timestamp and join records without relaxing the retained arena reader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beta4-film-'));
  const path = join(root, 'input.h1film');
  try {
    await writeFile(path, fixture());
    const envelope = await readEnvelope(path);
    assert.equal(envelope.protocol_revision, 9803);
    assert.equal(envelope.build, '2026-10-20 - BETA 4 - e78e4daa');
    assert.deepEqual(envelope.network, { records: 1, applications: 1, blocks: 1 });
    assert.equal(adapterFor({ adapter: 'beta4-v2-120-v1' }), beta4);
    await assert.rejects(readArena(path), /header extension/);
    for (const [offset, value] of [[12, 30], [16, 12380], [472, 1], [124, 5], [12958, 4], [12966, 0xffffffff]]) {
      const invalid = fixture();
      invalid.writeUInt32LE(value, offset);
      await writeFile(path, invalid);
      await assert.rejects(readEnvelope(path), `offset ${offset}`);
    }
  } finally { await rm(root, { recursive: true }); }
});
