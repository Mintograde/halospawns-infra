import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const roots=process.argv.slice(2);if(!roots.length)throw Error('Pass contract directories');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read=async n=>JSON.parse(await readFile(join(roots[0],n),'utf8'));
const projection=await read('frontend-default.v7.projection.json');
projection.profile_revision=8;projection.generated_fields.artifact.profile_revision=8;
projection.match_views.encoding='halospawns.h1MatchReplay.v3';
projection.match_views.storage='lossless_original_records_with_bounded_virtual_tables';
const projectionHash=hash(projection),schema=await read('halospawns.viewerReplay.v1.frontend-default.v7.schema.json');
schema.$id=schema.$id.replace('v7.schema','v8.schema');schema.title=schema.title.replace('Revision 7','Revision 8');
schema.$defs.artifact.properties.profile_revision.const=8;schema.$defs.artifact.properties.projection_sha256.const=projectionHash;
const manifest=await read('halospawns.h1MatchReplay.v2.manifest.schema.json');
manifest.$id=manifest.properties.schema.const='halospawns.h1MatchReplay.v3';
manifest.$defs.sourceContract.properties.profile_revision.const=8;manifest.$defs.sourceContract.properties.projection_sha256.const=projectionHash;
const int=(min=0,max=536870912)=>({type:'integer',minimum:min,maximum:max}),id={type:'string',pattern:'^[a-z0-9][a-z0-9/_-]{0,120}$'},sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const object=p=>({type:'object',additionalProperties:false,required:Object.keys(p),properties:p});
const block=object({logical_offset:int(),offset:int(),size_bytes:int(1),decoded_size_bytes:int(1),codec:{enum:['identity','zstd']},sha256:sha});
const network=object({offset:int(),size_bytes:int(1,16777216),source_offset:int(),source_size_bytes:int(1),count:int(1,2097152),flags:int(0,3),sha256:sha});
const storage={oneOf:[object({kind:{const:'stored'},blocks:{type:'array',minItems:1,maxItems:2048,items:block}}),
  object({kind:{const:'network'},source:id,blocks:{type:'array',minItems:1,maxItems:432000,items:network}}),
  object({kind:{enum:['pad','account','ledger']},source:id,field:{type:'string',pattern:'^[a-z_]{1,32}$'}})]};
manifest.properties.entries.items.required.push('storage');manifest.properties.entries.items.properties.storage=storage;
manifest.required.push('logical_size_bytes');manifest.properties.logical_size_bytes=int(1);
const encoding=await read('h1-match-replay.v2.encoding.json');
encoding.format='halospawns.h1MatchReplay.v3';encoding.container.magic_ascii='H1MV0003';encoding.container.version=3;
encoding.body='Entry offsets/sizes address logical bytes. Storage blocks address physical bytes relative to the manifest end. Derived entries reconstruct exact original bytes from same-track stored sources. World chunks remain identity ranges.';
encoding.storage={block_bytes:262144,codec:'zstd',cache_bytes:33554432,source_bytes:134217728,network_block_bytes:16777216,
  derived:['network','pad','account','ledger'],dependency_depth:1,validation:'All original entry hashes and physical block hashes are retained; table and network range hashes bind decoded bytes.'};
const manifestHash=hash(manifest),encodingHash=hash(encoding);
for(const root of roots){
  const files={'frontend-default.v8.projection.json':projection,'halospawns.viewerReplay.v1.frontend-default.v8.schema.json':schema,
    'halospawns.h1MatchReplay.v3.manifest.schema.json':manifest,'h1-match-replay.v3.encoding.json':encoding};
  for(const [name,v]of Object.entries(files))await writeFile(join(root,name),JSON.stringify(v,null,2)+'\n');
  const registry=JSON.parse(await readFile(join(root,'supported-contracts.json'),'utf8'));
  registry.supported_contracts=registry.supported_contracts.filter(e=>e.profile_revision!==8);
  registry.supported_contracts.push({schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:8,projection_sha256:projectionHash,schema_file:'halospawns.viewerReplay.v1.frontend-default.v8.schema.json',projection_file:'frontend-default.v8.projection.json',manifest_schema_sha256:manifestHash,status:'supported'});
  registry.supported_encodings=registry.supported_encodings.filter(e=>e.format!==encoding.format);
  registry.supported_encodings.push({artifact_kind:encoding.artifact_kind,format:encoding.format,container_version:3,manifest_schema_file:'halospawns.h1MatchReplay.v3.manifest.schema.json',manifest_schema_sha256:manifestHash,encoding_file:'h1-match-replay.v3.encoding.json',encoding_sha256:encodingHash,media_type:encoding.media_type,outer_compression:'identity',status:'supported'});
  await writeFile(join(root,'supported-contracts.json'),JSON.stringify(registry,null,2)+'\n');
}
console.log(JSON.stringify({projection_sha256:projectionHash,manifest_schema_sha256:manifestHash,encoding_sha256:encodingHash}));
