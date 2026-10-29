import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { CHUNK_ROWS, DIAGNOSTICS_SCHEMA, DIAGNOSTICS_MEDIA_TYPE, HEADER_BYTES, MAX_BYTES,
  MAX_MANIFEST_BYTES, TABLES, decodeDiagnosticRow, diagnosticClockRanges,
  requireDiagnostic as check, readDiagnosticsHeader, validateDiagnosticsManifest } from './diagnostics-codec.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const matchId = (lo,hi) => hi.toString(16).padStart(8,'0')+lo.toString(16).padStart(8,'0');
const CAPS = { client:[65536,65536,65536,65536,65536,1<<19,1<<20,65536,65536,1<<17,65536,65536,1<<17],
  ledger:[65536,65536,65536,65536,65536] };

// Keep the exact section bytes, including reserved fields and quantized poses.
// The index is an accelerator; no rows are filtered, sorted or re-timed.
export function encodeDiagnostics(film, source) {
  check(film.length >= 504 && film.readUInt32LE(0) === 0x314d4c46 && film.readUInt32LE(64) === 504,
    'unsupported film envelope');
  check(film.readUInt32LE(8) === 9818 && !(film.readUInt32LE(28)&64), 'expected Beta 5 host world');
  check(film.readUInt32LE(4) === 2 && film.readUInt32LE(12) === 120
    && source.source_tick_count === film.readUInt32LE(44)
    && source.engine_profile === 'h1-performance-beta5-p9818-wasm-v1', 'source envelope mismatch');
  check(digest(film) === source.film_sha256, 'film hash mismatch');
  const match_id=matchId(film.readUInt32LE(488),film.readUInt32LE(492)),sections=[],blocks=[],spans=[];
  let offset=0;
  for(const [kind,at] of [['ledger',480],['client',496]]) {
    const start=film.readUInt32LE(at),size=film.readUInt32LE(at+4);
    if(!size) {check(start===0,'empty section offset');continue;}
    check(start>=504 && size<=MAX_BYTES && start+size<=film.length,'section outside film');
    for(const [a,b] of spans) check(start+size<=a || start>=b,'overlapping diagnostic sections');
    spans.push([start,start+size]);
    const block=film.subarray(start,start+size),client=kind==='client',head=client?152:88;
    check(size>=head && block.readUInt32LE(0)===(client?0x3143444c:0x3147444c)
      && block.readUInt32LE(4)===(client?11:5) && block.readUInt32LE(8)===head
      && block.readUInt32LE(client?20:28)===TABLES[kind].length,'unsupported section layout');
    if(!client) check(matchId(block.readUInt32LE(16),block.readUInt32LE(20))===match_id,'ledger match identity differs');
    const rulesAt=client?32:72, tolerance=block.readFloatLE(rulesAt);
    check(Number.isFinite(tolerance) && tolerance>=0,'invalid host rules');
    const section={kind,version:client?11:5,offset,size_bytes:size,header_bytes:head,sha256:digest(block),
      flags:block.readUInt32LE(12),clock_period:block.readUInt32LE(client?16:24),
      rules:{tolerance,head_steps:block.readUInt32LE(rulesAt+4),refusal_codes_version:block.readUInt32LE(rulesAt+8)},
      ...(client?{own_machine_slot:block.readInt32LE(24),own_player:block.readInt32LE(28),last_verdict_host_tick:block.readInt32LE(44)}:{}),tables:[]};
    let rowOffset=head;
    for(let i=0;i<TABLES[kind].length;i++) {
      const [name,stride]=TABLES[kind][i],count=block.readUInt32LE((client?48:32)+i*8);
      check(block.readUInt32LE((client?48:32)+i*8+4)===stride && count<=CAPS[kind][i]
        && rowOffset+count*stride<=size,'invalid table bounds');
      const table={name,count,stride,offset:offset+rowOffset,capped:Boolean(section.flags&(1<<i)),chunks:[]};
      for(let first=0;first<count;first+=CHUNK_ROWS) {
        const n=Math.min(CHUNK_ROWS,count-first),bytes=block.subarray(rowOffset+first*stride,rowOffset+(first+n)*stride),rows=[];
        for(let j=0;j<n;j++) rows.push(decodeDiagnosticRow(kind,name,bytes.subarray(j*stride,(j+1)*stride),first+j));
        table.chunks.push({first_row:first,row_count:n,offset:table.offset+first*stride,size_bytes:bytes.length,
          sha256:digest(bytes),clocks:diagnosticClockRanges(rows)});
      }
      section.tables.push(table);rowOffset+=count*stride;
    }
    check(rowOffset===size,'unexpected section trailing bytes');
    sections.push(section);blocks.push(block);offset+=size;
  }
  const manifest={schema:DIAGNOSTICS_SCHEMA,source,match_id,recording_kind:sections.some(s=>s.kind==='client')?'client-enriched-host':'host',sections};
  const raw=Buffer.from(JSON.stringify(manifest)),header=Buffer.alloc(HEADER_BYTES),total=HEADER_BYTES+raw.length+offset;
  check(raw.length<=MAX_MANIFEST_BYTES && total<=MAX_BYTES,'artifact exceeds limit');
  header.write('H1DG0001');header.writeUInt32LE(1,8);header.writeUInt32LE(HEADER_BYTES,12);
  header.writeUInt32LE(raw.length,16);header.writeUInt32LE(total,20);
  validateDiagnosticsManifest(manifest,readDiagnosticsHeader(header));
  const bytes=Buffer.concat([header,raw,...blocks]);
  return {bytes,manifest,descriptor:{schema:DIAGNOSTICS_SCHEMA,content_type:DIAGNOSTICS_MEDIA_TYPE,
    compression:'identity',size_bytes:total,sha256:digest(bytes),manifest_sha256:digest(raw),
    source_replay_sha256:source.film_sha256,raw_map_sha256:source.raw_map_sha256,
    engine_profile:source.engine_profile,source_tick_count:source.source_tick_count}};
}

export async function exportDiagnostics(filmPath,outputPath,source) {
  check((await stat(filmPath)).size<=512*1024*1024,'film too large');
  const result=encodeDiagnostics(await readFile(filmPath),source);
  await writeFile(outputPath,result.bytes,{flag:'wx'});
  return result.descriptor;
}
