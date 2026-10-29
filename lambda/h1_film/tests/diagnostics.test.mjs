import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeDiagnostics } from '../runtime/export-diagnostics.mjs';
import { TABLES, decodeDiagnosticRow, openDiagnostics, openDiagnosticsUrl, pairShotVerdicts, verdictLabel,
  linkedPull, diagnosticClockRanges } from '../runtime/diagnostics-codec.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture({kind='client',rows={},flags=0}={}) {
  const client=kind==='client',head=client?152:88,section=Buffer.alloc(head);
  section.write(client?'LDC1':'LDG1');section.writeUInt32LE(client?11:5,4);
  section.writeUInt32LE(head,8);section.writeUInt32LE(flags,12);
  section.writeUInt32LE(120,client?16:24);section.writeUInt32LE(TABLES[kind].length,client?20:28);
  section.writeFloatLE(0.125,client?32:72);section.writeUInt32LE(5,client?36:76);section.writeUInt32LE(1,client?40:80);
  if(client) {section.writeInt32LE(3,24);section.writeInt32LE(7,28);section.writeInt32LE(-1,44);}
  const data=[];
  TABLES[kind].forEach(([name,stride],i)=>{
    const b=rows[name]??Buffer.alloc(0);assert.equal(b.length%stride,0);
    section.writeUInt32LE(b.length/stride,(client?48:32)+8*i);section.writeUInt32LE(stride,(client?48:32)+8*i+4);data.push(b);
  });
  const body=Buffer.concat([section,...data]),film=Buffer.alloc(504+body.length);
  film.write('FLM1');film.writeUInt32LE(2,4);film.writeUInt32LE(9818,8);film.writeUInt32LE(120,12);film.writeUInt32LE(504,64);film.writeUInt32LE(3000,44);
  film.writeUInt32LE(504,client?496:480);film.writeUInt32LE(body.length,client?500:484);body.copy(film,504);
  return film;
}
function source(film){return {film_sha256:sha(film),raw_map_sha256:'a'.repeat(64),engine_profile:'h1-performance-beta5-p9818-wasm-v1',source_tick_rate:120,source_tick_count:3000};}

