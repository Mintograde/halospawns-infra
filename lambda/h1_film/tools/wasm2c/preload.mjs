// Loaded only by the offline simulator benchmark.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

assert.equal(process.env.H1_AOT_OFFLINE, '1', 'Native experiment is offline only');
const native = createRequire(import.meta.url)(process.env.H1_AOT_MODULE);
WebAssembly.instantiate = async (bytes, imports) => {
  assert.ok(bytes instanceof Uint8Array, 'Expected the original engine bytes');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), native.wasm_sha256);
  return { instance: { exports: native.instantiate(imports) } };
};
