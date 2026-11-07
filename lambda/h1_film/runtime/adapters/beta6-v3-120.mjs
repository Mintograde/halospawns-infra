import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { verifyPlayback as verifyBasePlayback } from './film-v2-120.mjs';
import {observeDamageOwner} from '../roster-recovery.mjs';
import {unpackNetworkColumns,inspectTickBlocks} from '../format3-codec.mjs';

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

const CLIENT_FIXED_SIZES = new Map([[64,4],[65,132],[66,4],[67,68],[68,44],[69,64],[70,112],[71,16],[73,64],[80,0],[81,0],[82,0]]);
const CLIENT_BATCH_STRIDES = new Map([[74,8],[75,11],[76,5],[77,3],[78,5]]);

async function inspectNetwork(file, offset, size, firstTick, ticks, players, localPlayers, recoveryContext, clientView = false) {
  assert.ok(size >= 32 && size <= 96 * 1024 * 1024 + 32, 'Invalid FNET size');
  const header = await readBlock(file, offset, 32);
  const words = Array.from({ length: 8 }, (_, index) => header.readUInt32LE(index * 4));
  assert.ok(words[0] === 0x54454e46 && words[1] === 2 && words[2] === 32, 'Unsupported FNET layout');
  assert.equal(words[5], 0, 'Capped or unknown FNET flags');
  assert.equal(words[7], size - 32, 'Invalid FNET packed size');
  assert.ok(words[6] <= Math.floor(words[7] / 24), 'Invalid FNET block count');
  let cursor = 32, count = 0, rawBytes = 0, previous = -1, applications = 0;
  const joined = new Set();
  const owners = new Map();
  const clocks = [];
  let rosterChanged = false;
  let maxPlayerSlot = players - 1;
  let initialDropMask, observedRemoteMask = 0, initialRosterChanged = false, initialMaskChanged = false;
  const sizes = new Map([[1, 68], [2, 108], [3, 4], [4, 8], [5, 0], [6, 8], [7, 36], [8, 124], [9, 0], [10, 32], [11, 56], [12, 20], [14, 8], [15, 0]]);
  for (let block = 0; block < words[6]; block++) {
    assert.ok(cursor + 24 <= size, 'Truncated FNET block');
    const entry = await readBlock(file, offset + cursor, 24);
    const [rawSize, packedSize, first, last, records, flags] = Array.from({ length: 6 }, (_, index) => entry.readUInt32LE(index * 4));
    cursor += 24;
    assert.ok(rawSize > 0 && rawSize <= 16 * 1024 * 1024 && packedSize > 0 && cursor + packedSize <= size
      && records > 0 && records <= Math.floor(rawSize / 8) && flags <= 3, 'Invalid FNET block bounds');
    const packed = await readBlock(file, offset + cursor, packedSize);
    const expanded = flags & 1 ? unpackMszip(packed, rawSize) : packed;
    const raw = flags & 2 ? unpackNetworkColumns(expanded, records) : expanded;
    assert.equal(raw.length, rawSize, 'FNET raw size mismatch');
    let position = 0;
    for (let record = 0; record < records; record++) {
      assert.ok(position + 8 <= raw.length, 'Truncated FNET record');
      const tick = raw.readUInt32LE(position), type = raw.readUInt16LE(position + 4), length = raw.readUInt16LE(position + 6);
      if (clientView && type >= 64) {
        assert.ok(type <= 82, 'Unsupported client FNET record');
        if (CLIENT_FIXED_SIZES.has(type)) assert.equal(length,CLIENT_FIXED_SIZES.get(type),'Invalid client FNET record size');
        else if(CLIENT_BATCH_STRIDES.has(type)) assert.ok(length>0&&length%CLIENT_BATCH_STRIDES.get(type)===0,'Invalid client FNET batch');
        else if(type===72) assert.ok(length>0&&length<=0xf00,'Invalid client game state');
        else assert.ok(type===79&&length>=4&&length<=0xe00,'Invalid client engine write');
      } else if(type===13) assert.ok(length>=34&&length<=624&&(length-24)%10===0,'Invalid position table');
      else assert.equal(length, sizes.get(type), 'Unsupported FNET record ' + type);
      assert.ok(position + 8 + length <= raw.length && tick >= previous && tick <= firstTick + ticks,
        'Invalid FNET record bounds or time');
      if (record === 0) assert.equal(tick, first, 'FNET first tick mismatch');
      if (record === records - 1) assert.equal(tick, last, 'FNET last tick mismatch');
      if(clientView&&type===79) {
        const payload=raw.subarray(position+8,position+8+length);
        let at=4;
        while(at<payload.length) {
          assert.ok(at+5<=payload.length,'Truncated client engine write');
          const region=payload[at],offset=payload.readUInt16LE(at+1),count=payload.readUInt16LE(at+3);
          assert.ok(region<9&&offset+count<=65536&&at+5+count<=payload.length,'Invalid client engine write bounds');
          // Region-specific bounds are additionally checked by the pinned engine.
          at+=5+count;
        }
      }
      if (clientView && type === 64) {
        const gameTick = raw.readInt32LE(position + 8);
        assert.ok(gameTick >= 0 && gameTick <= 0x7fffffff - ticks, 'Invalid client clock');
        const clock={frame:tick,game_tick:gameTick};
        if(clocks.at(-1)?.frame===tick)clocks[clocks.length-1]=clock;
        else clocks.push(clock);
      }
      if (type === 3) {
        const mask = raw.readUInt32LE(position + 8);
        assert.equal(mask >>> 16, 0, 'FNET drop mask exceeds converter limit');
        if (initialDropMask === undefined && tick === 0) initialDropMask = mask;
        if (tick === 0 && mask !== initialDropMask) initialMaskChanged = true;
        observedRemoteMask |= mask;
      }
      if (tick === 0 && (type === 4 || type === 7)) initialRosterChanged = true;
      if (type === 6 || type === 7) rosterChanged = true;
      if (type === 2 && tick < firstTick + ticks) observeDamageOwner(owners, raw.subarray(position+8,position+8+length),tick);
      if (type === 7) {
        const handle = raw.readUInt32LE(position + 8), slot = handle & 65535;
        assert.ok(slot < 16, 'Joined player exceeds converter limit');
        assert.ok(!joined.has(handle), 'Duplicate joined player identity');
        joined.add(handle);
        maxPlayerSlot = Math.max(maxPlayerSlot, slot);
        assert.ok(players + joined.size <= 16, 'Participant roster exceeds converter limit');
        assert.ok(raw.readInt32LE(position + 16) >= 0, 'Invalid join respawn timer');
      }
      // blampc_film_play_end applies the client changes keyed to tick_count
      // after its last frame. Host films do not apply this closing boundary.
      if (type !== 3 && type !== 9 && type !== 13 && type !== 14 && type !== 15 && type !== 81 && type !== 82
        && (tick < firstTick + ticks || clientView && tick === ticks)) applications++;
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
  if (clientView) {
    assert.ok(clocks.length && clocks[0].frame === firstTick, 'Client film lacks initial clock');
    return {records:count,applications,blocks:words[6],clocks};
  }
  const roster_recovery = undefined;
  const hostSlots = Array.from({ length: players }, (_, slot) => slot)
    .filter(slot => !(initialDropMask & (1 << slot)));
  let host;
  if (firstTick === 0 && initialDropMask > 0 && initialDropMask >>> players === 0
    && !initialRosterChanged && !initialMaskChanged) {
    if (hostSlots.length === localPlayers
      && hostSlots.every(slot => !(observedRemoteMask & (1 << slot)))) {
      host = { provenance: 'initial_fnet_drop_mask_v1', source_tick: 0, initial_player_count: players,
        local_player_count: localPlayers, remote_player_mask: initialDropMask, host_slots: hostSlots };
    } else if (hostSlots.length === 0 && localPlayers === 1) {
      // Beta 6.1's recorder clamps opts->players to one even on a dedicated host.
      // The tick-zero mask positively identifies every initial player as remote;
      // zero local players here is derived evidence, not the envelope placeholder.
      host = { provenance: 'initial_fnet_all_remote_v1', source_tick: 0, initial_player_count: players,
        local_player_count: 0, remote_player_mask: initialDropMask, host_slots: [] };
    }
  }
  return { records: count, applications, blocks: words[6], participant_count: players + joined.size,
    max_player_slot: maxPlayerSlot, ...(host ? { host } : {}), ...(roster_recovery ? {roster_recovery} : {}) };
}

export async function readEnvelope(path, {allowClientView = false} = {}) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    assert.ok(size >= 504 && size <= 512 * 1024 * 1024, 'Invalid film size');
    const head = await readBlock(file, 0, 504);
    const words = Array.from({ length: 32 }, (_, index) => head.readUInt32LE(index * 4));
    assert.ok(words[0] === 0x314d4c46 && words[1] === 3 && words[2] === 9839 && words[3] === 120 && words[5] === 32
      && words[6] === 4 && [504,536].includes(words[16]), 'Unsupported beta6 film layout');
    assert.ok(words[11] > 0 && words[11] <= 432000 && words[25] > 0 && words[25] <= 4, 'Invalid tick or seat count');
    assert.ok([13324, 13328].includes(words[4]), 'Unsupported Beta 6.1 options layout');
    const flags = words[7], network = Boolean(flags & 2), universal = Boolean(flags & 8);
    const clientView = Boolean(flags & 64);
    assert.equal(flags & ~(allowClientView ? 123 : 59), 0, 'Unknown film flags');
    assert.ok(!clientView || network && universal, 'Client view requires UNIVERSAL networking');
    assert.equal(network, universal, 'Network film requires UNIVERSAL world changes');
    let players = network ? words[31] & 255 : words[25];
    assert.ok(players > 0 && players <= 16, 'Network roster exceeds sixteen-player converter limit');

    const stream = words[17], trailer = words[12];
    assert.ok(stream >= 504 && stream < trailer && trailer <= size - 8 && [1, 2].includes(words[14]),
      'A closed film with a trailer is required');
    const netOffset = head.readUInt32LE(448), netSize = head.readUInt32LE(452);
    const namesOffset = head.readUInt32LE(456), namesSize = head.readUInt32LE(460);
    const createdUtc = head.readBigUInt64LE(464);
    assert.ok(createdUtc <= 253402300799n, 'Invalid Beta 6.1 UTC timestamp');

    assert.ok((flags & 48) !== 48, 'Conflicting network link flags');
    assert.ok(network || !(flags & 48), 'Local film declares a network link');
    const spans = [[0, words[16]], [stream, trailer]];
    for (const [offset, length, before] of [
      [words[18], words[4], true], [words[19], words[20], true], [words[21], words[22], true],
      [words[23], words[24], true], [words[26], words[27], false], [words[28], words[29], false],
      [netOffset, netSize, false], [namesOffset, namesSize, true],
      [head.readUInt32LE(480), head.readUInt32LE(484), false],
      [head.readUInt32LE(496), head.readUInt32LE(500), false],
    ]) {
      if (!length) { assert.equal(offset, 0, 'Empty section has an offset'); continue; }
      assert.ok(offset >= 504 && offset + length <= (before ? stream : size), 'Section outside permitted range');
      spans.push([offset, offset + length]);
    }
    if (namesSize) {
      assert.equal(namesSize, 464, 'Unsupported recorded roster layout');
      const roster=await readBlock(file,namesOffset,namesSize);
      assert.equal(roster.readUInt32LE(0),0x52545352,'Invalid recorded roster');
      assert.equal(roster.readUInt32LE(4),players,'Recorded roster count differs');
      assert.equal(roster.readUInt32LE(12),0,'Unknown roster fields');
      for(let slot=0;slot<players;slot++) {
        const row=roster.subarray(16+slot*28,44+slot*28);
        // FFA stores player_list_index as team_index (game_engine_player_added),
        // so all sixteen player indices are valid, in addition to NONE.
        assert.ok((row[0]<16||row[0]===255)&&(row[1]<=3||row[1]===255)
          &&row.readUInt16LE(2)===0,'Invalid recorded team');
      }
    }
    await inspectTickBlocks(file,stream,trailer,words[11]);
    const tail = await readBlock(file, trailer, 8), samples = tail.readUInt32LE(4);
    assert.ok(tail.readUInt32LE(0) === 0x314c5254 && samples > 0 && samples <= 40000, 'Invalid hash trailer');
    const end = trailer + 8 + samples * 16;
    assert.ok(end <= size, 'Truncated hash samples');
    spans.push([trailer, end]);
    spans.sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < spans.length; index++) assert.ok(spans[index - 1][1] <= spans[index][0], 'Overlapping sections');
    const configuredBots = words[4] === 13328 ? (await readBlock(file, words[18] + 13324, 4)).readUInt32LE(0) : 0;
    assert.ok(words[4] === 13324 || (configuredBots > 0 && configuredBots <= 11
      && (network || players + configuredBots <= 12)),
      'Invalid Beta 6.1 bot roster');
    // record_begin preserves the local lobby setting even on a network client.
    // blampc_bots_create_players returns before spawning on network playback;
    // the recorded network roster already describes the actual participants.
    const bots = network ? 0 : configuredBots;
    assert.ok(words[20] > 0 && words[20] <= 1024 * 1024, 'Invalid Beta 6.1 settings size');
    const settings = (await readBlock(file, words[19], words[20])).toString('utf8');
    const botSettings = new Map();
    let section = '';
    for (const line of settings.split(/\r?\n/)) {
      const heading = line.trim().match(/^\[([^\]]+)\]$/);
      if (heading) section = heading[1].toLowerCase();
      const field = line.match(/^\s*(bots|bot_skill|bot_teams)\s*=\s*(.*?)\s*$/i);
      if (section !== 'tuning' || !field) continue;
      const key = field[1].toLowerCase();
      assert.ok(!botSettings.has(key), 'Duplicate Beta 6.1 bot setting');
      botSettings.set(key, field[2]);
    }
    assert.equal(botSettings.get('bots') ?? '0', String(configuredBots), 'Beta 6.1 bot count differs from recorded settings');
    if (configuredBots) {
      assert.match(botSettings.get('bot_skill') ?? '', /^[0-3]$/, 'Invalid Beta 6.1 bot skill');
      const teams = (botSettings.get('bot_teams') ?? '').split(',').map(team => team.trim());
      assert.ok(teams.length <= 11 && teams.every(team => /^(auto|0|1)$/i.test(team)), 'Invalid Beta 6.1 bot teams');
      players += bots;
    }
    const text = (start, stop) => head.subarray(start, stop).toString('utf8').split('\0')[0];
    const map = text(128, 256);
    assert.match(map, /^[a-zA-Z0-9_-]+$/, 'Invalid map name');
    assert.equal(Boolean(netSize), universal, 'FNET section and film flags disagree');
    // Beta 6.1 inserted flag/ball reset settings: teamplay is 19 and fireteams 25.
    const variant = words[22] === 436 ? await readBlock(file,words[21],436) : undefined;
    const net = universal ? await inspectNetwork(file, netOffset, netSize, words[10], words[11], players, words[25], {
      teams:words[30],namesSize,ffa:Boolean(variant && variant.readInt32LE(128+19*4) === 0
        && variant.readInt32LE(128+25*4) === 0 && head.readUInt32LE(472) === 0),
    }, clientView) : undefined;
    if (net?.roster_recovery) players = net.roster_recovery.initial_player_count;
    return { format: 3, protocol_revision: words[2], tick_rate: 120, ticks: words[11], players, map,
      map_bytes: words[15], hash_samples: samples, hash_period: words[13], first_update: words[10],
      end_reason: words[14], gametype: text(256, 384), build: text(384, 448),
      ...(createdUtc ? { created_utc: Number(createdUtc) } : {}),
      ...(allowClientView ? {recording_kind:clientView?'client-view':'host',
        match_id:head.readBigUInt64LE(488).toString(16).padStart(16,'0'),
        recorded_own_player:(head.readUInt32LE(476) >>> 16) & 255,
        recorded_local_player_mask:head.readUInt32LE(476) & 65535} : {}),
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
