import assert from 'node:assert/strict';
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { expandFrame } from '../canonical-transport.mjs';

const [nativePath, wasmPath] = process.argv.slice(2);
const native = openSync(nativePath, 'r'), wasm = openSync(wasmPath, 'r');
for (const descriptor of [native, wasm]) {
  const magic = Buffer.alloc(8);
  assert.equal(readSync(descriptor, magic, 0, 8, 0), 8);
  assert.equal(magic.toString('ascii'), 'HSFT0002');
}
const nativeBuffer = Buffer.alloc(4 * 1024 * 1024), wasmBuffer = Buffer.alloc(nativeBuffer.length);
const nativeLength = Buffer.alloc(4), wasmLength = Buffer.alloc(4);
const expanded = Buffer.alloc(nativeBuffer.length);

function decode(frame) {
  const input = expandFrame(frame, expanded);
  let offset = 0;
  function count() { const result = input.readUInt32LE(offset); offset += 4; return result; }
  function text() { const length = count(); const result = input.toString('utf8', offset, offset + length); offset += length; return result; }
  function value() {
    const tag = input[offset++];
    if (tag === 0) return null;
    if (tag <= 2) return tag === 2;
    if (tag === 3) { const result = input.readInt32LE(offset); offset += 4; return result; }
    if (tag === 4) return count();
    if (tag === 5) { const result = input.readFloatLE(offset); offset += 4; return result; }
    if (tag === 6) { const result = input.readDoubleLE(offset); offset += 8; return result; }
    if (tag === 7) return text();
    if (tag === 8) return Array.from({ length: count() }, value);
    assert.equal(tag, 9);
    const result = Object.create(null), length = count();
    for (let index = 0; index < length; index++) result[text()] = value();
    return result;
  }
  const result = value();
  assert.equal(offset, input.length);
  return result;
}

function differences(left, right, path = '') {
  if (Object.is(left, right)) return [];
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .flatMap(key => differences(left[key], right[key], `${path}.${key}`));
  }
  return [{ path, native: Object.is(left, -0) ? '-0' : left, wasm: Object.is(right, -0) ? '-0' : right }];
}

let position = 8, index = 0, differing = 0;
const fields = new Map();
try {
  while (readSync(native, nativeLength, 0, 4, position)) {
    assert.equal(readSync(wasm, wasmLength, 0, 4, position), 4);
    assert.equal(nativeLength.readUInt32LE(), wasmLength.readUInt32LE(), `Frame size at ${index}`);
    const length = nativeLength.readUInt32LE();
    assert.ok(length >= 5 && length <= nativeBuffer.length);
    assert.equal(readSync(native, nativeBuffer, 0, length, position + 4), length);
    assert.equal(readSync(wasm, wasmBuffer, 0, length, position + 4), length);
    const left = nativeBuffer.subarray(0, length), right = wasmBuffer.subarray(0, length);
    if (!left.equals(right)) {
      const nativeFrame = decode(left), wasmFrame = decode(right);
      const changes = differences(nativeFrame, wasmFrame);
      for (const change of changes) fields.set(change.path, (fields.get(change.path) ?? 0) + 1);
      if (differing < 8) console.log(JSON.stringify({ index, position, tick: nativeFrame.tick, changes }));
      differing++;
    }
    position += 4 + length;
    index++;
  }
  assert.equal(position, fstatSync(native).size);
  assert.equal(position, fstatSync(wasm).size);
  console.log(JSON.stringify({ frames: index, differing, fields: Object.fromEntries(fields) }));
} finally { closeSync(native); closeSync(wasm); }
