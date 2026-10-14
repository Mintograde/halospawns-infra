import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const LIMIT = 4 * 1024 * 1024;
const objectFields = ['object_id', 'object_type', 'tag_name', 'x', 'y', 'z',
  'forward_x', 'forward_y', 'forward_z', 'up_x', 'up_y', 'up_z', 'parent_ref', 'owner_object_ref'];
const spawnFields = ['spawn_index', 'x', 'y', 'z', 'facing', 'team', 'gametypes'];
const encodedKeys = new Map([...objectFields, ...spawnFields].map(key => {
  const bytes = Buffer.alloc(4 + Buffer.byteLength(key));
  bytes.writeUInt32LE(Buffer.byteLength(key));
  bytes.write(key, 4);
  return [key, bytes];
}));

export function expandFrame(input, output = Buffer.alloc(LIMIT)) {
  let offset = 0, written = 0;
  function take(size) {
    assert.ok(size >= 0 && offset + size <= input.length, 'Truncated packed transport');
    const bytes = input.subarray(offset, offset + size);
    offset += size;
    return bytes;
  }
  function put(bytes) {
    assert.ok(written + bytes.length <= Math.min(LIMIT, output.length), 'Expanded frame exceeds limit');
    output.set(bytes, written);
    written += bytes.length;
  }
  function byte(value) {
    assert.ok(written < Math.min(LIMIT, output.length), 'Expanded frame exceeds limit');
    output[written++] = value;
  }
  function count(value) {
    assert.ok(written + 4 <= Math.min(LIMIT, output.length), 'Expanded frame exceeds limit');
    output.writeUInt32LE(value, written);
    written += 4;
  }
  function text() {
    const size = take(4);
    const length = size.readUInt32LE();
    assert.ok(length <= 65536, 'String exceeds limit');
    put(size);
    put(take(length));
  }
  function scalar(tag) {
    byte(tag);
    if (tag <= 2) return;
    const bytes = take(tag === 6 ? 8 : 4);
    if (tag === 5 || tag === 6) assert.ok(Number.isFinite(tag === 5 ? bytes.readFloatLE() : bytes.readDoubleLE()));
    put(bytes);
  }
  function value(depth) {
    assert.ok(depth < 32, 'Transport nesting limit');
    const tag = take(1)[0];
    if (tag <= 6) return scalar(tag);
    if (tag === 7) { byte(tag); text(); return; }
    if (tag === 8 || tag === 9) {
      const length = take(4).readUInt32LE();
      assert.ok(length <= 65536, 'Collection exceeds limit');
      byte(tag); count(length);
      for (let index = 0; index < length; index++) {
        if (tag === 9) text();
        value(depth + 1);
      }
      return;
    }
    assert.ok(tag >= 10 && tag <= 12, 'Unknown packed transport tag');
    assert.ok(depth + (tag === 11 ? 2 : 1) < 32, 'Expanded transport nesting limit');
    if (tag === 12) {
      byte(8); count(13);
      for (let index = 0; index < 13; index++) scalar(5);
      return;
    }
    const fields = tag === 10 ? objectFields : spawnFields;
    byte(9); count(fields.length);
    for (const [index, key] of fields.entries()) {
      put(encodedKeys.get(key));
      if (tag === 10) {
        if (index === 0) scalar(4);
        else if (index === 1) scalar(3);
        else if (index === 2) { byte(7); text(); }
        else if (index < 12) scalar(5);
        else {
          const bytes = take(4);
          byte(bytes.readUInt32LE() === 0xffffffff ? 3 : 4);
          put(bytes);
        }
      } else if (index === 0 || index === 5) scalar(3);
      else if (index < 5) scalar(5);
      else {
        byte(8); count(4);
        for (let item = 0; item < 4; item++) scalar(3);
      }
    }
  }
  assert.equal(input[0], 9, 'Frame root must be an object');
  value(0);
  assert.equal(offset, input.length, 'Trailing packed transport data');
  return output.subarray(0, written);
}

export async function hashCanonicalStream(stream, contract = 'HSFT0001') {
  assert.ok(['HSFT0001', 'HSFT0002'].includes(contract));
  const wireHash = createHash('sha256'), canonicalHash = createHash('sha256');
  let wireBytes = 0, canonicalBytes = 8;
  const header = Buffer.alloc(8), length = Buffer.alloc(4);
  const frame = Buffer.alloc(LIMIT), expanded = Buffer.alloc(LIMIT);
  let headerUsed = 0, lengthUsed = 0, frameUsed = 0, frameSize = 0;
  canonicalHash.update('HSFT0001');
  for await (const chunk of stream) {
    wireHash.update(chunk);
    wireBytes += chunk.length;
    let offset = 0;
    while (offset < chunk.length) {
      const destination = headerUsed < 8 ? header : lengthUsed < 4 ? length : frame;
      const used = headerUsed < 8 ? headerUsed : lengthUsed < 4 ? lengthUsed : frameUsed;
      const size = headerUsed < 8 ? 8 : lengthUsed < 4 ? 4 : frameSize;
      const copied = Math.min(size - used, chunk.length - offset);
      chunk.copy(destination, used, offset, offset + copied);
      offset += copied;
      if (destination === header) {
        headerUsed += copied;
        if (headerUsed === 8) assert.equal(header.toString('ascii'), contract, 'Transport contract mismatch');
      } else if (destination === length) {
        lengthUsed += copied;
        if (lengthUsed === 4) {
          frameSize = length.readUInt32LE();
          assert.ok(frameSize >= 5 && frameSize <= LIMIT, 'Frame exceeds limit');
        }
      } else {
        frameUsed += copied;
        if (frameUsed === frameSize) {
          const raw = frame.subarray(0, frameSize);
          const canonical = contract === 'HSFT0002' ? expandFrame(raw, expanded) : raw;
          length.writeUInt32LE(canonical.length);
          canonicalHash.update(length);
          canonicalHash.update(canonical);
          canonicalBytes += 4 + canonical.length;
          lengthUsed = 0; frameUsed = 0;
        }
      }
    }
  }
  assert.ok(headerUsed === 8 && lengthUsed === 0 && frameUsed === 0, 'Truncated transport stream');
  return { transport_bytes: wireBytes, transport_sha256: wireHash.digest('hex'),
    canonical_bytes: canonicalBytes, canonical_sha256: canonicalHash.digest('hex'),
    transport_contract: contract };
}
