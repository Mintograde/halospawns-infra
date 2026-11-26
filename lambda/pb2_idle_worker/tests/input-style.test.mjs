import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {measureInputStyle} from '../input-style.mjs';
import {seatSamples} from '../profiles.mjs';

function recording(hz, seconds=120, seats=2) {
  const count = hz * seconds, stride = 14, samples = Buffer.alloc(count * stride * seats);
  for (let i=0; i<count; i++) {
    for (let seat=0; seat<seats; seat++) {
      const at = (i * seats + seat) * stride;
      const pad = seat === 0;
      samples[at+12] = pad ? 1 : 2;
      samples[at+13] = pad ? 0 : 2;
      samples.writeInt16LE(32767, at+4);
      samples.writeInt16LE(-32767, at+6);
      samples.writeInt16LE(pad ? 32767 : 2, at+8);
      samples[at+3] = pad ? 255 : 0;
      if (i % hz === hz/2) samples.writeUInt16LE(pad ? 0x1000 : 128, at);
    }
  }
  return {seats, stride, samples, count, flags:4};
}

test('uses the physical seat and recorded clock for distinct controller and keyboard metrics',()=>{
  for (const hz of [30,120]) {
    const pad = recording(hz);
    const [left,right] = [0,1].map(s => measureInputStyle(pad,s,hz,seatSamples(pad,s)));
    assert.equal(left.method,'controller');
    assert.equal(left.metrics.rt_full,100);
    assert.equal(left.metrics.a_rate,60);
    assert.equal(right.method,'mouse_keyboard');
    assert.equal(right.metrics.fire_rate,60);
    assert.equal(right.metrics.mouse_speed,2*hz);
    assert.equal(right.metrics.diagonal,100);
    assert.equal(right.samples,120*hz);
    assert.notEqual(left.input_sha256,right.input_sha256);
    const single = recording(hz,120,1);
    assert.equal(left.input_sha256,createHash('sha256').update(single.samples).digest('hex'));
  }
});

test('mixed, short, idle, copied and marker-only keyboard streams abstain',()=>{
  const read = (p,s=0) => measureInputStyle(p,s,30,seatSamples(p,s));
  assert.equal(read(recording(30,119)),null);
  const p = recording(30);
  assert.equal(read({...p,flags:20}),null);
  for(let i=0;i<p.count;i++) p.samples[(i*2+1)*14+13]=0;
  assert.equal(read(p,1),null);
  for(let i=0;i<p.count/2;i++) p.samples[i*28+12]=2;
  assert.equal(read(p),null);
  for(let i=0;i<p.count;i++) {p.samples.fill(0,i*28,i*28+12); p.samples[i*28+12]=1;}
  assert.equal(read(p),null);
});
