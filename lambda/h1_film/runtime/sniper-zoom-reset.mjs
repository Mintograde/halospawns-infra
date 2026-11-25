import {readEnvelope} from './film.mjs';

// PB2's universal client records its own applied actions by player-table rank.
// A live unit that takes shield/body damage clears both zoom fields. A positive
// zoom request is the only ordinary control that can turn zoom back on.
export async function originalUnzoomedShots(file, track, hits, shots, anchors, inspect = readEnvelope) {
  const e = track.envelope, owner = track.part.player, first = e.first_update;
  const results = new Set();
  if (!shots.length || e.format !== 3 || e.recorded_own_player !== owner
      || !(e.recorded_local_player_mask & (1 << owner)) || owner >= e.players) return results;

  const bodies = new Set(shots.map(s => s.body));
  const resets = new Map();
  const interruptions = new Map();
  const actionStart = new Int32Array(e.ticks).fill(-1);
  let rosterEnd = first + e.ticks, unzoomedSince = -1, layoutOk = true;
  function append(map, body, frame) {
    if (!map.has(body)) map.set(body, []);
    map.get(body).push(frame);
  }
  for (const [frame, body] of anchors) {
    if (bodies.has(body)) append(resets, body, first + frame);
  }
  function observeTickBlock(raw, offset, count) {
    let pos = 0;
    for (let i = 0; i < count && layoutOk; i++) {
      const frame = first + offset + i;
      if (pos + 23 > raw.length) { layoutOk = false; return; }
      const size = raw.readUInt16LE(pos + 1), p = pos + 4, players = raw[p + 17];
      if (size !== 19 + 30 * players || p + size > raw.length || raw[p] !== 1
          || raw.readUInt32LE(p + 1) !== frame || raw[p + size - 1] !== 3) {
        layoutOk = false; return;
      }
      if (players > 0 && players !== e.players) rosterEnd = Math.min(rosterEnd, frame);
      // save_film_record_one_game_tick writes zero players for unchanged
      // actions. Only carry forward a previously observed unzoomed action.
      if (players ? players === e.players && raw.readInt16LE(p + 18 + 30 * owner + 28) === -1
                  : unzoomedSince >= 0) {
        if (unzoomedSince < 0) unzoomedSince = frame;
        actionStart[offset + i] = unzoomedSince;
      } else unzoomedSince = -1;
      pos = p + size;
    }
    if (pos !== raw.length) layoutOk = false;
  }
  const clockFrame = tick => {
    let candidate;
    for (let i = 0; i < e.network.clocks.length; i++) {
      const c = e.network.clocks[i], frame = c.frame + tick - c.game_tick;
      if (frame < c.frame || frame >= (e.network.clocks[i + 1]?.frame ?? first + e.ticks)) continue;
      if (candidate !== undefined) return undefined;
      candidate = frame;
    }
    return candidate;
  };
  const receipts = new Map();
  const receiptKey = (host, tag, attacker, shield, body) => [host,tag,attacker,shield,body].join('/');
  for (const hit of hits ?? []) {
    if (hit.flags !== 0 || hit.victim !== owner || !(hit.body_vitality > 0)
        || !(hit.shield_damage > 0 || hit.body_damage > 0)) continue;
    const frame = clockFrame(hit.client_tick);
    if (frame === undefined) continue;
    const key = receiptKey(hit.host_tick, hit.damage_tag, hit.attacker, hit.shield_damage, hit.body_damage);
    if (!receipts.has(key)) receipts.set(key, new Set());
    receipts.get(key).add(frame);
  }
  const barriers = [];
  function observeRecord(frame, type, data) {
    if (type === 76 || type === 78 && frame > first) rosterEnd = Math.min(rosterEnd, frame);
    // A player or engine state write can change ownership. Plain scoreboard
    // bytes are the game_statistics member [0x090, 0x0cc) of a 512-byte player.
    if (type === 79 && !scoreboardWrite(data)) barriers.push(frame);
    if (type === 65 || type === 66) {
      const body = data.readUInt32LE(type === 65 ? 4 : 0);
      if (bodies.has(body)) append(interruptions, body, frame);
    }
    if (type !== 70 || data[0] !== 1 || data.length !== 112) return;
    const body = data.readUInt32LE(4);
    if (!bodies.has(body)) return;
    const key = receiptKey(data.readInt32LE(108), data.readUInt32LE(8), data[16],
      data.readFloatLE(80), data.readFloatLE(84));
    if (receipts.get(key)?.has(frame)) append(resets, body, frame);
  }
  await inspect(file, {allowClientView:true, allowTextClientSettings:e.text_settings_options_bytes === 13368,
    allowMissingTextSettingsId:e.text_settings_options_bytes === 13368 && e.match_id === '0000000000000000',
    observeTickBlock, observeRecord});
  if (!layoutOk) return results;
  for (const shot of shots) {
    const fire = clockFrame(shot.clock);
    if (fire === undefined || fire >= rosterEnd) continue;
    const start = actionStart[fire - first];
    if (start < 0) continue;
    const reset = (resets.get(shot.body) ?? []).findLast(f => f >= start && f < fire);
    if (reset === undefined || e.network.clocks.some(c => reset < c.frame && c.frame <= fire)
        || barriers.some(f => reset <= f && f <= fire)
        || interruptions.get(shot.body)?.some(f => reset <= f && f <= fire)) continue;
    results.add(shot.deal);
  }
  return results;
}

function scoreboardWrite(data) {
  for (let p = 4; p < data.length;) {
    if (p + 5 > data.length) return false;
    const offset = data.readUInt16LE(p + 1) % 512, size = data.readUInt16LE(p + 3);
    if (data[p] !== 1 || !size || offset < 0x90 || offset + size > 0xcc
        || p + 5 + size > data.length) return false;
    p += 5 + size;
  }
  return true;
}
