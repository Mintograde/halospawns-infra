import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createReleaseManifest} from '../tools/release-manifest.mjs';

const registry=JSON.parse(readFileSync(new URL('../profiles/registry.json',import.meta.url)));
const profile='h1-performance-beta5-p9818-wasm-v1';
const manifest=r=>createReleaseManifest(r,'20261101-r1','sha256:'+'a'.repeat(64));

test('client release keeps authoritative defaults and registers its separate recipe',()=>{
  const value=manifest(registry);
  assert.equal(value.defaults[profile].exporter_revision,12);
  assert.equal(value.client_view_recipes[profile][0].exporter_revision,13);
  for(const mutate of [
    r=>r.processing.recipes[profile].push(r.processing.client_view_recipes[profile][0]),
    r=>delete r.processing.requirements.client_view,
    r=>r.processing.client_view_recipes[profile][0].analytics_revision=4,
    r=>r.processing.client_view_recipes[profile][0].viewer_revision=4,
    r=>r.exporters=r.exporters.filter(e=>e.revision!==13),
  ]) {const r=structuredClone(registry);mutate(r);assert.throws(()=>manifest(r));}
});

test('historical manifests do not acquire a client recipe field',()=>{
  const old=structuredClone(registry);
  delete old.processing.client_view_recipes;
  delete old.processing.requirements.client_view;
  assert.equal(Object.hasOwn(manifest(old),'client_view_recipes'),false);
});
