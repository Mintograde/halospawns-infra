import {createHash} from 'node:crypto';

// Physical controller buttons and recorded keyboard actions use different bit layouts.
const PAD = {a:0x1000, b:0x2000, x:0x4000, y:0x8000, l3:0x40, r3:0x80, white:0x100, black:0x200};
const KEYS = {jump:1, use:4, switch:8, melee:16, throw:64, fire:128, crouch:1024, zoom:2048};

export function measureInputStyle(pad, seat, hz, counts) {
  if (![30, 120].includes(hz) || pad.flags & (1 | 2 | 16)) return null;
  const total = counts.controller + counts.mouse;
  const controller = counts.controller >= .95 * total;
  const source = controller ? 1 : 2;
  if (Math.max(counts.controller, counts.mouse) < Math.max(120 * hz, .95 * total)) return null;
  const buttons = Object.entries(controller ? PAD : KEYS);
  const presses = buttons.map(() => 0);
  const {samples, stride, seats} = pad;
  const seatBytes = seats === 1 ? samples : Buffer.alloc(pad.count * stride);
  let measured = 0, active = 0, edges = 0, previous = null;
  let leftOuter = 0, leftCardinal = 0, rightOuter = 0, rightCenter = 0;
  let horizontal = 0, axes = 0, rtDown = 0, rtFull = 0, ltDown = 0, ltFull = 0;
  let mouseTravel = 0, diagonal = 0, backward = 0;
  for (let i = 0; i < pad.count; i++) {
    const at = (i * seats + seat) * stride;
    if (seats > 1) samples.copy(seatBytes, i * stride, at, at + stride);
    const flags = samples[at + 13];
    if (samples[at + 12] !== source || flags & 1 || (!controller && !(flags & 2))) {
      previous = null;
      continue;
    }
    measured++;
    const mask = samples.readUInt16LE(at);
    const lx = samples.readInt16LE(at + 4), ly = samples.readInt16LE(at + 6);
    const rx = samples.readInt16LE(at + 8), ry = samples.readInt16LE(at + 10);
    const right = Math.hypot(rx, ry);
    horizontal += Math.abs(rx);
    axes += Math.abs(rx) + Math.abs(ry);
    if (controller) {
      const left = Math.hypot(lx, ly);
      leftOuter += left >= .95 * 32767;
      leftCardinal += left > .2 * 32767 && Math.min(Math.abs(lx), Math.abs(ly)) < .08 * 32767;
      rightOuter += right >= .95 * 32767;
      rightCenter += right <= .05 * 32767;
      ltDown += samples[at + 2] >= 26;
      ltFull += samples[at + 2] >= 250;
      rtDown += samples[at + 3] >= 26;
      rtFull += samples[at + 3] >= 250;
      active += left > 8192 || right > 8192 || mask !== 0 || samples[at + 3] >= 26;
    } else {
      mouseTravel += right;
      diagonal += lx !== 0 && ly !== 0;
      backward += ly < 0;
      active += lx !== 0 || ly !== 0 || right > 0 || mask !== 0;
    }
    if (previous !== null && mask !== previous) {
      const rising = mask & ~previous;
      for (let b = 0; b < buttons.length; b++) {
        if (rising & buttons[b][1]) { presses[b]++; edges++; }
      }
    }
    previous = mask;
  }
  // Short or idle clips and older keyboards with only a device marker supply no style.
  if (measured < 120 * hz || measured < .95 * pad.count || active < 30 * hz
      || edges < 20 || axes === 0) return null;
  const share = n => 100 * n / measured;
  const metrics = controller ? {
    left_outer:share(leftOuter), left_cardinal:share(leftCardinal),
    right_outer:share(rightOuter), right_center:share(rightCenter), right_horizontal:100*horizontal/axes,
    rt_down:share(rtDown), rt_full:share(rtFull), lt_down:share(ltDown), lt_full:share(ltFull)
  } : {
    mouse_speed:mouseTravel * hz / measured, mouse_horizontal:100*horizontal/axes,
    diagonal:share(diagonal), backward:share(backward)
  };
  buttons.forEach(([name], b) => { metrics[name + '_rate'] = 60 * hz * presses[b] / measured; });
  for (const key of Object.keys(metrics)) metrics[key] = Number(metrics[key].toFixed(3));
  return {method:controller ? 'controller' : 'mouse_keyboard', hz, samples:measured, metrics,
    input_sha256:createHash('sha256').update(seatBytes).digest('hex')};
}
