import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unpackMszip} from './adapters/beta5-v2-120.mjs';
import {unpackNetworkColumns} from './format3-codec.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const prepared = new WeakMap();

// Compute logical pins and their source extents while each decoded block is
// in memory. Only retain the expanded records for the original physical format.
export function recordedNetwork(bytes, retainRecords = false) {
  assert.ok(bytes.length >= 32, 'Truncated network header');
  const blocks = [], storage = [], records = [], hash = createHash('sha256');
  let at = 32, length = 0;
  for (let i = 0; i < bytes.readUInt32LE(24); i++) {
    const size = bytes.readUInt32LE(at), packed = bytes.readUInt32LE(at + 4);
    const first = bytes.readUInt32LE(at + 8), last = bytes.readUInt32LE(at + 12);
    const count = bytes.readUInt32LE(at + 16), flags = bytes.readUInt32LE(at + 20);
    at += 24;
    assert.ok(size > 0 && size <= 16777216 && packed > 0 && at + packed <= bytes.length && flags <= 3);
    assert.ok(length + size <= 512 * 1024 * 1024, 'Network expansion exceeds limit');
    const original = bytes.subarray(at, at + packed);
    const expanded = flags & 1 ? unpackMszip(original, size) : original;
    const raw = flags & 2 ? unpackNetworkColumns(expanded, count) : expanded;
    assert.equal(raw.length, size);
    const pin = sha(raw);
    hash.update(raw);
    blocks.push(Object.freeze({offset:length, size_bytes:size, first_tick:first, last_tick:last, count, sha256:pin}));
    storage.push({offset:length, size_bytes:size, source_offset:at, source_size_bytes:packed, count, flags, sha256:pin});
    if (retainRecords) records.push(raw);
    at += packed;
    length += size;
  }
  assert.equal(at, bytes.length);
  const digest = hash.digest('hex');
  Object.freeze(blocks);
  prepared.set(blocks, {sourceHash:sha(bytes), length, digest, storage});
  return {blocks, length, digest, records};
}

export function networkStorage(bytes, sourcePin, logicalPin, blocks) {
  assert.equal(bytes.length, sourcePin.size_bytes);
  let proof = prepared.get(blocks);
  if (proof) {
    assert.equal(sha(bytes), proof.sourceHash, 'Recorded network source changed');
  } else {
    const scanned = recordedNetwork(bytes);
    assert.deepEqual(scanned.blocks, blocks, 'Recorded network index differs');
    proof = prepared.get(scanned.blocks);
  }
  assert.equal(proof.sourceHash, sourcePin.sha256, 'Recorded network source differs');
  assert.equal(proof.length, logicalPin.size_bytes);
  assert.equal(proof.digest, logicalPin.sha256);
  return proof.storage.map(block => ({...block}));
}
