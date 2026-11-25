// Build the private Docker context. All historical paths are present, while
// equal binaries occupy one inode within the new staging directory.
import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {copyFile, link, lstat, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {resolveEngine, sha256} from '../runtime/engine-store.mjs';
import {ENGINE_PROFILES, ENGINE_EXPORTERS, profileById, selectExporter} from '../runtime/profiles.mjs';

const {values} = parseArgs({options:{'engine-root':{type:'string'}, output:{type:'string'}}});
assert.ok(values['engine-root'] && values.output, 'Use --engine-root PRIVATE_STORE --output NEW_DIRECTORY');
const root = resolve(values['engine-root']), output = resolve(values.output);
const {processing} = JSON.parse(await readFile(new URL('../profiles/registry.json',import.meta.url)));
const firstCopy = new Map();
let logicalBytes = 0, physicalBytes = 0;

async function stageFile(source, destination, hash) {
  const size = (await lstat(source)).size;
  logicalBytes += size;
  if (firstCopy.has(hash)) {
    try {
      await link(firstCopy.get(hash),destination);
      return;
    } catch (error) {
      if (!['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV','EMLINK'].includes(error.code)) throw error;
    }
  }
  await copyFile(source,destination,constants.COPYFILE_EXCL);
  assert.equal(await sha256(destination),hash,'Staged engine bytes changed while copying');
  firstCopy.set(hash,destination);
  physicalBytes += size;
}

async function sourceFor(profile) {
  const revision = profile.exporter_revision;
  if (revision === processing.defaults[profile.id].exporter_revision) {
    const directory = join(root,profile.id,`exporter-${revision}`);
    // A packaging-only default can reuse its immediately preceding, reviewed
    // simulator. A corrupt or incomplete directory must fail normal verification.
    const existing = await lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!existing) {
      const recipes = processing.recipes[profile.id];
      const index = recipes.findIndex(r => r.exporter_revision === revision);
      if (index > 0) {
        const previous = selectExporter(profileById(profile.id),recipes[index-1].exporter_revision);
        if (previous.glue_sha256 === profile.glue_sha256 && previous.wasm_sha256 === profile.wasm_sha256)
          return resolveEngine(previous,root);
      }
    }
  }
  return resolveEngine(profile,root);
}

await mkdir(dirname(output),{recursive:true});
await mkdir(output);
try {
  const profiles = [...ENGINE_PROFILES,...ENGINE_EXPORTERS.map(e=>selectExporter(profileById(e.engine_profile),e.revision))];
  for (const profile of profiles) {
    const engine = await sourceFor(profile);
    const parent = join(output,profile.id);
    const dir = profile.exporter_revision ? join(parent,`exporter-${profile.exporter_revision}`) : parent;
    await mkdir(dir);
    await stageFile(engine.glue,join(dir,'h1-film.js'),profile.glue_sha256);
    await stageFile(engine.wasm,join(dir,'h1-film.wasm'),profile.wasm_sha256);
    await writeFile(join(dir,'package.json'),'{"type":"commonjs"}\n',{flag:'wx'});
  }
  console.log(JSON.stringify({engines:profiles.length,unique_binaries:firstCopy.size,
    logical_binary_bytes:logicalBytes,staged_binary_bytes:physicalBytes}));
} catch (error) {
  await rm(output,{recursive:true,force:true});
  throw error;
}
