import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import * as format2 from './adapters/film-v2-120.mjs';
import * as arena from './adapters/h1arena-v2-120.mjs';
import * as beta5 from './adapters/beta5-v2-120.mjs';
import * as beta4 from './adapters/beta4-v2-120.mjs';

export function adapterFor(profile) {
  if (profile.adapter === 'beta5-v2-120-v1') return beta5;
  if (profile.adapter === 'beta4-v2-120-v1') return beta4;
  if (profile.adapter === 'h1arena-v2-120-v1') return arena;
  assert.equal(profile.adapter, 'film-v2-120-v1', 'Unsupported film adapter');
  return format2;
}

// Inspect only the common signature before routing to a versioned reader.
export async function readEnvelope(path) {
  const file = await open(path, 'r');
  let format, headerSize, protocol;
  try {
    const header = Buffer.alloc(68);
    assert.equal((await file.read(header, 0, 68, 0)).bytesRead, 68, 'Truncated film header');
    assert.equal(header.readUInt32LE(0), 0x314d4c46, 'Not an FLM1 film');
    format = header.readUInt32LE(4);
    protocol = header.readUInt32LE(8);
    headerSize = header.readUInt32LE(64);
  } finally { await file.close(); }
  assert.equal(format, 2, 'Unsupported film format');
  if (headerSize === 504 && protocol === 9818) return beta5.readEnvelope(path);
  if (headerSize === 480 && protocol === 9803) return beta4.readEnvelope(path);
  return (headerSize === 480 ? arena : format2).readEnvelope(path);
}