test('diagnostic sections round-trip byte-for-byte; range reads are bounded and retain all clocks',async()=>{
  const aim=Buffer.alloc(28*2050);
  for(let i=0;i<2050;i++){aim.writeInt32LE(5000+i,i*28);aim.writeInt32LE(i===2049?-1:100+i,i*28+4);aim.writeFloatLE(1.25,i*28+8);}
  const film=fixture({rows:{aim},flags:1<<5}),out=encodeDiagnostics(film,source(film)),calls=[];
  const reader=await openDiagnostics(async(start,size)=>{calls.push(size);return out.bytes.subarray(start,start+size);},out.descriptor,source(film));
  const section=reader.manifest.sections[0];
  assert.deepEqual(out.bytes.subarray(out.bytes.length-section.size_bytes),film.subarray(504));
  assert.equal(section.tables.find(t=>t.name==='aim').capped,true);
  assert.equal(reader.chunks('client','aim','view_host_tick',2148,2148).length,1);
  const rows=await reader.readChunk('client','aim',1);
  assert.equal(rows[0].index,2048);assert.equal(rows[0].client_tick,7048);assert.equal(rows[0].view_host_tick,2148);
  assert.equal(rows[1].view_host_tick,-1);assert.deepEqual(rows[0].eye,[1.25,0,0]);
  assert.equal(calls.at(-1),56);assert.equal(calls.length,3);
  await assert.rejects(openDiagnostics(async(s,n)=>out.bytes.subarray(s,s+n),out.descriptor,{film_sha256:'b'.repeat(64)}),/source mismatch/);
  const bad=Buffer.from(out.bytes);bad[bad.length-1]^=1;
  const corrupt=await openDiagnostics(async(s,n)=>bad.subarray(s,s+n),out.descriptor);
  await assert.rejects(corrupt.readChunk('client','aim',1),/digest/);
  await assert.rejects(openDiagnostics(async(s,n)=>out.bytes.subarray(s,s+n),{...out.descriptor,manifest_sha256:'f'.repeat(64)}),/digest/);
});
test('malformed sections, unknown versions, client-world films and invalid poses fail closed',()=>{
  for(const mutate of [b=>b.writeUInt32LE(64,28),b=>b.writeUInt32LE(12,508),b=>b.writeUInt32LE(0xffffffff,552),
    b=>b.writeUInt32LE(87,556),b=>b.writeUInt32LE(505,496),b=>b.writeUInt32LE(b.length,500)]) {
    const film=fixture();mutate(film);assert.throws(()=>encodeDiagnostics(film,source(film)),/diagnostics/);
  }
  const pose=Buffer.alloc(264);pose[4]=21;
  const film=fixture({rows:{poses:pose}});assert.throws(()=>encodeDiagnostics(film,source(film)),/pose/);
});
test('quantized client skeleton, hit geometry and nonfinite values keep their distinct meanings',()=>{
  const b=Buffer.alloc(264);b.writeUInt32LE(0xdeadbeef,0);b[4]=1;b[5]=0;b[6]=3;
  b.writeFloatLE(4,8);b.writeFloatLE(1,20);b.writeInt16LE(-4096,24);
  const q=16383n|(16383n<<15n)|(16383n<<30n)|(3n<<45n);
  for(let i=0;i<3;i++) b.writeUInt16LE(Number((q>>BigInt(i*16))&65535n),30+2*i);
  const p=decodeDiagnosticRow('client','poses',b,7);
  assert.equal(p.object_tag,0xdeadbeef);assert.equal(p.flags,3);assert.deepEqual(p.nodes[0].position,[3.5,0,0]);
  assert.deepEqual(p.nodes[0].rotation,[0,0,0,1]);
  const shot=Buffer.alloc(88);shot.writeFloatLE(NaN,24);shot.writeInt32LE(-1,4);
  assert.equal(decodeDiagnosticRow('client','shots',shot,0).origin[0],null);
});
test('verdicts pair only by protocol identity; duplicate, absent and never-sent reports stay explicit',()=>{
  const shots=[{index:0,sent_client_tick:100,report_index:4,flags:0},{index:1,sent_client_tick:100,flags:1,epoch:3,sequence:4},
    {index:2,sent_client_tick:-1,flags:0}];
  const v=[{...shots[0],index:7,machine_slot:3},{...shots[1],index:8,machine_slot:3}];
  assert.deepEqual(pairShotVerdicts(shots,v,3).map(x=>[x.status,x.verdict_index]),[['paired',7],['paired',8],['not_sent',null]]);
  assert.equal(pairShotVerdicts(shots,[...v,v[0]],3)[0].status,'ambiguous');
  assert.equal(pairShotVerdicts([...shots,shots[0]],v,3)[0].status,'ambiguous');
  assert.equal(pairShotVerdicts(shots,v,2)[0].status,'no_verdict');
  assert.equal(pairShotVerdicts(shots,v,-1)[0].status,'unknown_identity');
  assert.equal(verdictLabel({verdict:0,tested_host_tick:-1,shot_flags:2}),'not_tested');
  assert.equal(verdictLabel({verdict:0,tested_host_tick:50,shot_flags:4}),'head_as_body');
  assert.equal(verdictLabel({verdict:1,tested_host_tick:-1,shot_flags:0}),'refused');
  assert.equal(verdictLabel(null),'no_verdict');assert.equal(verdictLabel(v[0],99),'unknown');
});
test('pull links respect low-word wrap and input windows span the full host interval',()=>{
  const pulls=[{index:65535,client_tick:4},{index:65536,client_tick:5},{index:65537,client_tick:6}];
  assert.equal(linkedPull({client_tick:6,pull_low16:0},pulls),65536);
  assert.equal(linkedPull({client_tick:4,pull_low16:0},pulls),null);
  assert.equal(linkedPull({client_tick:6,pull_low16:0,flags:0},pulls,true),null);
  assert.deepEqual(diagnosticClockRanges([{host_tick:90,span:7}]),{host_tick:[90,96]});
  assert.deepEqual(diagnosticClockRanges([{client_tick:90,client_end_tick:85}]),{client_tick:[85,90]});
});
test('host ledger evidence has separate provenance and unknown client coverage',async()=>{
  const d=Buffer.alloc(28);d.writeUInt32LE(99,0);d[5]=4;d[6]=255;d.writeFloatLE(0.5,20);
  const film=fixture({kind:'ledger',rows:{damage:d}}),out=encodeDiagnostics(film,source(film));
  const reader=await openDiagnostics(async(s,n)=>out.bytes.subarray(s,s+n),out.descriptor);
  assert.equal(reader.manifest.recording_kind,'host');assert.equal(reader.chunks('client','shots').length,0);
  const [row]=await reader.readChunk('ledger','damage',0);assert.equal(row.host_tick,99);assert.equal(row.attacker,255);assert.equal(row.shield,0.5);
});
test('HTTP reader rejects full-file fallback, malformed ranges, oversize bodies and cancellation',async()=>{
  const film=fixture(),out=encodeDiagnostics(film,source(film));
  const descriptor={...out.descriptor,url:'https://example.com/diagnostics'};
  const fetchImpl=async(_url,{headers})=>{
    const [,a,b]=headers.Range.match(/bytes=(\d+)-(\d+)/),start=Number(a),end=Number(b);
    return new Response(out.bytes.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${out.bytes.length}`}});
  };
  const reader=await openDiagnosticsUrl(descriptor,{fetchImpl});assert.equal(reader.manifest.sections.length,1);
  await assert.rejects(openDiagnosticsUrl(descriptor,{fetchImpl:async()=>new Response(out.bytes)}),/bounded range/);
  await assert.rejects(openDiagnosticsUrl(descriptor,{fetchImpl:async()=>new Response(Buffer.alloc(33),{status:206,headers:{'content-range':`bytes 0-31/${out.bytes.length}`}})}),/oversized/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(openDiagnosticsUrl(descriptor,{fetchImpl,signal:controller.signal}),{name:'AbortError'});
});
