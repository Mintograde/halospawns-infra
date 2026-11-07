// Additive contract: every recorded client remains identified, but only verified
// worlds are playable. Never rewrite the retained revision-6/v1 contract.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const roots=process.argv.slice(2);
if(!roots.length)throw new Error('Pass contract directories');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read=async name=>JSON.parse(await readFile(join(roots[0],name),'utf8'));
const projection=await read('frontend-default.v6.projection.json');
projection.profile_revision=7;projection.generated_fields.artifact.profile_revision=7;
projection.match_views.encoding='halospawns.h1MatchReplay.v2';
projection.match_views.failed_client_world='unavailable_with_recorded_evidence';
const projectionHash=hash(projection);
const schema=await read('halospawns.viewerReplay.v1.frontend-default.v6.schema.json');
schema.$id=schema.$id.replace('v6.schema','v7.schema');schema.title=schema.title.replace('Revision 6','Revision 7');
schema.description='Verified authoritative replay and verified client worlds; desynchronized clients retain recorded evidence without a playable world.';
schema.$defs.artifact.properties.profile_revision.const=7;schema.$defs.artifact.properties.projection_sha256.const=projectionHash;
const manifest=await read('halospawns.h1MatchReplay.v1.manifest.schema.json');
manifest.$id=manifest.properties.schema.const='halospawns.h1MatchReplay.v2';
manifest.$defs.sourceContract.properties.profile_revision.const=7;
manifest.$defs.sourceContract.properties.projection_sha256.const=projectionHash;
const track=manifest.properties.tracks.items, integer=(min,max)=>({type:'integer',minimum:min,maximum:max});
track.required=track.required.filter(k=>!['viewer_revision','world','verification'].includes(k)).concat('status');
track.properties.status={enum:['available','unavailable']};
track.properties.verification.properties.control_pushes=integer(1,6912000);
const failure={reason:{const:'simulation_desync'},played_ticks:integer(1,432000),seed_mismatches:integer(0,432000),
  hash_mismatches:integer(0,40000),hash_checks:integer(1,40000),control_pushes:integer(1,6912000),
  first_mismatch_update:integer(0,2147483647),network_applied:integer(0,2147483647),network_refused:integer(0,2147483647)};
track.properties.failure={type:'object',additionalProperties:false,required:Object.keys(failure),properties:failure,
  anyOf:[{properties:{seed_mismatches:{minimum:1}}},{properties:{hash_mismatches:{minimum:1}}}]};
track.allOf=[{if:{properties:{status:{const:'available'}}},then:{required:['viewer_revision','world','verification'],not:{required:['failure']}},
  else:{required:['failure'],properties:{role:{const:'client'}},not:{anyOf:['viewer_revision','world','verification'].map(k=>({required:[k]}))}}}];
const encoding=await read('h1-match-replay.v1.encoding.json');
encoding.format='halospawns.h1MatchReplay.v2';encoding.container.magic_ascii='H1MV0002';encoding.container.version=2;
encoding.client_failure='Only completed source-bound desyncs omit a client world; track identity, failure evidence, recorded diagnostics and inputs remain. Host verification is mandatory.';
const manifestHash=hash(manifest),encodingHash=hash(encoding);
const files={'frontend-default.v7.projection.json':projection,'halospawns.viewerReplay.v1.frontend-default.v7.schema.json':schema,
  'halospawns.h1MatchReplay.v2.manifest.schema.json':manifest,'h1-match-replay.v2.encoding.json':encoding};
for(const root of roots) {
  for(const [name,value]of Object.entries(files))await writeFile(join(root,name),JSON.stringify(value,null,2)+'\n');
  const registry=JSON.parse(await readFile(join(root,'supported-contracts.json'),'utf8'));
  registry.supported_contracts=registry.supported_contracts.filter(e=>e.profile_revision!==7);
  registry.supported_contracts.push({schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:7,projection_sha256:projectionHash,
    schema_file:'halospawns.viewerReplay.v1.frontend-default.v7.schema.json',projection_file:'frontend-default.v7.projection.json',manifest_schema_sha256:manifestHash,status:'supported'});
  registry.supported_encodings=registry.supported_encodings.filter(e=>e.format!==encoding.format);
  registry.supported_encodings.push({artifact_kind:encoding.artifact_kind,format:encoding.format,container_version:2,
    manifest_schema_file:'halospawns.h1MatchReplay.v2.manifest.schema.json',manifest_schema_sha256:manifestHash,
    encoding_file:'h1-match-replay.v2.encoding.json',encoding_sha256:encodingHash,media_type:encoding.media_type,outer_compression:'identity',status:'supported'});
  await writeFile(join(root,'supported-contracts.json'),JSON.stringify(registry,null,2)+'\n');
}
console.log(JSON.stringify({projection_sha256:projectionHash,manifest_schema_sha256:manifestHash,encoding_sha256:encodingHash}));
