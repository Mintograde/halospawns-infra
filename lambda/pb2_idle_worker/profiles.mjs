import assert from 'node:assert/strict';
import {readRawPad} from '../h1_film/runtime/format3-pad.mjs';

const word = (bytes, offset) => bytes.readUInt32LE(offset);
const number = (value, max = 10000) => {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed <= max ? parsed : null;
};

// Keep only reviewed settings. Film configuration also contains private values.
export function readSettings(bytes) {
  const allowed = {
    lobby: /^seat[1-4]_profile$/,
    video: /^firing_input_polling$/,
    profile: /^(stick_behavior|aim_style|sensitivity|mcc_horizontal_sensitivity|mcc_vertical_sensitivity|mouse_sensitivity|input_delay_ms|invert|mouse_invert|look_dz|move_dz)$/
  };
  const sections = new Map();
  let section, keys;
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      section = header[1].trim().toLowerCase();
      keys = /^profile[0-7]$/.test(section) ? allowed.profile : allowed[section];
    } else if (keys instanceof RegExp) {
      const pair = /^\s*(\w+)\s*=\s*([^;#\0]*)/.exec(line);
      if (!pair || !keys.test(pair[1].toLowerCase())) continue;
      if (!sections.has(section)) sections.set(section, new Map());
      sections.get(section).set(pair[1].toLowerCase(), pair[2].trim().toLowerCase());
    }
  }
  return sections;
}

function configuration(settings, seat) {
  const assigned = settings.get('lobby')?.get('seat' + (seat + 1) + '_profile');
  const config = /^[0-7]$/.test(assigned ?? '') ? settings.get('profile' + assigned) : null;
  const style = config?.get('stick_behavior') ?? config?.get('aim_style');
  const bool = value => ['1','true','on','yes'].includes(value) ? true
    : ['0','false','off','no'].includes(value) ? false : null;
  const poll = number(settings.get('video')?.get('firing_input_polling'));
  const delay = config?.get('input_delay_ms');
  const fields = {
    stick_mode: ['mcc_modern','mcc modern','mcc'].includes(style) ? 'mcc_modern' : style === 'pb' ? 'pb' : null,
    pb_sensitivity: number(config?.get('sensitivity')),
    mcc_horizontal: number(config?.get('mcc_horizontal_sensitivity')),
    mcc_vertical: number(config?.get('mcc_vertical_sensitivity')),
    mouse_sensitivity: number(config?.get('mouse_sensitivity')),
    firing_poll_hz: [30,120].includes(poll) ? poll : null,
    input_delay_ms: delay === 'auto' ? 'auto' : number(delay),
    invert: bool(config?.get('invert')), mouse_invert: bool(config?.get('mouse_invert')),
    look_deadzone: number(config?.get('look_dz'),32768), move_deadzone: number(config?.get('move_dz'),32768)
  };
  return Object.fromEntries(Object.entries(fields).filter(([,v]) => v != null));
}

export function seatSamples(pad, seat) {
  let controller = 0, mouse = 0;
  for (let i = (seat * pad.stride) + 12; i < pad.samples.length; i += pad.seats * pad.stride) {
    if (pad.samples[i+1] & 1) continue; // Menu holds gameplay input.
    if (pad.samples[i] === 1) controller++;
    if (pad.samples[i] === 2) mouse++; // Older keyboard records still identify the path.
  }
  return {controller, mouse};
}

