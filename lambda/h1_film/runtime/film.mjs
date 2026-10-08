import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import * as format2 from './adapters/film-v2-120.mjs';

export function adapterFor(profile) {
  assert.equal(profile.adapter, 'film-v2-120-v1', 'Unsupported film adapter');
  return format2;
}

// Inspect only the common signature before routing to a versioned reader.
export async function readEnvelope(path) {
  const file = await open(path, 'r');
  let format;
  try {
    const header = Buffer.alloc(8);
    assert.equal((await file.read(header, 0, 8, 0)).bytesRead, 8, 'Truncated film header');
    assert.equal(header.readUInt32LE(0), 0x314d4c46, 'Not an FLM1 film');
    format = header.readUInt32LE(4);
  } finally { await file.close(); }
  assert.equal(format, 2, 'Unsupported film format');
  return format2.readEnvelope(path);
}
