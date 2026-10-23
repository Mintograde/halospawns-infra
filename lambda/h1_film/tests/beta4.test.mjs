import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readEnvelope, adapterFor } from '../runtime/film.mjs';
import * as beta4 from '../runtime/adapters/beta4-v2-120.mjs';
import { readEnvelope as readArena } from '../runtime/adapters/h1arena-v2-120.mjs';
import { ENGINE_PROFILES, selectProfile, selectExporter } from '../runtime/profiles.mjs';
import { convertFilm } from '../runtime/convert.mjs';

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

function fixture({ players = 2, joins = [2] } = {}) {
  const shift = 12376 - 32;
  const film = Buffer.alloc(606 + shift + joins.length * 44);
  const fields = { 0: 0x314d4c46, 1: 2, 2: 9803, 3: 120, 4: 12376, 5: 32, 6: 4, 7: 10,
    11: 1, 12: 526 + shift, 13: 120, 14: 2, 15: 100, 16: 480, 17: 516 + shift, 18: 480, 19: 512 + shift, 20: 4, 25: 1,
    31: players };
  for (const [word, value] of Object.entries(fields)) film.writeUInt32LE(value, Number(word) * 4);
  film.write('dread', 128);
  film.write('2026-10-20 - BETA 4 - e78e4daa', 384);
  film.writeBigUInt64LE(1792540800n, 464);
  film.writeUInt32LE(550 + shift, 448);
  film.writeUInt32LE(56 + joins.length * 44, 452);
  film.writeUInt32LE(0x314c5254, 526 + shift);
  film.writeUInt32LE(1, 530 + shift);
  for (const [index, value] of [0x54454e46, 2, 32, joins.length, joins.length * 44, 0, 1, 24 + joins.length * 44,
    joins.length * 44, joins.length * 44, 0, 0, joins.length, 0].entries()) {
    film.writeUInt32LE(value, 550 + shift + index * 4);
  }
  for (const [index, handle] of joins.entries()) {
    film.writeUInt16LE(7, 610 + shift + index * 44);
    film.writeUInt16LE(36, 612 + shift + index * 44);
    film.writeUInt32LE(handle, 614 + shift + index * 44);
    film.writeInt32LE(360, 622 + shift + index * 44);
  }
  return film;
}

function botFixture({ bots = 7, seats = 1, marker = true, settings =
  `[tuning]\nbots = ${bots}\nbot_skill = 3\nbot_teams = auto\n` } = {}) {
  const optionsSize = marker ? 12380 : 12376;
  const settingsOffset = 480 + optionsSize;
  const stream = settingsOffset + Buffer.byteLength(settings);
  const trailer = stream + 10;
  const film = Buffer.alloc(trailer + 24);
  const fields = { 0: 0x314d4c46, 1: 2, 2: 9803, 3: 120, 4: optionsSize, 5: 32, 6: 4,
    11: 1, 12: trailer, 13: 120, 14: 2, 15: 100, 16: 480, 17: stream, 18: 480,
    19: settingsOffset, 20: Buffer.byteLength(settings), 25: seats };
  for (const [word, value] of Object.entries(fields)) film.writeUInt32LE(value, Number(word) * 4);
  film.write('dread', 128);
  film.write('2026-10-20 - BETA 4 - e78e4daa', 384);
  if (marker) film.writeUInt32LE(bots, 480 + 12376);
  film.write(settings, settingsOffset);
  film.writeUInt32LE(0x314c5254, trailer);
  film.writeUInt32LE(1, trailer + 4);
  return film;
}

