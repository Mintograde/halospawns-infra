import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {recordedNetwork, networkStorage} from '../runtime/recorded-network.mjs';

const pin = bytes => ({size_bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')});

test('network storage binds the decoded index to the original bytes and logical digest', () => {
  // A type-5 observation at tick 7 has an eight-byte header and no payload.
  const records = Buffer.from([7,0,0,0,5,0,0,0]);
  const bytes = Buffer.alloc(32 + 24 + records.length);
  bytes.write('FNET');
  bytes.writeUInt32LE(2,4);
  bytes.writeUInt32LE(32,8);
  bytes.writeUInt32LE(1,12);
  bytes.writeUInt32LE(records.length,16);
  bytes.writeUInt32LE(1,24);
  bytes.writeUInt32LE(bytes.length-32,28);
  for (const [i,word] of [8,8,7,7,1,0].entries()) bytes.writeUInt32LE(word,32+4*i);
  records.copy(bytes,56);
  const scanned = recordedNetwork(bytes,true);
  const source = pin(bytes), logical = pin(records);
  assert.deepEqual(scanned.records,[records]);
  const expected = [{offset:0,size_bytes:8,source_offset:56,source_size_bytes:8,count:1,flags:0,sha256:logical.sha256}];
  for (const blocks of [scanned.blocks,structuredClone(scanned.blocks)]) {
    assert.deepEqual(networkStorage(bytes,source,logical,blocks),expected);
    assert.throws(()=>networkStorage(bytes,source,{...logical,sha256:source.sha256},blocks));
    const changed = Buffer.from(bytes);
    changed[56]++;
    assert.throws(()=>networkStorage(changed,source,logical,blocks));
    assert.throws(()=>networkStorage(bytes,{...source,size_bytes:bytes.length-1},logical,blocks));
  }
  const storage = networkStorage(bytes,source,logical,scanned.blocks);
  storage[0].source_offset = 0;
  assert.deepEqual(networkStorage(bytes,source,logical,scanned.blocks),expected);
  const forged = structuredClone(scanned.blocks);
  forged[0].first_tick++;
  assert.throws(()=>networkStorage(bytes,source,logical,forged));
  assert.throws(()=>recordedNetwork(bytes.subarray(0,28)));
  assert.throws(()=>recordedNetwork(bytes.subarray(0,-1)));
});
