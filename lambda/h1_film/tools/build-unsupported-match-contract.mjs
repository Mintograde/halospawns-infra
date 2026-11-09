// Add an explicit unsimulated-client reason without changing retained contracts.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const roots=process.argv.slice(2);if(!roots.length)throw Error('Pass contract directories');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read=async n=>JSON.parse(await readFile(join(roots[0],n),'utf8'));
const projection=await read('frontend-default.v9.projection.json');
projection.profile_revision=10;projection.generated_fields.artifact.profile_revision=10;
projection.match_views.encoding='halospawns.h1MatchReplay.v5';
projection.match_views.failed_client_world='unavailable_with_completed_desync_or_clean_roster_evidence_or_structurally_valid_unsupported_build';
const projectionHash=hash(projection),schema=await read('halospawns.viewerReplay.v1.frontend-default.v9.schema.json');
schema.$id=schema.$id.replace('v9.schema','v10.schema');schema.title=schema.title.replace('Revision 9','Revision 10');
schema.description='Verified host and supported client worlds. Structurally valid clients recorded by another engine build retain their source identity and evidence without simulation or a playable world.';
schema.$defs.artifact.properties.profile_revision.const=10;schema.$defs.artifact.properties.projection_sha256.const=projectionHash;
const manifest=await read('halospawns.h1MatchReplay.v4.manifest.schema.json');
manifest.$id=manifest.properties.schema.const='halospawns.h1MatchReplay.v5';
manifest.$defs.sourceContract.properties.profile_revision.const=10;manifest.$defs.sourceContract.properties.projection_sha256.const=projectionHash;
manifest.properties.tracks.items.properties.failure.oneOf.push({type:'object',additionalProperties:false,
  required:['reason','recorded_build','format','protocol_revision','tick_rate'],properties:{
    reason:{const:'unsupported_build'},recorded_build:{type:'string',minLength:1,maxLength:63,pattern:'^[\\x20-\\x7e]+$'},
    format:{const:3},protocol_revision:{const:9839},tick_rate:{const:120}}});
const encoding=await read('h1-match-replay.v4.encoding.json');
encoding.format='halospawns.h1MatchReplay.v5';encoding.container.magic_ascii='H1MV0005';encoding.container.version=5;
encoding.client_failure='Retain previous completed desync and roster mismatch reasons. Also omit an embedded client world when its structurally validated restored recording has a build incompatible with the selected host engine; retain exact build and numeric identity without a simulation claim. Host verification remains mandatory. Corrupt sources, unsupported layouts, crashes, timeouts and other errors still fail.';
const manifestHash=hash(manifest),encodingHash=hash(encoding);
for(const root of roots){
  for(const [name,v]of Object.entries({'frontend-default.v10.projection.json':projection,'halospawns.viewerReplay.v1.frontend-default.v10.schema.json':schema,
    'halospawns.h1MatchReplay.v5.manifest.schema.json':manifest,'h1-match-replay.v5.encoding.json':encoding}))
    await writeFile(join(root,name),JSON.stringify(v,null,2)+'\n');
  const registry=JSON.parse(await readFile(join(root,'supported-contracts.json'),'utf8'));
  registry.supported_contracts=registry.supported_contracts.filter(e=>e.profile_revision!==10);
  registry.supported_contracts.push({schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:10,projection_sha256:projectionHash,schema_file:'halospawns.viewerReplay.v1.frontend-default.v10.schema.json',projection_file:'frontend-default.v10.projection.json',manifest_schema_sha256:manifestHash,status:'supported'});
  registry.supported_encodings=registry.supported_encodings.filter(e=>e.format!==encoding.format);
  registry.supported_encodings.push({artifact_kind:encoding.artifact_kind,format:encoding.format,container_version:5,manifest_schema_file:'halospawns.h1MatchReplay.v5.manifest.schema.json',manifest_schema_sha256:manifestHash,encoding_file:'h1-match-replay.v5.encoding.json',encoding_sha256:encodingHash,media_type:encoding.media_type,outer_compression:'identity',status:'supported'});
  await writeFile(join(root,'supported-contracts.json'),JSON.stringify(registry,null,2)+'\n');
}
console.log(JSON.stringify({projection_sha256:projectionHash,manifest_schema_sha256:manifestHash,encoding_sha256:encodingHash}));
