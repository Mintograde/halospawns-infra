import assert from 'node:assert/strict';
import {mapViewFrame} from '../h1_film/runtime/view-tracks.mjs';
import {decodePadSample} from '../h1_film/runtime/format3-pad.mjs';

function inside(x,y,mode,inner,radial) {
  if (mode === 0) return Math.max(Math.abs(x),Math.abs(y)) <= inner;
  if (mode === 1) return Math.hypot(x,y) <= inner;
  if (mode === 2) { inner = 4095; radial = 4095; }
  if (mode !== 2 && mode !== 3) return null;
  const axis = v => Math.trunc(v > inner ? (v-inner)*32767/(32767-inner)
    : v < -inner ? (v+inner)*32768/(32768-inner) : 0);
  return Math.hypot(axis(x),axis(y)) <= radial;
}

// The live client records both sticks before dead zones. Only allow residual
// movement beyond a configured zero zone when the two applied throttle axes
// corroborate the physical stick mapping in this interval.
export function inputState(sample, settings, movementStick) {
  const {source,flags,buttons,left_trigger,right_trigger,left_x,left_y,right_x,right_y} = sample;
  if (source !== 1 && !(source === 2 && flags & 2)) return null;
  if (buttons || left_trigger || right_trigger) return false;
  if (source === 2) return !left_x && !left_y && !right_x && !right_y;
  if (!settings) return null;
  const l = inside(left_x,left_y,...settings.left), r = inside(right_x,right_y,...settings.right);
  if (l === null || r === null) return null;
  return r && (l || movementStick && Math.hypot(left_x,left_y) < 3276.7);
}

export function quietWindows(job, candidate, manifest, track, pad, seat, lives, silence) {
  const events = [];
  for (let at = 0; at < pad.events.length; at += 16) {
    const b = pad.events;
    if (b[at+4] !== seat) continue;
    events.push({frame:b.readUInt32LE(at),left:[b[at+6],b.readUInt16LE(at+8),b.readUInt16LE(at+12)],
      right:[b[at+7],b.readUInt16LE(at+10),b.readUInt16LE(at+14)]});
  }
  assert.ok(events.every((v,i) => !i || v.frame >= events[i-1].frame));
  const map = (from,to,f) => from === to ? f : mapViewFrame(manifest,from,to,f);
  const id = track.id, shift = track.first_update - pad.first_update;
  const clockBreaks = new Set((track.clocks ?? []).slice(1).map(c => c.frame));
  let complete = true, best = null;
  for (const [start,end] of candidate.windows) {
    let a = map('host',id,start), b = map('host',id,end-1);
    // Restrict verification to the sampled portion if a client joined late or
    // ended early. Evidence before/after this range stays unknown.
    if (a === null || b === null) {
      complete = false;
      let first = start, last = end-1;
      while (first <= last && (a = map('host',id,first)) === null) first++;
      while (last >= first && (b = map('host',id,last)) === null) last--;
      if (a === null || b === null) continue;
    }
    const lo = Math.max(a, -shift), hi = Math.min(b,pad.count-1-shift);
    if (lo !== a || hi !== b) complete = false;
    const data = [];
    let settingsIndex = -1, agrees = 0, samples = 0;
    for (let i = lo; i <= hi; i++) {
      const f = map(id,'host',i), k = i+shift;
      while (settingsIndex+1 < events.length && events[settingsIndex+1].frame <= k) settingsIndex++;
      const sample = decodePadSample(pad,k,seat), settings = events[settingsIndex];
      const forward = candidate.forward[f-job.start], left = candidate.left[f-job.start];
      const throttle = Math.hypot(forward,left);
      if (sample.source === 1 && settings?.left[1] === 0 && throttle > 0.015 && throttle < 0.1) {
        samples++;
        if (Math.abs(forward-sample.left_y/32767)<0.01 && Math.abs(left+sample.left_x/32767)<0.01) agrees++;
      }
      data.push({f,sample,settings,throttle,clockBreak:clockBreaks.has(i)});
    }
    let since = null, last = null, previousMenu = null, previousFrame = null, earliest = start;
    function finish(stop = end) {
      if (since !== null && last >= since) {
        const from = Math.max(start,since), to = Math.min(end,last+1,stop);
        const alive = to > from ? lives(to)-lives(from) : 0;
        if (alive > 0 && (!best || best.alive_ticks < alive))
          best = {slot:candidate.slot,start:from,end:to,alive_ticks:alive};
      }
      since = last = null;
    }
    for (const {f,sample,settings,throttle,clockBreak} of data) {
      // Alignment samples adjust the host offset even when every client tick
      // was recorded. A new client clock segment or a reported network outage
      // does break continuity.
      const gap = f !== null && silence?.subarray(Math.max(0,(previousFrame ?? f)-job.start),
        Math.max(0,f-job.start+1)).includes(1);
      if (f === null || clockBreak || (previousFrame !== null && f < previousFrame) || gap) {
        finish(f ?? end); complete = false; previousFrame = f;
        if (f !== null) earliest = Math.max(earliest,f+1);
        continue;
      }
      previousFrame = f;
      const menu = Boolean(sample.flags & 1);
      const menuChanged = previousMenu !== null && menu !== previousMenu;
      previousMenu = menu;
      const movement = settings?.left[1] === 0 && samples >= 3 && agrees >= 0.9*samples && throttle < 0.1;
      const state = !menuChanged && inputState(sample,settings,movement);
      if (state === true) { since ??= Math.max(f,earliest); last = f; }
      else {
        finish(f); earliest = Math.max(earliest,f+1);
        if (state === null) complete = false;
      }
    }
    finish();
  }
  return {complete,best};
}