export async function inputProfiles(job, read) {
  const rows = [];
  const roster = new Map(job.roster.map(p => [p.slot, p.name]));
  async function recording(base, size, boundSlot, role) {
    assert.ok(size >= 448 && base >= 0 && base + size <= job.film.size_bytes);
    const h = await read(base,Math.min(size,536));
    assert.equal(word(h,0),0x314d4c46);
    const header = word(h,64), network = Boolean(word(h,28) & 2), client = Boolean(word(h,28) & 64);
    if (![2,3].includes(word(h,4)) || ![448,464,480,504,536].includes(header)
      || header > size || (role === 'client') !== client) return;
    const section = async (at, max) => {
      const offset = word(h,at), length = word(h,at+4);
      if (!length) return null;
      assert.ok(offset >= header && length <= max && offset + length <= size, 'Invalid input section');
      return read(base+offset,length);
    };
    const rawPad = await section(104,128*1024*1024);
    if (!rawPad) return;
    const pad = readRawPad(rawPad);
    if (!pad.count || pad.flags & 2) return;
    const copy = Boolean(pad.flags & 16);
    let mask = pad.locals;
    if (network && !(pad.flags & 4)) {
      // Original Beta 4/5 PAD1 has no local mask. Its envelope records the
      // recorder's first slot and (Beta 5) local mask. Mirrors omit this pad.
      if (word(h,4) !== 2 || ![9803,9818].includes(word(h,8)) || copy) return;
      const packed = word(h,124), own = (packed >>> 8) & 255, players = packed & 255;
      if (players > 8 || own >= players || (client && own !== boundSlot) || pad.seats !== word(h,100)) return;
      mask = (packed >>> 16) & 255;
      // The original recorder assigned unmasked local seats consecutively from own.
      if (!mask) mask = ((1 << pad.seats) - 1) << own;
      if ((mask & -mask) !== (1 << own) || (mask >>> players)) return;
    }
    const slots = network ? Array.from({length:16},(_,i)=>i).filter(i => mask & (1<<i))
      : Array.from({length:pad.seats},(_,i)=>i);
    if (slots.length !== pad.seats
      || client && (copy || !slots.includes(boundSlot))) return;
    const rawRoster = header >= 464 ? await section(456,464) : null;
    const names = rawRoster && rawRoster.length === 196 && word(rawRoster,0) === 0x454d414e;
    if (rawRoster && !names) assert.ok(rawRoster.length >= 16 && word(rawRoster,0) === 0x52545352
      && word(rawRoster,4) <= 16 && 16 + 28*word(rawRoster,4) <= rawRoster.length);
    const settings = copy ? new Map() : readSettings(await section(76,1024*1024) ?? Buffer.alloc(0));
    const build = h.toString('utf8',384,448).split('\0')[0];
    for (const [seat,slot] of slots.entries()) {
      if (!roster.has(slot) || (client && slot !== boundSlot)) continue;
      if (rawRoster) {
        if (slot >= (names ? 8 : word(rawRoster,4))) continue;
        const at = names ? 4+24*slot : 20+28*slot;
        const name = rawRoster.toString('utf16le',at,at+24).split('\0')[0].trim();
        if (name && roster.get(slot).trim().toLowerCase() !== name.toLowerCase()) continue;
        if (!name && names && network && !job.stable) continue;
      } else if (network && !job.stable) continue;
      const counts = seatSamples(pad,seat);
      if (!counts.controller && !counts.mouse) continue;
      const settingsRow = configuration(settings,seat);
      settingsRow.pipeline_ticks = pad.pipeline_ticks;
      if (!copy && /^[\w .:+()/\-]{1,63}$/.test(build)) settingsRow.build = build;
      rows.push({slot, name:roster.get(slot), ...counts, profile:settingsRow,
        recording:copy ? 'copied_host' : role});
    }
  }
  // Source offsets are relative to each physical part, including thin clients.
  const size = job.film.size_bytes;
  const header = await read(0,Math.min(size,536));
  if (job.client_slot != null || word(header,64) !== 536) {
    await recording(0,size,job.client_slot,job.client_slot != null ? 'client' : 'host');
  } else {
    assert.equal(word(header,504),0x4843544d);
    const count = word(header,524), stride = word(header,528), at = word(header,520);
    assert.ok([1,2].includes(word(header,508)) && stride === (word(header,508) === 1 ? 96 : 112)
      && count <= 16 && at + count*stride === size && word(header,512) === 536);
    await recording(word(header,512),word(header,516),null,'host');
    const parts = count && await read(at,count*stride);
    for (let i=0;i<count;i++) {
      const offset = i*stride, slot=word(parts,offset), start=word(parts,offset+4), length=word(parts,offset+8);
      assert.ok(slot < 16 && start >= 536 + word(header,516) && start+length <= at);
      await recording(start,length,slot,'client');
    }
  }
  return rows;
}
