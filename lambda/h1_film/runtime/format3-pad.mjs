import assert from 'node:assert/strict';
import {unpackMszip} from './adapters/beta5-v2-120.mjs';

// Recorded controller samples, never reconstructed from simulated actions.
export function readRawPad(section) {
  assert.ok(section.length>=64&&section.length<=128*1024*1024,'Invalid pad section size');
  const h=Array.from({length:16},(_,i)=>section.readUInt32LE(i*4));
  assert.ok([0x31444150,0x32444150,0x33444150].includes(h[0])&&h[1]===1&&h[2]===64,'Unsupported pad header');
  const [,version,header,seats,stride,count,first_update,flags,event_count,event_size,events_offset,entries_offset,pipeline_ticks,locals,raw_size,packed_size]=h;
  assert.ok(seats>=1&&seats<=4&&stride===14&&count<=432000&&first_update<=0x7fffffff-count,'Invalid pad coverage');
  assert.ok(flags<=31&&event_count<=65536&&event_size===16&&events_offset===64
    &&entries_offset===64+event_count*16&&pipeline_ticks<=432000&&locals<=65535,'Invalid pad index');
  const expected=event_count*16+seats*stride*count;
  let bytes=section;
  if(flags&8) {
    assert.ok(h[0]===0x33444150&&raw_size===expected&&packed_size===section.length-64,'Invalid packed pad bounds');
    const raw=unpackMszip(section.subarray(64),raw_size),row=seats*stride;
    bytes=Buffer.alloc(64+expected);section.copy(bytes,0,0,64);raw.copy(bytes,64,0,event_count*16);
    const columns=raw.subarray(event_count*16);
    for(let j=0;j<row;j++) {
      let sum=0;
      for(let i=0;i<count;i++) {sum=(sum+columns[j*count+i])&255;bytes[entries_offset+i*row+j]=sum;}
    }
  } else assert.equal(section.length,64+expected,'Invalid raw pad size');
  for(let i=0;i<event_count;i++) {
    const at=64+i*16;
    assert.ok(bytes.readUInt32LE(at)<=count&&bytes[at+4]<seats,'Invalid pad event');
  }
  return {version,seats,stride,count,first_update,flags,pipeline_ticks,locals,event_count,event_size,
    events:bytes.subarray(64,entries_offset),samples:bytes.subarray(entries_offset)};
}

export function decodePadSample(pad,index,seat) {
  assert.ok(Number.isInteger(index)&&index>=0&&index<pad.count&&Number.isInteger(seat)&&seat>=0&&seat<pad.seats);
  const b=pad.samples.subarray((index*pad.seats+seat)*14);
  return {frame:index,seat,buttons:b.readUInt16LE(0),left_trigger:b[2],right_trigger:b[3],
    left_x:b.readInt16LE(4),left_y:b.readInt16LE(6),right_x:b.readInt16LE(8),right_y:b.readInt16LE(10),
    source:b[12],flags:b[13]};
}
