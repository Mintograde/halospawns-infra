import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createReleaseManifest} from '../tools/release-manifest.mjs';

const registry=JSON.parse(readFileSync(new URL('../profiles/registry.json',import.meta.url)));
const profile='h1-performance-beta5-p9818-wasm-v1';
const manifest=r=>createReleaseManifest(r,'20261101-r1','sha256:'+'a'.repeat(64));

test('client release keeps authoritative defaults and registers its separate recipe',()=>{
  const value=manifest(registry);
  assert.equal(value.defaults[profile].exporter_revision,20);
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

test('gameplay attribution default retains the older Beta 6 recipes and exact simulation binaries',()=>{
  const id='h1-performance-beta6-p9839-wasm-v1',value=manifest(registry);
  assert.deepEqual(value.defaults[id],{exporter_revision:20,analytics_revision:5,viewer_revision:9,max_players:16});
  assert.deepEqual(value.recipes[id].map(r=>[r.exporter_revision,r.viewer_revision]),[[14,6],[15,6],[16,7],[17,8],[18,9],[19,9],[20,9]]);
  const old=registry.exporters.find(e=>e.engine_profile===id&&e.revision===16);
  assert.deepEqual(registry.exporters.find(e=>e.engine_profile===id&&e.revision===17),{...old,revision:17});
  assert.deepEqual(registry.exporters.find(e=>e.engine_profile===id&&e.revision===18),{...old,revision:18});
  const bad=structuredClone(registry);delete bad.processing.requirements.compact_match_replay;
  assert.throws(()=>manifest(bad));
  const missing=structuredClone(registry);delete missing.processing.requirements.client_roster_mismatch;
  assert.throws(()=>manifest(missing));
});

test('gameplay recipes require both shot evidence exporters and a compatible metric reader',()=>{
  for(const mutate of [
    r=>delete r.processing.requirements.gameplay_metrics,
    r=>r.processing.defaults[profile].exporter_revision=12,
    r=>r.processing.recipes['h1-performance-beta4-p9803-wasm-v1'].at(-1).analytics_revision=5,
  ]) {const r=structuredClone(registry);mutate(r);assert.throws(()=>manifest(r));}
});
