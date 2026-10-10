import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENGINE_PROFILES, ENGINE_EXPORTERS, profileById, selectExporter } from './runtime/profiles.mjs';
import { resolveEngine, sha256 } from './runtime/engine-store.mjs';

async function inventory() {
  const root = process.env.H1_ENGINE_ROOT || fileURLToPath(new URL('./engines', import.meta.url));
  const profiles = [];
  for (const profile of ENGINE_PROFILES) {
    const { hashes } = await resolveEngine(profile, root);
    profiles.push({ id: profile.id, ...hashes });
  }
  const exporters = [];
  for (const entry of ENGINE_EXPORTERS) {
    const profile = selectExporter(profileById(entry.engine_profile), entry.revision);
    const { hashes } = await resolveEngine(profile, root);
    exporters.push({ engine_profile: profile.id, revision: entry.revision, ...hashes });
  }
  const encoder = fileURLToPath(new URL('./bin/h1-film-encoder', import.meta.url));
  // The usage response proves the Linux executable can load without a film/map.
  await new Promise((resolve, reject) => {
    execFile(encoder, [], { timeout: 10000, maxBuffer: 65536, env: { LANG: 'C' } },
      (error, stdout, stderr) => {
        if (error?.code === 1 && stderr.startsWith('h1-film-encoder: usage:')) resolve();
        else reject(new Error('Packaged encoder failed its executable check'));
      });
  });
  return { profiles, exporters, encoder_sha256: await sha256(encoder) };
}

export async function handler(event) {
  assert.equal(process.env.H1_WORKER_MODE, 'foundation', 'Unsupported H1 worker mode');
  // Never acknowledge SQS/S3 records or accept caller-supplied paths/commands.
  assert.ok(event && !Array.isArray(event) && typeof event === 'object'
    && Object.keys(event).length === 2
    && Object.hasOwn(event, 'schema') && Object.hasOwn(event, 'action')
    && event.schema === 'halospawns.h1FilmHealth.v1' && event.action === 'health',
  'H1 upload intake is not implemented; only the exact health request is accepted');
  return {
    schema: 'halospawns.h1FilmHealth.v1',
    mode: 'foundation',
    intake_enabled: false,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    ...await inventory(),
  };
}
