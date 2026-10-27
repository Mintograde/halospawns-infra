import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])])
  );
  return value;
}

const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const health = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const digest = createHash('sha256').update(JSON.stringify(canonical(manifest.registry))).digest('hex');
assert.equal(health.release.registry_sha256, digest);
assert.equal(health.release.image_digest, manifest.image_digest);
assert.equal(health.release.release_id, manifest.release_id);
assert.equal(health.mode, 'intake');
assert.equal(health.intake_enabled, true);
console.log('Deployed release registry and image verified.');
