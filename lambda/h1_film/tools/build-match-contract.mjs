// Add the match-file encoding without changing any retained projection or encoding pin.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const roots=process.argv.slice(2);
if(!roots.length)throw new Error('Pass contract directories');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const read=async name=>JSON.parse(await readFile(join(roots[0],name),'utf8'));
const projection=await read('frontend-default.v5.projection.json');
projection.profile_revision=6;projection.generated_fields.artifact.profile_revision=6;
projection.match_views={authoritative_track:'host',world_profile_revision:5,encoding:'halospawns.h1MatchReplay.v1',
  client_world:'predicted',clock_alignment:'recorded-client-clock-v1',statistics:'authoritative_host_only'};
const projectionHash=hash(projection);
const schema=await read('halospawns.viewerReplay.v1.frontend-default.v5.schema.json');
schema.$id='https://contracts.halospawns.com/replays/halospawns.viewerReplay.v1.frontend-default.v6.schema.json';
schema.title='Halospawns Viewer Replay V1 - Frontend Default Revision 6';
schema.description='Authoritative logical replay with independently verified client worlds and recorded tables in one indexed match container.';
schema.$defs.artifact.properties.profile_revision.const=6;
schema.$defs.artifact.properties.projection_sha256.const=projectionHash;
const sha={type:'string',pattern:'^[a-f0-9]{64}$'},integer=(min,max)=>({type:'integer',minimum:min,maximum:max});
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,required,properties});
const source=object({schema:{const:'halospawns.viewerReplay.v1'},profile:{const:'frontend-default'},profile_revision:{const:6},
  projection_sha256:{const:projectionHash},tick_count:integer(1,432000)});
const entry=object({id:{type:'string',pattern:'^[a-z0-9][a-z0-9/_-]{0,120}$'},kind:{enum:['world','client-account','host-ledger','raw-pad','network-observations','diagnostic-table','recorded-section']},
  compression:{const:'identity'},offset:integer(0,536870912),size_bytes:integer(1,536870912),sha256:sha,
  index_size_bytes:integer(33,16777216),index_sha256:sha},['id','kind','compression','offset','size_bytes','sha256']);
const track=object({id:{type:'string',pattern:'^(host|client-[0-9]+)$'},role:{enum:['host','client']},source_film_sha256:sha,
  frame_count:integer(1,432000),first_update:integer(0,2147051647),viewer_revision:{const:5},world:{type:'string'},
  verification:object({played_ticks:integer(1,432000),seed_mismatches:{const:0},hash_mismatches:{const:0},hash_checks:integer(1,40000),control_pushes:integer(1,432000)}),
  recorded_own_player:integer(0,15),ends_early:{type:'boolean'},recorded_trust:object({inputs:integer(0,2),messages:integer(0,2),reason:{type:'string',maxLength:63}}),
  clocks:{type:'array',maxItems:432000,items:object({frame:integer(0,432000),game_tick:integer(0,2147051647)})},
  alignment:{type:'object'},account:{type:'object'},recorded_sections:{type:'object',additionalProperties:{type:'string'}},
  roster:{type:'object'},pad:{type:'object'},network:{type:'object'},tables:{type:'array',maxItems:18,items:{type:'object'}}},
  ['id','role','source_film_sha256','frame_count','first_update','viewer_revision','world','verification']);
const manifest={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'halospawns.h1MatchReplay.v1',
  ...object({schema:{const:'halospawns.h1MatchReplay.v1'},sourceContract:{$ref:'#/$defs/sourceContract'},source_film_sha256:sha,raw_map_sha256:sha,
    engine_profile:{const:'h1-performance-beta6-p9839-wasm-v1'},wasm_sha256:sha,glue_sha256:sha,match_id:{type:'string',pattern:'^[a-f0-9]{16}$'},
    tick_rate:{const:120},authoritative_track:{const:'host'},tracks:{type:'array',minItems:1,maxItems:17,items:track},
    entries:{type:'array',minItems:1,maxItems:512,items:entry}}),$defs:{sourceContract:source}};
const encoding={artifact_kind:'viewer_replay_delta',format:'halospawns.h1MatchReplay.v1',media_type:'application/vnd.halospawns.replay-delta',outer_compression:'identity',
  container:{magic_ascii:'H1MV0001',version:1,header_bytes:64,byte_order:'little',manifest_compression:'identity',
    fields:{version:8,header_bytes:12,manifest_bytes:16,total_bytes:20,reserved_zero:[24,28],manifest_sha256:[32,32]}},
  body:'Contiguous entries indexed by byte offset relative to the end of the manifest; every entry has a SHA-256 pin.',
  worlds:{profile_revision:5,format:'halospawns.viewerReplayDelta.v2',container_magic:'HSRDC002'},
  authority:'Only the host world supplies match statistics; client worlds retain their original clocks and recorded trust results.',
  limits:{file_bytes:536870912,manifest_bytes:8388608,tracks:17,entries:512,frames_per_track:432000}};
const manifestHash=hash(manifest),encodingHash=hash(encoding);
const files={'frontend-default.v6.projection.json':projection,'halospawns.viewerReplay.v1.frontend-default.v6.schema.json':schema,
  'halospawns.h1MatchReplay.v1.manifest.schema.json':manifest,'h1-match-replay.v1.encoding.json':encoding};
for(const root of roots) {
  for(const [name,value] of Object.entries(files))await writeFile(join(root,name),JSON.stringify(value,null,2)+'\n');
  const registry=JSON.parse(await readFile(join(root,'supported-contracts.json'),'utf8'));
  registry.supported_contracts=registry.supported_contracts.filter(e=>e.profile_revision!==6);
  registry.supported_contracts.push({schema:'halospawns.viewerReplay.v1',profile:'frontend-default',profile_revision:6,projection_sha256:projectionHash,
    schema_file:'halospawns.viewerReplay.v1.frontend-default.v6.schema.json',projection_file:'frontend-default.v6.projection.json',manifest_schema_sha256:manifestHash,status:'supported'});
  registry.supported_encodings=registry.supported_encodings.filter(e=>e.format!==encoding.format);
  registry.supported_encodings.push({artifact_kind:encoding.artifact_kind,format:encoding.format,container_version:1,
    manifest_schema_file:'halospawns.h1MatchReplay.v1.manifest.schema.json',manifest_schema_sha256:manifestHash,
    encoding_file:'h1-match-replay.v1.encoding.json',encoding_sha256:encodingHash,media_type:encoding.media_type,outer_compression:'identity',status:'supported'});
  await writeFile(join(root,'supported-contracts.json'),JSON.stringify(registry,null,2)+'\n');
}
console.log(JSON.stringify({projection_sha256:projectionHash,manifest_schema_sha256:manifestHash,encoding_sha256:encodingHash}));
