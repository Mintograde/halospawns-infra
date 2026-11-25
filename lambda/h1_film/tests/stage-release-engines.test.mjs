import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const hash = data => createHash('sha256').update(data).digest('hex');

test('private staging shares verified binaries and never substitutes for a corrupt or missing retained release', async () => {
  const tmp = await mkdtemp(join(tmpdir(),'h1-engine-staging-'));
  try {
    await cp(new URL('../runtime',import.meta.url),join(tmp,'runtime'),{recursive:true});
    await mkdir(join(tmp,'tools'));
    const script = join(tmp,'tools/stage-release-engines.mjs');
    await copyFile(new URL('../tools/stage-release-engines.mjs',import.meta.url),script);
    const registry = JSON.parse(await readFile(new URL('../profiles/registry.json',import.meta.url)));
    const base = {...registry.profiles[0],glue_sha256:hash('glue'),wasm_sha256:hash('wasm')};
    const pins = {engine_profile:base.id,wasm_sha256:base.wasm_sha256,glue_sha256:base.glue_sha256};
    const previous = {exporter_revision:44}, current = {exporter_revision:45};
    await mkdir(join(tmp,'profiles'));
    await writeFile(join(tmp,'profiles/registry.json'),JSON.stringify({
      schema:registry.schema, profiles:[base], exporters:[{...pins,revision:44},{...pins,revision:45}],
      processing:{defaults:{[base.id]:current},recipes:{[base.id]:[previous,current]}},
    }));
    const store = join(tmp,'store'), source = join(store,base.id), old = join(source,'exporter-44');
    await mkdir(old,{recursive:true});
    for (const dir of [source,old]) {
      await writeFile(join(dir,'package.json'),'{"type":"commonjs"}');
      await writeFile(join(dir,'h1-film.js'),'glue');
      await writeFile(join(dir,'h1-film.wasm'),'wasm');
    }
    const stage = name => exec(process.execPath,[script,'--engine-root',store,'--output',join(tmp,name)]);
    const result = JSON.parse((await stage('bundle')).stdout);
    assert.equal(result.unique_binaries,2);
    assert.equal(result.logical_binary_bytes,24);
    const destination = join(tmp,'bundle',base.id,'exporter-45','h1-film.wasm');
    assert.equal(await readFile(destination,'utf8'),'wasm');
    if (result.staged_binary_bytes === 8) {
      assert.equal((await lstat(destination,{bigint:true})).ino,(await lstat(join(tmp,'bundle',base.id,'h1-film.wasm'),{bigint:true})).ino);
    }
    await assert.rejects(stage('bundle'));
    await cp(old,join(source,'exporter-45'),{recursive:true});
    await writeFile(join(source,'exporter-45','h1-film.wasm'),'wrong');
    await assert.rejects(stage('bad'),/WASM differs/);
    await assert.rejects(lstat(join(tmp,'bad')),{code:'ENOENT'});
    await rm(join(old,'h1-film.wasm'));
    await assert.rejects(stage('missing'),/ENOENT/);
    assert.equal(await readFile(destination,'utf8'),'wasm');
  } finally { await rm(tmp,{recursive:true,force:true}); }
});
