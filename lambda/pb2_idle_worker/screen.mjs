import assert from 'node:assert/strict';
import {inspectTickBlocks} from '../h1_film/runtime/format3-codec.mjs';

// A player cannot accumulate more living time than the length of a quiet
// interval. Ignore facing and equipment in this first pass: a respawn sets both.
export async function screenActions(job, read) {
  const head = await read(0, 536);
  const word = at => head.readUInt32LE(at);
  const version = word(4), headerSize = word(64), first = word(40), frames = word(44);
  assert.equal(word(0), 0x314d4c46);
  assert.equal(word(12), job.rate);
  assert.ok(job.start >= 0 && job.end <= frames && frames <= 432000);
  if (![2, 3].includes(version) || ![448,464,480,504,536].includes(headerSize)
      || (word(28) & 64)) return {complete:false, candidates:[]};
  const network = headerSize > 448 && (word(28) & 2);
  const slots = network ? word(124) & 255 : word(100);
  const start = word(68), end = word(48);
  if (slots < 1 || slots > 16) return {complete:false,candidates:[]};
  assert.ok(start >= headerSize && end > start);
  const ticks = await read(start, end - start);
  const size = job.end - job.start;
  const players = Array.from({length:slots}, (_,slot) => ({
    slot, since:null, windows:[], forward:new Float32Array(size), left:new Float32Array(size)
  }));
  let present = 0, complete = true;
  const quiet = new Uint8Array(slots), forward = new Float32Array(slots), left = new Float32Array(slots);
  function close(p, frame) {
    if (p.since !== null && frame - p.since > 60 * job.rate) p.windows.push([p.since,frame]);
    p.since = null;
  }
  function inspect(raw, base, count) {
    let at = 0;
    for (let i = 0; i < count; i++) {
      const f = base + i, body = at + 4, length = raw.readUInt16LE(at + 1), n = raw[body + 17];
      assert.ok(raw[at] === 1 && raw[at+3] === 2 && raw[body] === 1 && n <= 16
        && length === 19 + 30*n && raw[body+length-1] === 3 && raw.readUInt32LE(body+1) === first+f);
      if (n) {
        present = n;
        for (let slot = 0; slot < Math.min(n,slots); slot++) {
          const a = body + 18 + 30*slot;
          forward[slot] = raw.readFloatLE(a+12);
          left[slot] = raw.readFloatLE(a+16);
          const trigger = raw.readFloatLE(a+20);
          assert.ok([forward[slot],left[slot],trigger].every(Number.isFinite));
          quiet[slot] = raw.readUInt32LE(a) === 0 && Math.abs(trigger) <= Math.fround(0.1)
            && Math.abs(forward[slot]) <= Math.fround(0.1) && Math.abs(left[slot]) <= Math.fround(0.1);
        }
      }
      if (f >= job.start && f < job.end) {
        if (present !== slots) complete = false;
        for (const p of players) {
          if (present === slots && quiet[p.slot]) {
            p.since ??= f;
            p.forward[f-job.start] = forward[p.slot];
            p.left[f-job.start] = left[p.slot];
          } else close(p,f);
        }
      }
      at = body + length;
    }
    assert.equal(at,raw.length);
  }
  if (version === 2) inspect(ticks,0,frames);
  else await inspectTickBlocks({async read(buffer, offset, n, pos) {
    return {bytesRead:ticks.copy(buffer,offset,pos-start,pos-start+n)};
  }},start,end,frames,inspect);
  for (const p of players) close(p,job.end);
  return {complete, candidates:players.filter(p => p.windows.length), head, frames};
}
