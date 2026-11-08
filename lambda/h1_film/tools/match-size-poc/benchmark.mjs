import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compactMatch,openCompactMatch,sha} from './compact.mjs';

const [sourcePath,outputPath,reportPath=outputPath+'.json',mode='write']=process.argv.slice(2);
if(!outputPath)throw Error('Usage: node benchmark.mjs SOURCE.hsrv OUTPUT.h1mc');
assert.ok(['write','verify-existing'].includes(mode));
const source=await readFile(resolve(sourcePath)),start=performance.now(),packed=await compactMatch(source),packedAt=performance.now();
await mkdir(resolve(outputPath,'..'),{recursive:true});
if(mode==='write')await writeFile(outputPath,packed,{flag:'wx'});
else assert.ok((await readFile(outputPath)).equals(packed),'retained candidate differs');
let fetched=0,requests=0;
const opened=await openCompactMatch(async(at,n)=>{fetched+=n;requests++;return packed.subarray(at,at+n);});
const digest=createHash('sha256').update(opened.prefix);
for(const e of opened.manifest.entries)digest.update(await opened.readEntry(e.id));
assert.equal(digest.digest('hex'),sha(source));
const verifiedAt=performance.now(),seeks=[];
for(const e of [...opened.manifest.entries].reverse()) {
  opened.clearCache();const start=performance.now(),before=fetched,calls=requests;
  const at=Math.floor(e.size_bytes/2),n=Math.min(e.size_bytes-at,4096);
  const bytes=await opened.readEntryRange(e.id,at,n);
  const original=source.subarray(opened.prefix.length+e.offset+at,opened.prefix.length+e.offset+at+n);
  assert.ok(bytes.equals(original));
  seeks.push({kind:e.kind,ms:performance.now()-start,requested:n,fetched:fetched-before,calls:requests-calls});
}
const result={source:resolve(sourcePath),source_sha256:sha(source),output:resolve(outputPath),output_sha256:sha(packed),
  original_bytes:source.length,compact_bytes:packed.length,reduction:1-packed.length/source.length,
  pack_ms:packedAt-start,full_verify_ms:verifiedAt-packedAt,original_container_round_trip:'byte-identical',
  reverse_cold_range_checks:seeks.length,cache_limit_bytes:32*1024*1024,peak_rss_kib:process.resourceUsage().maxRSS,
  seeks:Object.fromEntries([...new Set(seeks.map(s=>s.kind))].map(kind=>{const a=seeks.filter(s=>s.kind===kind);return [kind,{count:a.length,max_ms:Math.max(...a.map(s=>s.ms)),max_fetched:Math.max(...a.map(s=>s.fetched))}];}))};
await writeFile(reportPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
