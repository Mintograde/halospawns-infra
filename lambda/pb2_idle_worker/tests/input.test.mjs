import assert from 'node:assert/strict';
import test from 'node:test';
import {inputState,quietWindows} from '../input.mjs';
import {screenActions} from '../screen.mjs';

// A second life starts two seconds after death. Both lives use the same
// physical seat, and a key pressed while dead still resets the clock.
for (const rate of [30,120]) {
  test(`counts only living ticks across respawns at ${rate} Hz`, () => {
    const frames = 64*rate, deadAt = 30*rate, respawn = 32*rate;
    const samples = Buffer.alloc(frames*14);
    for (let i=0;i<frames;i++) { samples[i*14+12]=2; samples[i*14+13]=2; }
    const track = {id:'host',first_update:0,frame_count:frames};
    const candidate = {slot:0,windows:[[0,frames]],forward:new Float32Array(frames),left:new Float32Array(frames)};
    const pad = {samples,seats:1,events:Buffer.alloc(0),count:frames,first_update:0};
    const lives = f => Math.min(f,deadAt)+Math.max(0,f-respawn);
    const measure = () => quietWindows({start:0,end:frames,rate},candidate,{tracks:[track]},track,pad,0,lives);
    assert.equal(measure().best.alive_ticks,62*rate);
    samples[31*rate*14]=1;
    assert.equal(measure().best.alive_ticks,32*rate);
    samples[31*rate*14]=0; samples[31*rate*14+12]=0;
    assert.equal(measure().complete,false);
    assert.equal(measure().best.alive_ticks,32*rate);
  });
  test(`a repeated host vector counts from tick zero and requires strictly over 60 seconds at ${rate} Hz`, async () => {
    const frames=60*rate+1, head=Buffer.alloc(536), chunks=[];
    for (let f=0;f<frames;f++) {
      const n=f===0?1:0, size=19+n*30, b=Buffer.alloc(4+size);
      b[0]=1; b.writeUInt16LE(size,1); b[3]=2; b[4]=1; b.writeUInt32LE(f,5); b[21]=n; b[b.length-1]=3;
      chunks.push(b);
    }
    const body=Buffer.concat(chunks);
    for(const [at,v] of [[0,0x314d4c46],[4,2],[12,rate],[44,frames],[48,536+body.length],[64,448],[68,536],[100,1]])
      head.writeUInt32LE(v,at);
    const read=async at=>at===0?head:body;
    const run=end=>screenActions({rate,start:0,end},read);
    assert.deepEqual((await run(frames-1)).candidates,[]);
    assert.deepEqual((await run(frames)).candidates[0].windows,[[0,frames]]);
  });
}
test('recognizes mouse motion, analog dead zones, missing sources and a quiet open menu', () => {
  const sample={source:1,flags:0,buttons:0,left_trigger:0,right_trigger:0,left_x:0,left_y:0,right_x:0,right_y:0};
  const settings={left:[0,3500,0],right:[3,1600,1600]};
  assert.equal(inputState({...sample,flags:1},settings,false),true);
  assert.equal(inputState({...sample,source:2,flags:2,right_x:1},settings,false),false);
  assert.equal(inputState({...sample,right_x:6000},settings,false),false);
  assert.equal(inputState({...sample,source:2},settings,false),null);
  assert.equal(inputState({...sample,source:0},settings,false),null);
});
