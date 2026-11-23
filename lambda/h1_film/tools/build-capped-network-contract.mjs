// Generate the match contract for a recorded, capped client network stream.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const roots=process.argv.slice(2);assert.ok(roots.length,'Pass contract directories');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read=async name=>JSON.parse(await readFile(join(roots[0],name),'utf8'));
const projection=await read('frontend-default.v14.projection.json');
projection.profile_revision=15;
projection.generated_fields.artifact.profile_revision=15;
projection.match_views.encoding='halospawns.h1MatchReplay.v10';
projection.match_views.failed_client_world += '_or_recorder_capped_network';
const projectionHash=hash(projection);
const schema=await read('halospawns.viewerReplay.v1.frontend-default.v14.schema.json');
schema.$id=schema.$id.replace('v14.schema','v15.schema');
schema.title=schema.title.replace('Revision 14','Revision 15');
schema.$defs.artifact.properties.profile_revision.const=15;
schema.$defs.artifact.properties.projection_sha256.const=projectionHash;
const manifest=await read('halospawns.h1MatchReplay.v9.manifest.schema.json');
manifest.$id=manifest.properties.schema.const='halospawns.h1MatchReplay.v10';
manifest.$defs.sourceContract.properties.profile_revision.const=15;
manifest.$defs.sourceContract.properties.projection_sha256.const=projectionHash;
manifest.properties.tracks.items.properties.failure.oneOf.push({
  type:'object',additionalProperties:false,required:['reason','flags','record_count','last_recorded_frame'],
  properties:{reason:{const:'capped_network'},flags:{const:1},
    record_count:{type:'integer',minimum:0,maximum:67108864},
    last_recorded_frame:{type:['integer','null'],minimum:0,maximum:2147483647}},
});
const encoding=await read('h1-match-replay.v9.encoding.json');
encoding.format=manifest.$id;
encoding.container.magic_ascii='H1MV0010';
encoding.container.version=10;
const manifestHash=hash(manifest),encodingHash=hash(encoding);
for(const root of roots){
 for(const [name,value] of Object.entries({'frontend-default.v15.projection.json':projection,
   'halospawns.viewerReplay.v1.frontend-default.v15.schema.json':schema,
   'halospawns.h1MatchReplay.v10.manifest.schema.json':manifest,'h1-match-replay.v10.encoding.json':encoding}))
  await writeFile(join(root,name),JSON.stringify(value,null,2)+'\n');
 const registry=JSON.parse(await readFile(join(root,'supported-contracts.json'),'utf8'));
 registry.supported_contracts=registry.supported_contracts.filter(e=>e.profile_revision!==15);
 registry.supported_contracts.push({schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:15,
  projection_sha256:projectionHash,schema_file:'halospawns.viewerReplay.v1.frontend-default.v15.schema.json',
  projection_file:'frontend-default.v15.projection.json',manifest_schema_sha256:manifestHash,status:'supported'});
 registry.supported_encodings=registry.supported_encodings.filter(e=>e.format!==encoding.format);
 registry.supported_encodings.push({artifact_kind:encoding.artifact_kind,format:encoding.format,container_version:10,
  manifest_schema_file:'halospawns.h1MatchReplay.v10.manifest.schema.json',manifest_schema_sha256:manifestHash,
  encoding_file:'h1-match-replay.v10.encoding.json',encoding_sha256:encodingHash,media_type:encoding.media_type,outer_compression:'identity',status:'supported'});
 await writeFile(join(root,'supported-contracts.json'),JSON.stringify(registry,null,2)+'\n');
}
console.log(JSON.stringify({projection_sha256:projectionHash,manifest_schema_sha256:manifestHash,encoding_sha256:encodingHash}));
