// Browser-compatible reference decoder. Inject the existing delta/Zstd codecs and Three.js.
export function createPoseDecoder({ decodeBase, decompress, Quaternion, Vector3, Matrix4 }) {
  class Reader {
    constructor(bytes) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.offset = 0; }
    take(n) { if (!Number.isSafeInteger(n) || n < 0 || this.offset + n > this.bytes.length) throw new Error('Truncated pose block'); const v = this.bytes.subarray(this.offset, this.offset + n); this.offset += n; return v; }
    number(size, method) { const at = this.offset; this.take(size); return this.view[method](at, true); }
    u8() { return this.number(1, 'getUint8'); }
    u16() { return this.number(2, 'getUint16'); }
    u32() { return this.number(4, 'getUint32'); }
    i32() { return this.number(4, 'getInt32'); }
    f64() { const v = this.number(8, 'getFloat64'); if (!Number.isFinite(v)) throw new Error('Nonfinite pose'); return v; }
    signed() { let v = 0, factor = 1; for (let i = 0; i < 8; i++) { const b = this.u8(); v += (b & 127) * factor; if (!Number.isSafeInteger(v)) throw new Error('Varint overflow'); if (b < 128) return v % 2 ? -(v + 1) / 2 : v / 2; factor *= 128; } throw new Error('Varint overflow'); }
    end() { if (this.offset !== this.bytes.length) throw new Error('Trailing bytes'); }
  }
  const inflate = (bytes, size) => { if (size > 64 * 1024 * 1024) throw new Error('Block too large'); const result = decompress(bytes); if (result.length !== size) throw new Error('Block size mismatch'); return result; };
  function track(r, n) {
    const mode = r.u8(); if (mode > 2) throw new Error('Unknown track mode');
    let value = r.i32(), delta = 0; const values = [value];
    for (let i = 1; i < n; i++) {
      if (mode) { const d = r.signed(); delta = mode === 1 ? d : delta + d; value += delta; }
      if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('Track overflow');
      values.push(value);
    }
    return values;
  }
  function order(parents) {
    const result = [], done = new Set();
    while (result.length < parents.length) {
      const before = result.length;
      parents.forEach((p, i) => { if (p < -1 || p >= parents.length || p === i) throw new Error('Invalid parent'); if (!done.has(i) && (p === -1 || done.has(p))) { done.add(i); result.push(i); } });
      if (result.length === before) throw new Error('Cyclic skeleton');
    }
    return result;
  }
  function reconstruct(values, parents, sorted, player, settings) {
    const body = player.player_object_data;
    const base = { p: new Vector3(body?.x ?? 0, body?.y ?? 0, body?.z ?? 0), q: new Quaternion(), s: 1 };
    const world = new Array(parents.length), nodes = new Array(parents.length);
    for (const i of sorted) {
      const v = values[i], parent = parents[i] < 0 ? base : world[parents[i]];
      let q;
      if (settings.smallest_three) {
        if (v[7] < 0 || v[7] > 3) throw new Error('Invalid omitted component');
        const components = [0, 0, 0, 0]; let j = 4;
        for (let c = 0; c < 4; c++) if (c !== v[7]) components[c] = v[j++] / (settings.quaternion_levels * Math.SQRT2);
        const sum = components.reduce((a, b) => a + b * b, 0); if (sum > 1) throw new Error('Invalid quaternion');
        components[v[7]] = Math.sqrt(1 - sum); q = new Quaternion(...components);
      } else { q = new Quaternion(...v.slice(4).map(n => n / settings.quaternion_levels)); }
      if (q.lengthSq() < 1e-12) throw new Error('Zero quaternion');
      q.normalize();
      const p = new Vector3(v[0], v[1], v[2]).multiplyScalar(settings.translation_step * parent.s).applyQuaternion(parent.q).add(parent.p);
      q.premultiply(parent.q).normalize();
      const scale = v[3] * settings.scale_step * parent.s;
      world[i] = { p, q, s: scale };
      const m = new Matrix4().makeRotationFromQuaternion(q).elements;
      nodes[i] = [p.x, p.y, p.z, scale, m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]].map(Math.fround);
    }
    return nodes;
  }
  return (block, settings) => {
    for (const key of ['translation_step', 'quaternion_levels', 'scale_step', 'point_error_limit', 'point_radius']) if (!Number.isFinite(settings[key]) || settings[key] <= 0) throw new Error('Invalid settings');
    const r = new Reader(block);
    if (new TextDecoder().decode(r.take(4)) !== 'PC01') throw new Error('Invalid pose chunk');
    const br = r.u32(), bc = r.u32(), pr = r.u32(), pc = r.u32();
    const base = decodeBase(inflate(r.take(bc), br)), poses = inflate(r.take(pc), pr); r.end();
    // The legacy JS delta decoder shares unchanged subtrees between ticks.
    const ticks = base.ticks.map(t => ({ ...t, players: t.players.map(p => ({ ...p })) }));
    const p = new Reader(poses), count = p.u16(); if (count > ticks.length * 4) throw new Error('Too many runs');
    const seen = new Set();
    for (let run = 0; run < count; run++) {
      const start = p.u16(), pi = p.u8(), n = p.u16(), bones = p.u8();
      if (n === 0 || start + n > ticks.length || pi >= 4 || bones === 0 || bones > 64) throw new Error('Invalid pose run bounds');
      const parents = Array.from({ length: bones }, () => p.u8() - 1), sorted = order(parents);
      const frames = Array.from({ length: n }, () => Array.from({ length: bones }, () => new Array(8)));
      for (let node = 0; node < bones; node++) for (let c = 0; c < 8; c++) { const values = track(p, n); for (let f = 0; f < n; f++) frames[f][node][c] = values[f]; }
      const rawCount = p.u16(); if (rawCount > n) throw new Error('Too many raw poses'); const raw = new Map();
      for (let f = 0; f < rawCount; f++) { const index = p.u16(); if (index >= n || raw.has(index)) throw new Error('Invalid fallback'); raw.set(index, Array.from({ length: bones }, () => Array.from({ length: 13 }, () => p.f64()))); }
      for (let f = 0; f < n; f++) {
        const player = ticks[start + f].players[pi], key = (start + f) * 4 + pi;
        if (!player || 'model_nodes' in player || seen.has(key)) throw new Error('Invalid pose destination'); seen.add(key);
        player.model_nodes = raw.get(f) ?? reconstruct(frames[f], parents, sorted, player, settings);
      }
    }
    p.end(); return { firstTick: base.firstTick, ticks };
  };
}
