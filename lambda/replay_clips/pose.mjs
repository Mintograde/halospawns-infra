import assert from 'node:assert/strict';

function u16(value) {
  const bytes = Buffer.allocUnsafe(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function signed(value) {
  let n = value < 0 ? -2 * value - 1 : 2 * value;
  const bytes = [];
  while (n >= 128) {
    bytes.push(128 + n % 128);
    n = Math.floor(n / 128);
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

// Preserve the original quantized tracks and literal float64 fallbacks. Only
// the first value and second-order predictor at the new boundary need rebasing.
export function slicePoseRuns(bytes, sourceCount, from, to, destination) {
  const runs = [];
  let pos = 0;
  function take(n) {
    assert.ok(n >= 0 && pos + n <= bytes.length, 'Truncated pose stream');
    const out = bytes.subarray(pos, pos + n);
    pos += n;
    return out;
  }
  const count = () => take(2).readUInt16LE();
  function difference() {
    let value = 0;
    for (let factor = 1; factor <= 2 ** 49; factor *= 128) {
      const b = take(1)[0];
      value += (b & 127) * factor;
      if (b < 128) {
        assert.ok(Number.isSafeInteger(value));
        return value % 2 ? -(value + 1) / 2 : value / 2;
      }
    }
    throw Error('Invalid pose difference');
  }
  const total = count();
  for (let r = 0; r < total; r++) {
    const first = count(), player = take(1)[0], frames = count(), bones = take(1)[0];
    assert.ok(player < 16 && frames > 0 && first + frames <= sourceCount && bones > 0 && bones <= 64);
    const parents = take(bones);
    const lo = Math.max(from - first, 0), hi = Math.min(to - first, frames);
    const keep = lo < hi, parts = [];
    if (keep) parts.push(u16(destination + first + lo - from), Buffer.from([player]),
      u16(hi - lo), Buffer.from([bones]), parents);
    for (let c = 0; c < bones * 8; c++) {
      const mode = take(1)[0];
      let value = take(4).readInt32LE(), delta = 0, initial = value, tail = 0, tailEnd = 0;
      assert.ok(mode <= 2, 'Invalid pose predictor');
      let restart;
      if (mode) {
        for (let i = 1; i < frames; i++) {
          const begin = pos, diff = difference();
          delta = mode === 1 ? diff : delta + diff;
          value += delta;
          assert.ok(value >= -2147483648 && value <= 2147483647);
          if (i === lo) initial = value;
          if (i === lo + 1) {
            restart = mode === 2 ? signed(delta) : bytes.subarray(begin, pos);
            tail = pos;
          }
          if (i === hi - 1) tailEnd = pos;
        }
      }
      if (keep) {
        const header = Buffer.allocUnsafe(5);
        header[0] = mode;
        header.writeInt32LE(initial, 1);
        parts.push(header);
        if (mode && hi - lo > 1) parts.push(restart, bytes.subarray(tail, tailEnd));
      }
    }
    const raw = count(), literals = [];
    assert.ok(raw <= frames);
    for (let i = 0; i < raw; i++) {
      const frame = count(), matrices = take(bones * 13 * 8);
      assert.ok(frame < frames);
      if (lo <= frame && frame < hi) literals.push(u16(frame - lo), matrices);
    }
    if (keep) runs.push(Buffer.concat([...parts, u16(literals.length / 2), ...literals]));
  }
  assert.equal(pos, bytes.length, 'Trailing pose data');
  return runs;
}

export function packRuns(runs) {
  return Buffer.concat([u16(runs.length), ...runs]);
}
