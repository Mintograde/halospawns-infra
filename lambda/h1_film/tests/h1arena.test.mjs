import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';
import { readEnvelope } from '../runtime/film.mjs';
import { unpackMszip, verifyPlayback } from '../runtime/adapters/h1arena-v2-120.mjs';
import { ENGINE_PROFILES, validateRegistry, selectProfile, assertRetainedProfiles } from '../runtime/profiles.mjs';

export function mszip(bytes) {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0xc0e5510a);
  header.writeUInt16LE(24, 4);
  header[7] = 2;
  header.writeBigUInt64LE(BigInt(bytes.length), 8);
  header.writeBigUInt64LE(BigInt(Math.min(bytes.length, 32768)), 16);
  let checksum = 0xffffffff;
  for (const byte of Buffer.concat([header.subarray(0, 6), header.subarray(7)])) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  header[6] = (checksum ^ 0xffffffff) & 255;
  const parts = [header];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    const compressed = deflateRawSync(bytes.subarray(offset, offset + 32768), {
      dictionary: bytes.subarray(Math.max(0, offset - 32768), offset),
    });
    const prefix = Buffer.alloc(6);
    prefix.writeUInt32LE(compressed.length + 2);
    prefix.write('CK', 4);
    parts.push(prefix, compressed);
  }
  return Buffer.concat(parts);
}

function fixture(packed = true, network = true) {
  const records = Buffer.alloc(88);
  records.writeUInt16LE(3, 4);
  records.writeUInt16LE(4, 6);
  records.writeUInt32LE(2, 8);
  records.writeUInt16LE(1, 16);
  records.writeUInt16LE(68, 18);
  const data = packed ? mszip(records) : records;
  const section = Buffer.alloc(56 + data.length);
  for (const [index, value] of [0x54454e46, 2, 32, 2, 88, 0, 1, section.length - 32,
    88, data.length, 0, 0, 2, Number(packed)].entries()) section.writeUInt32LE(value, index * 4);
  data.copy(section, 56);
  const film = Buffer.alloc(550 + (network ? section.length : 0));
  const fields = { 0: 0x314d4c46, 1: 2, 2: 9111, 3: 120, 4: 32, 5: 32, 6: 4, 7: network ? 10 : 0,
    11: 1, 12: 526, 13: 120, 14: 2, 15: 100, 16: 480, 17: 516, 18: 480, 19: 512, 20: 4, 25: 1,
    30: 0xffff1100, 31: network ? 4 : 0 };
  for (const [word, value] of Object.entries(fields)) film.writeUInt32LE(value, Number(word) * 4);
  film.write('dread', 128);
  film.write('UNIVERSAL Only - 2026-10-14 - 197bb65c', 384);
  film.writeUInt32LE(0x314c5254, 526);
  film.writeUInt32LE(1, 530);
  if (network) {
    film.writeUInt32LE(550, 448);
    film.writeUInt32LE(section.length, 452);
    section.copy(film, 550);
  }
  return film;
}

test('h1arena reads local and compressed/uncompressed network films with the full roster', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h1arena-envelope-'));
  try {
    const path = join(root, 'input.h1film');
    for (const packed of [true, false]) {
      await writeFile(path, fixture(packed));
      const envelope = await readEnvelope(path);
      assert.equal(envelope.players, 4);
      assert.deepEqual(envelope.network, { records: 2, applications: 1, blocks: 1 });
    }
    await writeFile(path, fixture(false, false));
    assert.equal((await readEnvelope(path)).players, 1);
  } finally { await rm(root, { recursive: true }); }
});

test('h1arena rejects missing, capped, malformed, unknown and oversized network evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'h1arena-invalid-'));
  try {
    const path = join(root, 'input.h1film');
    for (const [offset, value] of [[28, 2], [124, 5], [448, 480], [452, 0], [464, 1],
      [570, 1], [554, 3], [562, 3], [566, 90], [574, 4], [582, 0xffffffff], [602, 5]]) {
      const bytes = fixture(false);
      bytes.writeUInt32LE(value, offset);
      await writeFile(path, bytes);
      await assert.rejects(readEnvelope(path), `offset ${offset}`);
    }
    const unknown = fixture(false);
    unknown.writeUInt16LE(99, 610);
    await writeFile(path, unknown);
    await assert.rejects(readEnvelope(path), /Unsupported FNET record/);
  } finally { await rm(root, { recursive: true }); }
});

test('MSZIP handles dictionary-linked chunks and rejects corrupt or trailing data', () => {
  const bytes = Buffer.from('recorded world changes '.repeat(4000));
  const packed = mszip(bytes);
  assert.deepEqual(unpackMszip(packed, bytes.length), bytes);
  assert.throws(() => unpackMszip(packed, bytes.length - 1));
  assert.throws(() => unpackMszip(Buffer.concat([packed, Buffer.from([0])]), bytes.length));
  const corrupt = Buffer.from(packed);
  corrupt[6] ^= 1;
  assert.throws(() => unpackMszip(corrupt, bytes.length), /checksum/);
});

test('network verification requires every recorded effect and zero refused changes', () => {
  const log = '[film] played 1 tick of input\n[film] self-check: 0 seed mismatches, 0 of 1 hash sample differed, 4 control pushes\n'
    + '[film] VERDICT: clean\n[film] network changes put back: 1, 0 refused';
  const envelope = { ticks: 1, hash_samples: 1, network: { records: 2, applications: 1 } };
  assert.equal(verifyPlayback(log, envelope).control_pushes, 4);
  assert.throws(() => verifyPlayback(log.replace('1, 0 refused', '0, 0 refused'), envelope));
  assert.throws(() => verifyPlayback(log.replace('1, 0 refused', '1, 1 refused'), envelope));
  assert.throws(() => verifyPlayback(log.split('[film] network')[0], envelope));
});

test('h1arena provenance is required, retained and cannot select a nearby commit', () => {
  const original = ENGINE_PROFILES[0];
  const source = { project: 'h1arena', git_commit: '1'.repeat(40), git_date: '2026-10-14',
    algorithm: 'halospawns.sourceTreeSha256.v1', files: 12339, sha256: '2'.repeat(64) };
  const next = { ...original, id: 'h1arena-fixture', port: 'h1arena', adapter: 'h1arena-v2-120-v1',
    protocol_revision: 9111, build: 'UNIVERSAL Only - 2026-10-14 - 11111111', source };
  const registry = profiles => ({ schema: 'halospawns.h1EngineRegistry.v1', profiles });
  const profiles = validateRegistry(registry([original, next]));
  assert.equal(selectProfile(next, profiles).source.git_commit, source.git_commit);
  assertRetainedProfiles(profiles, [original]);
  assert.throws(() => selectProfile({ ...next, build: next.build.replace('11111111', '11111112') }, profiles));
  assert.throws(() => assertRetainedProfiles([original, { ...next, source: { ...source, git_commit: '3'.repeat(40) } }], profiles));
  for (const invalid of [undefined, { ...source, git_commit: 'short' }, { ...source, sha256: 'wrong' }]) {
    assert.throws(() => validateRegistry(registry([{ ...next, source: invalid }])));
  }
});
