import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectViewPair} from '../tools/inspect-view-pair.mjs';
function film(client=false) {
  const b=Buffer.alloc(504);
  for(const [offset,value] of [[0,0x314d4c46],[4,2],[8,9818],[12,120],[28,client?106:42],[44,client?10:100],[64,504],[488,123]]) b.writeUInt32LE(value,offset);
  b.write('dread',128); b.write('Windows - fbbfae27',384);
  return b;
}
test('pair discovery preserves unequal coverage without claiming playback validation',()=>{
  const p=inspectViewPair(film(),film(true));
  assert.equal(p.playback_validated,false);
  assert.equal(p.host.frame_count,100); assert.equal(p.client.frame_count,10);
});
test('pair discovery rejects unrelated matches, wrong roles and unknown engines',()=>{
  const client=film(true); client.writeUInt32LE(124,488);
  assert.throws(()=>inspectViewPair(film(),client),/match_id mismatch/);
  assert.throws(()=>inspectViewPair(film(true),film()),/host recording/);
  client.fill(0,384,448); client.write('unknown',384);
  assert.throws(()=>inspectViewPair(film(),client));
});
