// Add Beta 7's source identity without changing any retained encoding or pin.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const roots=process.argv.slice(2);if(!roots.length)throw Error('Pass contract directories');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read=async n=>JSON.parse(await readFile(join(roots[0],n),'utf8'));
const projection=await read('frontend-default.v10.projection.json');
projection.profile_revision=11;projection.generated_fields.artifact.profile_revision=11;
projection.match_views.encoding='halospawns.h1MatchReplay.v6';
const projectionHash=hash(projection),schema=await read('halospawns.viewerReplay.v1.frontend-default.v10.schema.json');
schema.$id=schema.$id.replace('v10.schema','v11.schema');schema.title=schema.title.replace('Revision 10','Revision 11');
schema.description='Beta 7 verified host and supported client worlds with exact recorded clocks, diagnostics and unavailable-client evidence.';
schema.$defs.artifact.properties.profile_revision.const=11;schema.$defs.artifact.properties.projection_sha256.const=projectionHash;
const manifest=await read('halospawns.h1MatchReplay.v5.manifest.schema.json');
manifest.$id=manifest.properties.schema.const='halospawns.h1MatchReplay.v6';
manifest.properties.engine_profile.const='h1-performance-beta7-p9844-wasm-v1';
manifest.$defs.sourceContract.properties.profile_revision.const=11;manifest.$defs.sourceContract.properties.projection_sha256.const=projectionHash;
manifest.properties.tracks.items.properties.failure.oneOf.find(f=>f.properties.reason.const==='unsupported_build').properties.protocol_revision.const=9844;
const encoding=await read('h1-match-replay.v5.encoding.json');
encoding.format='halospawns.h1MatchReplay.v6';encoding.container.magic_ascii='H1MV0006';encoding.container.version=6;
const manifestHash=hash(manifest),encodingHash=hash(encoding);
for(const root of roots){
  for(const [name,v]of Object.entries({'frontend-default.v11.projection.json':projection,'halospawns.viewerReplay.v1.frontend-default.v11.schema.json':schema,
    'halospawns.h1MatchReplay.v6.manifest.schema.json':manifest,'h1-match-replay.v6.encoding.json':encoding}))
    await writeFile(join(root,name),JSON.stringify(v,null,2)+'\n');
  const registry=JSON.parse(await readFile(join(root,'supported-contracts.json'),'utf8'));
  registry.supported_contracts=registry.supported_contracts.filter(e=>e.profile_revision!==11);
  registry.supported_contracts.push({schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:11,projection_sha256:projectionHash,schema_file:'halospawns.viewerReplay.v1.frontend-default.v11.schema.json',projection_file:'frontend-default.v11.projection.json',manifest_schema_sha256:manifestHash,status:'supported'});
  registry.supported_encodings=registry.supported_encodings.filter(e=>e.format!==encoding.format);
  registry.supported_encodings.push({artifact_kind:encoding.artifact_kind,format:encoding.format,container_version:6,manifest_schema_file:'halospawns.h1MatchReplay.v6.manifest.schema.json',manifest_schema_sha256:manifestHash,encoding_file:'h1-match-replay.v6.encoding.json',encoding_sha256:encodingHash,media_type:encoding.media_type,outer_compression:'identity',status:'supported'});
  await writeFile(join(root,'supported-contracts.json'),JSON.stringify(registry,null,2)+'\n');
}
console.log(JSON.stringify({projection_sha256:projectionHash,manifest_schema_sha256:manifestHash,encoding_sha256:encodingHash}));
