// Explicit operator-owned local bindings for tests, not public map registration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { profileById } from '../runtime/profiles.mjs';

const { values } = parseArgs({ options: { maps: { type: 'string' }, output: { type: 'string' },
  profile: { type: 'string' }, 'trusted-local': { type: 'boolean' } } });
assert.ok(values.maps && values.output && values['trusted-local'], 'Use --maps --output --profile --trusted-local');
const profile = profileById(values.profile);
const maps = [];
for (const entry of await readdir(values.maps, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.map')
    || ['ui.map', 'bitmaps.map', 'sounds.map', 'loc.map'].includes(entry.name)) continue;
  const path = join(values.maps, entry.name);
  const file = await open(path, 'r');
  let size, scenario;
  try {
    size = (await file.stat()).size;
    assert.ok(size >= 2048 && size <= 512 * 1024 * 1024, 'Invalid raw map size');
    const header = Buffer.alloc(2048);
    assert.equal((await file.read(header, 0, 2048, 0)).bytesRead, 2048);
    assert.equal(header.subarray(0, 4).toString(), 'daeh');
    assert.equal(header.readUInt32LE(4), profile.map_cache_version, 'Map cache format differs from profile');
    assert.equal(header.subarray(2044).toString(), 'toof');
    scenario = header.subarray(32, 64).toString('utf8').split('\0')[0];
    assert.match(scenario, /^[a-zA-Z0-9_-]+$/);
    assert.equal(entry.name, `${scenario}.map`, 'Map filename differs from cache identity');
  } finally { await file.close(); }
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  maps.push({ engine_profile: values.profile, scenario, size_bytes: size, sha256: hash.digest('hex') });
}
assert.ok(maps.length > 0 && maps.length <= 4096);
maps.sort((a, b) => a.scenario.localeCompare(b.scenario));
await writeFile(values.output, JSON.stringify({ schema: 'halospawns.h1FilmMapCatalog.v1',
  origin: 'operator_asserted_local_build_directory', maps }, null, 2) + '\n', { flag: 'wx' });
console.log(`Cataloged ${maps.length} raw maps. No hosted map/release identities assigned.`);