test('beta4 counts recorded bots as participants and keeps them off retained exporters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beta4-bots-'));
  const path = join(root, 'input.h1film');
  try {
    await writeFile(path, botFixture());
    const envelope = await readEnvelope(path);
    assert.equal(envelope.players, 8);
    assert.equal(envelope.bots, 7);
    assert.equal(envelope.network, undefined);
    for (const revision of [5, 6]) {
      await assert.rejects(convertFilm({ film: path, assets: root, encoder: root, output: join(root, 'output'),
        'trusted-local': true, 'exporter-revision': String(revision) }), /Bot films require exporter revision 7/);
    }
    await writeFile(path, botFixture({ bots: 11 }));
    assert.equal((await readEnvelope(path)).players, 12);
    await writeFile(path, botFixture({ bots: 8, seats: 4 }));
    assert.equal((await readEnvelope(path)).players, 12);
    await writeFile(path, botFixture({ bots: 0, marker: false }));
    assert.equal((await readEnvelope(path)).bots, undefined);
    for (const changes of [
      { bots: 0 }, { bots: 12 }, { bots: 9, seats: 4 }, { marker: false },
      { settings: '[tuning]\nbots=6\nbot_skill=3\nbot_teams=auto\n' },
      { settings: '[tuning]\nbots=7\nbots=7\nbot_skill=3\nbot_teams=auto\n' },
      { settings: '[tuning]\nbots=7\nbot_skill=4\nbot_teams=auto\n' },
      { settings: '[tuning]\nbots=7\nbot_skill=3\nbot_teams=0 1\n' },
      { settings: '[tuning]\nbots=7\n' },
    ]) {
      await writeFile(path, botFixture(changes));
      await assert.rejects(readEnvelope(path));
    }
    await writeFile(path, botFixture({ settings: '[tuning]\nbots=7\nbot_skill=1\nbot_teams=0,1,auto\n' }));
    assert.equal((await readEnvelope(path)).bots, 7);
  } finally { await rm(root, { recursive: true }); }
});

test('beta4 admits sixteen participants and bounds slots, replacements and initial metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beta4-roster-'));
  const path = join(root, 'input.h1film');
  const joins = Array.from({ length: 14 }, (_, index) => 65536 + index + 2);
  try {
    await writeFile(path, fixture({ joins }));
    const envelope = await readEnvelope(path);
    assert.equal(envelope.players, 2);
    assert.equal(envelope.network.participant_count, 16);
    assert.equal(envelope.network.max_player_slot, 15);
    for (const changes of [
      { joins: [...joins, 131074] }, { joins: [65552] }, { joins: [65538, 65538] },
      { players: 9 }, { players: 17 },
    ]) {
      await writeFile(path, fixture(changes));
      await assert.rejects(readEnvelope(path));
    }
    await writeFile(path, fixture({ joins: [65538, 131074] }));
    assert.equal((await readEnvelope(path)).network.participant_count, 4);
    await writeFile(path, fixture({ players: 8, joins: [65544] }));
    assert.equal((await readEnvelope(path)).network.participant_count, 9);
  } finally { await rm(root, { recursive: true }); }
});

test('beta4 routes timestamp and join records without relaxing the retained arena reader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beta4-film-'));
  const path = join(root, 'input.h1film');
  try {
    await writeFile(path, fixture());
    const envelope = await readEnvelope(path);
    assert.equal(envelope.protocol_revision, 9803);
    assert.equal(envelope.build, '2026-10-20 - BETA 4 - e78e4daa');
    assert.equal(envelope.created_utc, 1792540800);
    assert.deepEqual(envelope.network, { records: 1, applications: 1, blocks: 1, participant_count: 3, max_player_slot: 2 });
    assert.equal(adapterFor({ adapter: 'beta4-v2-120-v1' }), beta4);
    await assert.rejects(readArena(path), /header extension/);
    for (const [offset, value] of [[12, 30], [16, 12380], [472, 1], [124, 17], [12958, 16], [12966, 0xffffffff]]) {
      const invalid = fixture();
      invalid.writeUInt32LE(value, offset);
      await writeFile(path, invalid);
      await assert.rejects(readEnvelope(path), `offset ${offset}`);
    }
  } finally { await rm(root, { recursive: true }); }
});

test('beta4 reads both UTC words, treats zero as unknown and rejects out-of-range dates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beta4-utc-'));
  const path = join(root, 'input.h1film');
  try {
    for (const timestamp of [0n, 1792540800n, 4294967296n, 253402300799n]) {
      const film = fixture();
      film.writeBigUInt64LE(timestamp, 464);
      await writeFile(path, film);
      const envelope = await readEnvelope(path);
      assert.equal(envelope.created_utc, timestamp ? Number(timestamp) : undefined);
    }
    for (const timestamp of [253402300800n, 0xffffffffffffffffn]) {
      const film = fixture();
      film.writeBigUInt64LE(timestamp, 464);
      await writeFile(path, film);
      await assert.rejects(readEnvelope(path), /UTC timestamp/);
    }
  } finally { await rm(root, { recursive: true }); }
});
