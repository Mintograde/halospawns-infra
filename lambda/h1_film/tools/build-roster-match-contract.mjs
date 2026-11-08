// New semantic contract; all retained projection and manifest hashes stay frozen.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const roots=process.argv.slice(2);if(!roots.length)throw Error('Pass contract directories');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read=async n=>JSON.parse(await readFile(join(roots[0],n),'utf8'));
const projection=await read('frontend-default.v8.projection.json');
projection.profile_revision=9;projection.generated_fields.artifact.profile_revision=9;
projection.match_views.encoding='halospawns.h1MatchReplay.v4';
projection.match_views.failed_client_world='unavailable_with_completed_desync_or_clean_initial_roster_mismatch_evidence';
const projectionHash=hash(projection),schema=await read('halospawns.viewerReplay.v1.frontend-default.v8.schema.json');
schema.$id=schema.$id.replace('v8.schema','v9.schema');schema.title=schema.title.replace('Revision 8','Revision 9');
schema.description='Verified host and client worlds; completed desyncs and verified initial-roster mismatches retain recorded evidence without a playable client world.';
schema.$defs.artifact.properties.profile_revision.const=9;schema.$defs.artifact.properties.projection_sha256.const=projectionHash;
const manifest=await read('halospawns.h1MatchReplay.v3.manifest.schema.json');
manifest.$id=manifest.properties.schema.const='halospawns.h1MatchReplay.v4';
manifest.$defs.sourceContract.properties.profile_revision.const=9;manifest.$defs.sourceContract.properties.projection_sha256.const=projectionHash;
const track=manifest.properties.tracks.items,oldFailure=track.properties.failure;
const roster=structuredClone(oldFailure);delete roster.anyOf;
roster.required=roster.required.filter(k=>k!=='first_mismatch_update').concat('recorded_player_count','exported_player_indices');
delete roster.properties.first_mismatch_update;
roster.properties.reason={const:'roster_mismatch'};
for(const key of ['seed_mismatches','hash_mismatches','network_refused'])roster.properties[key]={const:0};
roster.properties.recorded_player_count={type:'integer',minimum:1,maximum:16};
roster.properties.exported_player_indices={type:'array',minItems:1,maxItems:16,uniqueItems:true,items:{type:'integer',minimum:0,maximum:15}};
track.properties.failure={oneOf:[oldFailure,roster]};
const encoding=await read('h1-match-replay.v3.encoding.json');
encoding.format='halospawns.h1MatchReplay.v4';encoding.container.magic_ascii='H1MV0004';encoding.container.version=4;
encoding.client_failure='Only completed source-bound desyncs, or exact bounded initial-roster rejections followed by full clean verification, omit a client world. Never repair, drop or renumber players. Host verification remains mandatory; timeouts, crashes, corrupt sources and other errors fail.';
const manifestHash=hash(manifest),encodingHash=hash(encoding);
for(const root of roots){
  const files={'frontend-default.v9.projection.json':projection,'halospawns.viewerReplay.v1.frontend-default.v9.schema.json':schema,
    'halospawns.h1MatchReplay.v4.manifest.schema.json':manifest,'h1-match-replay.v4.encoding.json':encoding};
  for(const [name,v]of Object.entries(files))await writeFile(join(root,name),JSON.stringify(v,null,2)+'\n');
  const registry=JSON.parse(await readFile(join(root,'supported-contracts.json'),'utf8'));
  registry.supported_contracts=registry.supported_contracts.filter(e=>e.profile_revision!==9);
  registry.supported_contracts.push({schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:9,projection_sha256:projectionHash,schema_file:'halospawns.viewerReplay.v1.frontend-default.v9.schema.json',projection_file:'frontend-default.v9.projection.json',manifest_schema_sha256:manifestHash,status:'supported'});
  registry.supported_encodings=registry.supported_encodings.filter(e=>e.format!==encoding.format);
  registry.supported_encodings.push({artifact_kind:encoding.artifact_kind,format:encoding.format,container_version:4,manifest_schema_file:'halospawns.h1MatchReplay.v4.manifest.schema.json',manifest_schema_sha256:manifestHash,encoding_file:'h1-match-replay.v4.encoding.json',encoding_sha256:encodingHash,media_type:encoding.media_type,outer_compression:'identity',status:'supported'});
  await writeFile(join(root,'supported-contracts.json'),JSON.stringify(registry,null,2)+'\n');
}
console.log(JSON.stringify({projection_sha256:projectionHash,manifest_schema_sha256:manifestHash,encoding_sha256:encodingHash}));
