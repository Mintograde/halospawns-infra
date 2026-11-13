// Separate bounded logical address space from compact file size; retain old pins.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const roots=process.argv.slice(2);assert.ok(roots.length,'Pass contract directories');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read=async name=>JSON.parse(await readFile(join(roots[0],name),'utf8'));
const projection=await read('frontend-default.v11.projection.json');
projection.profile_revision=12;projection.generated_fields.artifact.profile_revision=12;
projection.match_views.encoding='halospawns.h1MatchReplay.v7';
const projectionHash=hash(projection),schema=await read('halospawns.viewerReplay.v1.frontend-default.v11.schema.json');
schema.$id=schema.$id.replace('v11.schema','v12.schema');schema.title=schema.title.replace('Revision 11','Revision 12');
schema.description='Beta 7 compact match replay with a 2 GiB logical address space and an unchanged 512 MiB physical file limit; original worlds, diagnostics and evidence remain exact.';
schema.$defs.artifact.properties.profile_revision.const=12;schema.$defs.artifact.properties.projection_sha256.const=projectionHash;
const manifest=await read('halospawns.h1MatchReplay.v6.manifest.schema.json');
manifest.$id=manifest.properties.schema.const='halospawns.h1MatchReplay.v7';
manifest.$defs.sourceContract.properties.profile_revision.const=12;
manifest.$defs.sourceContract.properties.projection_sha256.const=projectionHash;
manifest.properties.logical_size_bytes.maximum=2147483648;
manifest.properties.entries.items.properties.offset.maximum=2147483648;
const encoding=await read('h1-match-replay.v6.encoding.json');
encoding.format='halospawns.h1MatchReplay.v7';encoding.container.magic_ascii='H1MV0007';encoding.container.version=7;
encoding.limits.logical_bytes=2147483648;
const manifestHash=hash(manifest),encodingHash=hash(encoding);
for(const root of roots){
 for(const [name,value] of Object.entries({'frontend-default.v12.projection.json':projection,
   'halospawns.viewerReplay.v1.frontend-default.v12.schema.json':schema,
   'halospawns.h1MatchReplay.v7.manifest.schema.json':manifest,'h1-match-replay.v7.encoding.json':encoding}))
  await writeFile(join(root,name),JSON.stringify(value,null,2)+'\n');
 const registry=JSON.parse(await readFile(join(root,'supported-contracts.json'),'utf8'));
 registry.supported_contracts=registry.supported_contracts.filter(e=>e.profile_revision!==12);
 registry.supported_contracts.push({schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:12,
  projection_sha256:projectionHash,schema_file:'halospawns.viewerReplay.v1.frontend-default.v12.schema.json',
  projection_file:'frontend-default.v12.projection.json',manifest_schema_sha256:manifestHash,status:'supported'});
 registry.supported_encodings=registry.supported_encodings.filter(e=>e.format!==encoding.format);
 registry.supported_encodings.push({artifact_kind:encoding.artifact_kind,format:encoding.format,container_version:7,
  manifest_schema_file:'halospawns.h1MatchReplay.v7.manifest.schema.json',manifest_schema_sha256:manifestHash,
  encoding_file:'h1-match-replay.v7.encoding.json',encoding_sha256:encodingHash,media_type:encoding.media_type,outer_compression:'identity',status:'supported'});
 await writeFile(join(root,'supported-contracts.json'),JSON.stringify(registry,null,2)+'\n');
}
console.log(JSON.stringify({projection_sha256:projectionHash,manifest_schema_sha256:manifestHash,encoding_sha256:encodingHash}));
