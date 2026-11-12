import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createReleaseManifest} from '../tools/release-manifest.mjs';

const registry=JSON.parse(readFileSync(new URL('../profiles/registry.json',import.meta.url)));
const profile='h1-performance-beta5-p9818-wasm-v1';
const manifest=r=>createReleaseManifest(r,'20261101-r1','sha256:'+'a'.repeat(64));

test('melee defaults retain old recipes and require the new reader',()=>{
  const r=structuredClone(registry);
  const next=r.exporters.filter(e=>e.revision===29);
  assert.equal(next.length,3);
  for(const exporter of next) {
    assert.equal(r.processing.defaults[exporter.engine_profile].exporter_revision,29);
    assert.ok(r.processing.recipes[exporter.engine_profile].some(recipe=>recipe.exporter_revision===28));
    assert.equal(r.processing.recipes[exporter.engine_profile].find(recipe=>recipe.exporter_revision===29).analytics_revision,5);
  }
  manifest(r);
  delete r.processing.requirements.melee_metrics;
  assert.throws(()=>manifest(r));
});

test('client release keeps authoritative defaults and registers its separate recipe',()=>{
  const value=manifest(registry);
  assert.equal(value.defaults[profile].exporter_revision,29);
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

test('compatible client default retains the older Beta 6 recipes and exact simulation binaries',()=>{
  const id='h1-performance-beta6-p9839-wasm-v1',value=manifest(registry);
  assert.deepEqual(value.defaults[id],{exporter_revision:29,analytics_revision:5,viewer_revision:10,max_players:16});
  assert.deepEqual(value.recipes[id].map(r=>[r.exporter_revision,r.viewer_revision]),[[14,6],[15,6],[16,7],[17,8],[18,9],[19,9],[20,9],[21,9],[22,10],[23,10],[24,10],[26,10],[27,10],[28,10],[29,10]]);
  const old=registry.exporters.find(e=>e.engine_profile===id&&e.revision===16);
  assert.deepEqual(registry.exporters.find(e=>e.engine_profile===id&&e.revision===17),{...old,revision:17});
  assert.deepEqual(registry.exporters.find(e=>e.engine_profile===id&&e.revision===18),{...old,revision:18});
  assert.deepEqual(registry.exporters.find(e=>e.engine_profile===id&&e.revision===21),
    {...registry.exporters.find(e=>e.engine_profile===id&&e.revision===20),revision:21});
  assert.deepEqual(registry.exporters.find(e=>e.engine_profile===id&&e.revision===22),
    {...registry.exporters.find(e=>e.engine_profile===id&&e.revision===21),revision:22});
  assert.deepEqual(registry.exporters.find(e=>e.engine_profile===id&&e.revision===23),
    {...registry.exporters.find(e=>e.engine_profile===id&&e.revision===22),revision:23});
  for(const source of [id,profile])assert.deepEqual(registry.exporters.find(e=>e.engine_profile===source&&e.revision===24),
    {...registry.exporters.find(e=>e.engine_profile===source&&e.revision===21),revision:24});
  const bad=structuredClone(registry);delete bad.processing.requirements.compact_match_replay;
  assert.throws(()=>manifest(bad));
  const missing=structuredClone(registry);delete missing.processing.requirements.client_roster_mismatch;
  assert.throws(()=>manifest(missing));
  const unsupported=structuredClone(registry);delete unsupported.processing.requirements.unsupported_client_build;
  assert.throws(()=>manifest(unsupported));
});

test('bot-aware host recipes retain exact binaries and require their reader',()=>{
  for(const [id,revision] of [['h1-performance-beta6-p9839-wasm-v1',24],['h1-performance-beta7-p9844-wasm-v1',25]]) {
    assert.ok(manifest(registry).recipes[id].some(r=>r.exporter_revision===26));
    assert.deepEqual(registry.exporters.find(e=>e.engine_profile===id&&e.revision===26),
      {...registry.exporters.find(e=>e.engine_profile===id&&e.revision===revision),revision:26});
  }
  const bad=structuredClone(registry);delete bad.processing.requirements.network_host_bots;
  assert.throws(()=>manifest(bad));
});

test('missing client match IDs use new recipes with exact binaries and unchanged viewer contracts',()=>{
  for(const [id,viewer] of [['h1-performance-beta6-p9839-wasm-v1',10],['h1-performance-beta7-p9844-wasm-v1',11]]) {
    assert.ok(manifest(registry).recipes[id].some(r=>JSON.stringify(r)===JSON.stringify(
      {exporter_revision:27,analytics_revision:5,viewer_revision:viewer,max_players:16})));
    assert.deepEqual(registry.exporters.find(e=>e.engine_profile===id&&e.revision===27),
      {...registry.exporters.find(e=>e.engine_profile===id&&e.revision===26),revision:27});
    assert.ok(manifest(registry).recipes[id].some(r=>r.exporter_revision===26));
  }
});

test('native pistol counters cover every engine without changing prior recipes or viewer formats',()=>{
  const value=manifest(registry);
  for(const p of registry.profiles) {
    const recipes=value.recipes[p.id];
    const current=recipes.find(recipe=>recipe.exporter_revision===28);
    const previous=recipes[recipes.indexOf(current)-1];
    assert.deepEqual(current,{...previous,exporter_revision:28});
    assert.ok(registry.exporters.some(e=>e.engine_profile===p.id&&e.revision===28));
  }
  const missing=structuredClone(registry);delete missing.processing.requirements.pistol_accuracy;
  assert.throws(()=>manifest(missing));
  const wrong=structuredClone(registry);wrong.processing.requirements.pistol_accuracy='unknown';
  assert.throws(()=>manifest(wrong));
});

test('gameplay recipes require both shot evidence exporters and a compatible metric reader',()=>{
  for(const mutate of [
    r=>delete r.processing.requirements.gameplay_metrics,
    r=>delete r.processing.requirements.gameplay_estimates,
    r=>delete r.processing.requirements.three_shot_headshot,
    r=>r.processing.defaults[profile].exporter_revision=12,
    r=>r.processing.recipes['h1-performance-beta4-p9803-wasm-v1'].at(-1).analytics_revision=5,
  ]) {const r=structuredClone(registry);mutate(r);assert.throws(()=>manifest(r));}
});
