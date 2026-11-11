import test from 'node:test';
import assert from 'node:assert/strict';
import {stableNetworkRoster} from '../runtime/stats-roster.mjs';

function records(events) {
  const bytes=Buffer.alloc(56+events.length*8);
  bytes.writeUInt32LE(0x54454e46,0);bytes.writeUInt32LE(2,4);
  bytes.writeUInt32LE(events.length,12);bytes.writeUInt32LE(1,24);
  bytes.writeUInt32LE(events.length*8,32);bytes.writeUInt32LE(events.length*8,36);
  bytes.writeUInt32LE(events.length,48);
  events.forEach(([tick,type],i)=>{bytes.writeUInt32LE(tick,56+i*8);bytes.writeUInt16LE(type,60+i*8);});
  return bytes;
}
test('whole-match roster excludes joins, leaves and team switches, but not post-result departures',()=>{
  for(const type of [4,6,7])assert.equal(stableNetworkRoster(records([[50,type]]),0,100),false);
  assert.equal(stableNetworkRoster(records([[100,6],[110,7]]),0,100),true);
  assert.equal(stableNetworkRoster(records([[0,3],[50,2]]),0,100),true);
  assert.equal(stableNetworkRoster(Buffer.alloc(0),0,100),true);
});
test('truncated source records cannot prove eligibility',()=>{
  assert.throws(()=>stableNetworkRoster(records([[1,6]]).subarray(0,60),0,100));
});
