// Beta 8 keeps the lossless compact storage and binds protocol 9848 to its own source.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const roots=process.argv.slice(2);assert.ok(roots.length,'Pass contract directories');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read=async name=>JSON.parse(await readFile(join(roots[0],name),'utf8'));
const adapt=v=>JSON.parse(JSON.stringify(v).replaceAll('h1-performance-beta7-p9844-wasm-v1','h1-performance-beta8-p9848-wasm-v1').replaceAll('Beta 7','Beta 8').replaceAll('9844','9848'));
const projection=adapt(await read('frontend-default.v12.projection.json'));
projection.profile_revision=13;projection.generated_fields.artifact.profile_revision=13;
projection.match_views.encoding='halospawns.h1MatchReplay.v8';
const projectionHash=hash(projection),schema=adapt(await read('halospawns.viewerReplay.v1.frontend-default.v12.schema.json'));
schema.$id=schema.$id.replace('v12.schema','v13.schema');schema.title=schema.title.replace('Revision 12','Revision 13');
schema.$defs.artifact.properties.profile_revision.const=13;schema.$defs.artifact.properties.projection_sha256.const=projectionHash;
const manifest=adapt(await read('halospawns.h1MatchReplay.v7.manifest.schema.json'));
manifest.$id=manifest.properties.schema.const='halospawns.h1MatchReplay.v8';
manifest.$defs.sourceContract.properties.profile_revision.const=13;
manifest.$defs.sourceContract.properties.projection_sha256.const=projectionHash;
const encoding=adapt(await read('h1-match-replay.v7.encoding.json'));
encoding.format='halospawns.h1MatchReplay.v8';encoding.container.magic_ascii='H1MV0008';encoding.container.version=8;
const manifestHash=hash(manifest),encodingHash=hash(encoding);
for(const root of roots){
 for(const [name,value] of Object.entries({'frontend-default.v13.projection.json':projection,
   'halospawns.viewerReplay.v1.frontend-default.v13.schema.json':schema,
   'halospawns.h1MatchReplay.v8.manifest.schema.json':manifest,'h1-match-replay.v8.encoding.json':encoding}))
  await writeFile(join(root,name),JSON.stringify(value,null,2)+'\n');
 const registry=JSON.parse(await readFile(join(root,'supported-contracts.json'),'utf8'));
 registry.supported_contracts=registry.supported_contracts.filter(e=>e.profile_revision!==13);
 registry.supported_contracts.push({schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:13,
  projection_sha256:projectionHash,schema_file:'halospawns.viewerReplay.v1.frontend-default.v13.schema.json',
  projection_file:'frontend-default.v13.projection.json',manifest_schema_sha256:manifestHash,status:'supported'});
 registry.supported_encodings=registry.supported_encodings.filter(e=>e.format!==encoding.format);
 registry.supported_encodings.push({artifact_kind:encoding.artifact_kind,format:encoding.format,container_version:8,
  manifest_schema_file:'halospawns.h1MatchReplay.v8.manifest.schema.json',manifest_schema_sha256:manifestHash,
  encoding_file:'h1-match-replay.v8.encoding.json',encoding_sha256:encodingHash,media_type:encoding.media_type,outer_compression:'identity',status:'supported'});
 await writeFile(join(root,'supported-contracts.json'),JSON.stringify(registry,null,2)+'\n');
}
console.log(JSON.stringify({projection_sha256:projectionHash,manifest_schema_sha256:manifestHash,encoding_sha256:encodingHash}));
