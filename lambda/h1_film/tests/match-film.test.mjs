import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectMatchFilm,matchFilmPolicy,recordedMatchIdsCompatible} from '../runtime/match-film.mjs';
import {fnv1a} from '../runtime/format3-codec.mjs';
import {recordedGameplaySources} from '../runtime/gameplay-source.mjs';

const zero='0000000000000000',id='3454062d7bccf9cb',other='1234567890abcdef';
function fixture({version=2,protocol=9839,clientId=zero,hostId=id,early=true}={}) {
  const stride=version===1?96:112,host=536,client=host+504,table=client+504;
  const b=Buffer.alloc(table+stride);
  function envelope(at,clientView,matchId) {
    b.writeUInt32LE(0x314d4c46,at);b.writeUInt32LE(3,at+4);
    b.writeUInt32LE(protocol,at+8);b.writeUInt32LE(120,at+12);
    b.writeUInt32LE(clientView?64:8,at+28);b.writeUInt32LE(clientView&&early?4:5,at+44);
    b.writeUInt32LE(504,at+64);b.write('worthy',at+128);
    b.writeBigUInt64LE(BigInt('0x'+matchId),at+488);
  }
  envelope(host,false,hostId);envelope(client,true,clientId);
  b.copy(b,0,host,host+504);b.writeUInt32LE(536,64);
  [0x4843544d,version,host,504,table,1,stride,0].forEach((v,i)=>b.writeUInt32LE(v,504+i*4));
  [3,client,504,0,0,0,1,Number(early)].forEach((v,i)=>b.writeUInt32LE(v,table+i*4));
  b.write('recorded partial client',table+32);
  if(version===2){b.writeUInt32LE(504,table+96);b.writeUInt32LE(fnv1a(b.subarray(client,table)),table+100);}
  return b;
}

test('recorded match comparison follows upstream absent-ID semantics only for new recipes',()=>{
  for(const revision of [27,28,1000])for(const [a,b,expected] of [
    [id,id,true],[zero,id,true],[id,zero,true],[zero,zero,true],[id,other,false],['',id,false],['0',id,false],
  ])assert.equal(recordedMatchIdsCompatible(a,b,matchFilmPolicy(revision)),expected);
  for(const revision of [undefined,14,24,25,26]) {
    assert.equal(recordedMatchIdsCompatible(zero,id,matchFilmPolicy(revision)),false);
    assert.equal(recordedMatchIdsCompatible(id,id,matchFilmPolicy(revision)),true);
  }
});

for(const version of [1,2])for(const protocol of [9839,9844,9999])for(const early of [false,true])
test(`format-3 MTCH ${version}, protocol ${protocol}, early=${early}: absent client IDs preserve source bytes`,()=>{
  const bytes=fixture({version,protocol,early}),original=Buffer.from(bytes);
  const match=inspectMatchFilm(bytes,matchFilmPolicy(27));
  assert.equal(match.host.match_id,id);assert.equal(match.parts[0].envelope.match_id,zero);
  assert.equal(match.parts[0].flags,Number(early));assert.deepEqual(bytes,original);
  assert.deepEqual(recordedGameplaySources(bytes,27),{ledger:null,accounts:[]});
  assert.throws(()=>recordedGameplaySources(bytes,26),/Client match_id differs/);
  assert.throws(()=>inspectMatchFilm(bytes,matchFilmPolicy(26)),/Client match_id differs/);
  assert.throws(()=>inspectMatchFilm(fixture({version,protocol,clientId:other}),matchFilmPolicy(27)),/Client match_id differs/);
  assert.throws(()=>inspectMatchFilm(fixture({version,protocol,hostId:zero}),matchFilmPolicy(27)),/Invalid authoritative host/);
  const identified=fixture({version,protocol,clientId:id,early});
  assert.deepEqual(inspectMatchFilm(identified,matchFilmPolicy(27)),inspectMatchFilm(identified,matchFilmPolicy(26)));
});

test('absent match ID does not relax client checksums or other container identity fields',()=>{
  for(const [offset,value,error] of [[0,0,/Invalid film magic/],[8,9844,/protocol_revision differs/],
    [12,30,/tick_rate differs/],[28,0,/Part is not a client world/],[64,536,/Nested client match/]]) {
    const bytes=fixture({version:1}),client=1040;bytes.writeUInt32LE(value,client+offset);
    assert.throws(()=>inspectMatchFilm(bytes,matchFilmPolicy(27)),error);
  }
  const bytes=fixture();bytes[1040+400]^=1;
  assert.throws(()=>inspectMatchFilm(bytes,matchFilmPolicy(27)),/Client film checksum differs/);
});
