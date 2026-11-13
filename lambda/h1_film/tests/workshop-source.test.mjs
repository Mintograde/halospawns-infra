import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkshopSource, workshopItemId, workshopRevision, needsWorkshopRefresh}
  from '../runtime/workshop-source.mjs';

function film(header = 504) {
  const b = Buffer.alloc(header + 24);
  for (const [at, value] of [[0,0x314d4c46],[4,3],[28,128],[64,header],[72,b.length],
    [header,0x3150414d],[header+4,1],[header+8,24],[header+12,976730]]) b.writeUInt32LE(value,at);
  b.writeBigUInt64LE(18446744073709551615n,header+16);
  return b;
}
test('MAP1 preserves full unsigned 64-bit IDs and handles outer envelopes', () => {
  for (const size of [504,536]) assert.deepEqual(readWorkshopSource(film(size)),
    {app_id:976730,item_id:'18446744073709551615',provenance:'film_map1_v1'});
});
test('absent, truncated, unsupported and malformed provenance stays unknown', () => {
  for (let length=0; length<528; length++) assert.equal(readWorkshopSource(film().subarray(0,length)),null);
  for (const [offset,value] of [[28,0],[4,2],[64,12],[72,24],[72,529],[504,0],[508,2],[512,23],[516,1]]) {
    const b=film(); b.writeUInt32LE(value,offset); assert.equal(readWorkshopSource(b),null);
  }
  const b=film(); b.writeBigUInt64LE(0n,520); assert.equal(readWorkshopSource(b),null);
});
test('IDs reject rounding, command syntax and overflow', () => {
  for (const id of [123,'0','01','-1','1 +quit','18446744073709551616'])
    assert.throws(()=>workshopItemId(id));
});
test('revision changes include timestamp regression; unrelated apps cannot be ingested', () => {
  const raw={result:1,consumer_app_id:976730,publishedfileid:'123',time_updated:10};
  const current=workshopRevision(raw,'123');
  assert.equal(needsWorkshopRefresh(null,current),true);
  assert.equal(needsWorkshopRefresh(current,{...current}),false);
  assert.equal(needsWorkshopRefresh(current,{...current,time_updated:9}),true);
  for (const patch of [{result:9},{consumer_app_id:1},{publishedfileid:'124'},{time_updated:NaN}])
    assert.throws(()=>workshopRevision({...raw,...patch},'123'));
});
