import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { verifyPlayback as verifyBasePlayback } from './film-v2-120.mjs';

export function unpackMszip(packed, expected) {
  assert.ok(packed.length >= 24 && packed.readUInt32LE(0) === 0xc0e5510a
    && packed.readUInt16LE(4) === 24 && packed[7] === 2, 'Invalid MSZIP header');
  assert.equal(packed.readBigUInt64LE(8), BigInt(expected), 'MSZIP size mismatch');
  assert.equal(packed.readBigUInt64LE(16), BigInt(Math.min(expected, 32768)), 'Invalid MSZIP chunk size');
  let checksum = 0xffffffff;
  for (let position = 0; position < 24; position++) {
    if (position === 6) continue;
    checksum ^= packed[position];
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  assert.equal(packed[6], (checksum ^ 0xffffffff) & 255, 'Invalid MSZIP checksum');
  const output = Buffer.alloc(expected);
  let offset = 24, produced = 0;
  while (produced < expected) {
    assert.ok(offset + 6 <= packed.length, 'Truncated MSZIP chunk');
    const length = packed.readUInt32LE(offset);
    offset += 4;
    assert.ok(length >= 2 && offset + length <= packed.length
      && packed.subarray(offset, offset + 2).toString('ascii') === 'CK', 'Invalid MSZIP chunk');
    const wanted = Math.min(32768, expected - produced);
    const decoded = inflateRawSync(packed.subarray(offset + 2, offset + length), {
      dictionary: output.subarray(Math.max(0, produced - 32768), produced), maxOutputLength: wanted, info: true,
    });
    assert.equal(decoded.buffer.length, wanted, 'Truncated MSZIP output');
    assert.equal(decoded.engine.bytesWritten, length - 2, 'Trailing MSZIP chunk data');
    decoded.buffer.copy(output, produced);
    produced += wanted;
    offset += length;
  }
  assert.equal(offset, packed.length, 'Trailing MSZIP data');
  return output;
}

async function readBlock(file, offset, length) {
  const result = Buffer.alloc(length);
  assert.equal((await file.read(result, 0, length, offset)).bytesRead, length, 'Truncated film section');
  return result;
}

async function inspectNetwork(file, offset, size, firstTick, ticks, players) {
  assert.ok(size >= 32 && size <= 96 * 1024 * 1024 + 32, 'Invalid FNET size');
  const header = await readBlock(file, offset, 32);
  const words = Array.from({ length: 8 }, (_, index) => header.readUInt32LE(index * 4));
  assert.ok(words[0] === 0x54454e46 && words[1] === 2 && words[2] === 32, 'Unsupported FNET layout');
  assert.equal(words[5], 0, 'Capped or unknown FNET flags');
  assert.equal(words[7], size - 32, 'Invalid FNET packed size');
  assert.ok(words[6] <= Math.floor(words[7] / 24), 'Invalid FNET block count');
  let cursor = 32, count = 0, rawBytes = 0, previous = -1, applications = 0;
  const joined = new Set();
  let maxPlayerSlot = players - 1;
  const sizes = new Map([[1, 68], [2, 108], [3, 4], [4, 8], [5, 0], [6, 8], [7, 36]]);
  for (let block = 0; block < words[6]; block++) {
    assert.ok(cursor + 24 <= size, 'Truncated FNET block');
    const entry = await readBlock(file, offset + cursor, 24);
    const [rawSize, packedSize, first, last, records, flags] = Array.from({ length: 6 }, (_, index) => entry.readUInt32LE(index * 4));
    cursor += 24;
    assert.ok(rawSize > 0 && rawSize <= 16 * 1024 * 1024 && packedSize > 0 && cursor + packedSize <= size
      && records > 0 && records <= Math.floor(rawSize / 8) && flags <= 1, 'Invalid FNET block bounds');
    const packed = await readBlock(file, offset + cursor, packedSize);
    const raw = flags ? unpackMszip(packed, rawSize) : packed;
    assert.equal(raw.length, rawSize, 'FNET raw size mismatch');
    let position = 0;
    for (let record = 0; record < records; record++) {
      assert.ok(position + 8 <= raw.length, 'Truncated FNET record');
      const tick = raw.readUInt32LE(position), type = raw.readUInt16LE(position + 4), length = raw.readUInt16LE(position + 6);
      assert.equal(length, sizes.get(type), 'Unsupported FNET record');
      assert.ok(position + 8 + length <= raw.length && tick >= previous && tick <= firstTick + ticks,
        'Invalid FNET record bounds or time');
      if (record === 0) assert.equal(tick, first, 'FNET first tick mismatch');
      if (record === records - 1) assert.equal(tick, last, 'FNET last tick mismatch');
      if (type === 3) assert.equal(raw.readUInt32LE(position + 8) >>> 16, 0, 'FNET drop mask exceeds converter limit');
      if (type === 7) {
        const handle = raw.readUInt32LE(position + 8), slot = handle & 65535;
        assert.ok(slot < 16, 'Joined player exceeds converter limit');
        assert.ok(!joined.has(handle), 'Duplicate joined player identity');
        joined.add(handle);
        maxPlayerSlot = Math.max(maxPlayerSlot, slot);
        assert.ok(players + joined.size <= 16, 'Participant roster exceeds converter limit');
        assert.ok(raw.readInt32LE(position + 16) >= 0, 'Invalid join respawn timer');
      }
      if (type !== 3 && tick < firstTick + ticks) applications++;
      position += 8 + length;
      previous = tick;
    }
    assert.equal(position, rawSize, 'Trailing FNET record bytes');
    count += records;
    rawBytes += rawSize;
    assert.ok(rawBytes <= 512 * 1024 * 1024, 'FNET expansion limit exceeded');
    cursor += packedSize;
  }
  assert.equal(cursor, size, 'Trailing FNET blocks');
  assert.equal(count, words[3], 'FNET record count mismatch');
  assert.equal(rawBytes, words[4], 'FNET byte count mismatch');
  return { records: count, applications, blocks: words[6], participant_count: players + joined.size, max_player_slot: maxPlayerSlot };
}

export async function readEnvelope(path) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    assert.ok(size >= 480 && size <= 512 * 1024 * 1024, 'Invalid film size');
    const head = await readBlock(file, 0, 480);
    const words = Array.from({ length: 32 }, (_, index) => head.readUInt32LE(index * 4));
    assert.ok(words[0] === 0x314d4c46 && words[1] === 2 && words[2] === 9803 && words[3] === 120 && words[5] === 32
      && words[6] === 4 && words[16] === 480, 'Unsupported beta4 film layout');
    assert.ok(words[11] > 0 && words[11] <= 432000 && words[25] > 0 && words[25] <= 4, 'Invalid tick or seat count');
    assert.ok([12376, 12380].includes(words[4]), 'Unsupported Beta 4 options layout');
    const flags = words[7], network = Boolean(flags & 2), universal = Boolean(flags & 8);
    assert.equal(flags & ~11, 0, 'Unknown film flags');
    assert.equal(network, universal, 'Network film requires UNIVERSAL world changes');
    let players = network ? words[31] & 255 : words[25];
    assert.ok(players > 0 && players <= 16, 'Network roster exceeds sixteen-player converter limit');
    assert.ok(players <= 8, 'Beta 4 initial roster lacks recorded names and teams beyond eight players');
    const stream = words[17], trailer = words[12];
    assert.ok(stream >= 480 && stream < trailer && trailer <= size - 8 && [1, 2].includes(words[14]),
      'A closed film with a trailer is required');
    const netOffset = head.readUInt32LE(448), netSize = head.readUInt32LE(452);
    const namesOffset = head.readUInt32LE(456), namesSize = head.readUInt32LE(460);
    assert.ok(head.subarray(472).every(byte => byte === 0), 'Unknown beta4 header extension');
    const spans = [[0, 480], [stream, trailer]];
    for (const [offset, length, before] of [
      [words[18], words[4], true], [words[19], words[20], true], [words[21], words[22], true],
      [words[23], words[24], true], [words[26], words[27], false], [words[28], words[29], false],
      [netOffset, netSize, false], [namesOffset, namesSize, true],
    ]) {
      if (!length) { assert.equal(offset, 0, 'Empty section has an offset'); continue; }
      assert.ok(offset >= 480 && offset + length <= (before ? stream : size), 'Section outside permitted range');
      spans.push([offset, offset + length]);
    }
    if (namesSize) {
      assert.equal(namesSize, 196, 'Unsupported recorded names layout');
      assert.equal((await readBlock(file, namesOffset, 4)).readUInt32LE(0), 0x454d414e, 'Invalid recorded names');
    }
    const tail = await readBlock(file, trailer, 8), samples = tail.readUInt32LE(4);
    assert.ok(tail.readUInt32LE(0) === 0x314c5254 && samples > 0 && samples <= 40000, 'Invalid hash trailer');
    const end = trailer + 8 + samples * 16;
    assert.ok(end <= size, 'Truncated hash samples');
    spans.push([trailer, end]);
    spans.sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < spans.length; index++) assert.ok(spans[index - 1][1] <= spans[index][0], 'Overlapping sections');
    const bots = words[4] === 12380 ? (await readBlock(file, words[18] + 12376, 4)).readUInt32LE(0) : 0;
    assert.ok(words[4] === 12376 || (!network && bots > 0 && bots <= 11 && players + bots <= 12),
      'Invalid Beta 4 bot roster');
    assert.ok(words[20] > 0 && words[20] <= 1024 * 1024, 'Invalid Beta 4 settings size');
    const settings = (await readBlock(file, words[19], words[20])).toString('utf8');
    const botSettings = new Map();
    let section = '';
    for (const line of settings.split(/\r?\n/)) {
      const heading = line.trim().match(/^\[([^\]]+)\]$/);
      if (heading) section = heading[1].toLowerCase();
      const field = line.match(/^\s*(bots|bot_skill|bot_teams)\s*=\s*(.*?)\s*$/i);
      if (section !== 'tuning' || !field) continue;
      const key = field[1].toLowerCase();
      assert.ok(!botSettings.has(key), 'Duplicate Beta 4 bot setting');
      botSettings.set(key, field[2]);
    }
    assert.equal(botSettings.get('bots') ?? '0', String(bots), 'Beta 4 bot count differs from recorded settings');
    if (bots) {
      assert.match(botSettings.get('bot_skill') ?? '', /^[0-3]$/, 'Invalid Beta 4 bot skill');
      const teams = (botSettings.get('bot_teams') ?? '').split(',').map(team => team.trim());
      assert.ok(teams.length <= 11 && teams.every(team => /^(auto|0|1)$/i.test(team)), 'Invalid Beta 4 bot teams');
      players += bots;
    }
    const text = (start, stop) => head.subarray(start, stop).toString('utf8').split('\0')[0];
    const map = text(128, 256);
    assert.match(map, /^[a-zA-Z0-9_-]+$/, 'Invalid map name');
    assert.equal(Boolean(netSize), universal, 'FNET section and film flags disagree');
    const net = universal ? await inspectNetwork(file, netOffset, netSize, words[10], words[11], players) : undefined;
    return { format: 2, protocol_revision: words[2], tick_rate: 120, ticks: words[11], players, map,
      map_bytes: words[15], hash_samples: samples, hash_period: words[13], first_update: words[10],
      end_reason: words[14], gametype: text(256, 384), build: text(384, 448),
      ...(bots ? { bots } : {}), ...(net ? { network: net } : {}) };
  } finally { await file.close(); }
}

export function verifyPlayback(log, envelope) {
  const result = verifyBasePlayback(log, envelope);
  if (envelope.network?.records) {
    const applied = [...log.matchAll(/network changes put back: (\d+), (\d+) refused/g)].at(-1);
    assert.ok(applied, 'Missing network replay verification');
    assert.equal(Number(applied[2]), 0, 'Network replay refused recorded changes');
    assert.equal(Number(applied[1]), envelope.network.applications, 'Incomplete network replay');
  }
  return result;
}
