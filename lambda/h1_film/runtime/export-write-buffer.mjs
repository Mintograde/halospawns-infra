import assert from 'node:assert/strict';

// The retained engine reuses its WASM memory after each synchronous write.
// Own a bounded copy and drain it before reporting a successful process exit.
export function exportWriteBuffer(write, fd, capacity) {
  assert.ok(Number.isSafeInteger(fd) && fd >= 3, 'Invalid export descriptor');
  assert.ok(Number.isSafeInteger(capacity) && capacity >= 4096 && capacity <= 1024 * 1024,
    'Export buffer must be between 4096 and 1048576 bytes');
  const storage = Buffer.allocUnsafe(capacity);
  let used = 0, failure;
  const stats = {capacity, calls: 0, writes: 0, bytes: 0};
  function flush() {
    if (failure) throw failure;
    try {
      let offset = 0;
      while (offset < used) {
        const n = write(fd, storage, offset, used - offset);
        assert.ok(Number.isSafeInteger(n) && n > 0 && n <= used - offset,
          'Export pipe failed to accept buffered bytes');
        offset += n;
        stats.writes++;
      }
      used = 0;
    } catch (cause) {
      // Do not let the retained exporter's EAGAIN retry replay a partially
      // consumed input write. Any flush failure fails the entire conversion.
      failure = new Error('Buffered export write failed', {cause});
      throw failure;
    }
  }
  return {
    stats, flush,
    write(target, data, offset, length, position) {
      if (target !== fd) return write(...arguments);
      if (failure) throw failure;
      assert.ok(ArrayBuffer.isView(data) && Number.isSafeInteger(offset) && Number.isSafeInteger(length));
      assert.ok(offset >= 0 && length >= 0 && offset + length <= data.byteLength && position == null);
      const input = new Uint8Array(data.buffer, data.byteOffset + offset, length);
      stats.calls++;
      stats.bytes += length;
      let consumed = 0;
      while (consumed < length) {
        const n = Math.min(length - consumed, capacity - used);
        storage.set(input.subarray(consumed, consumed + n), used);
        used += n;
        consumed += n;
        if (used === capacity) flush();
      }
      return length;
    },
  };
}
