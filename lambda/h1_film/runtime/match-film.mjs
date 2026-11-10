// Bounded MTCH inspection. Recorded trust labels remain claims until playback verifies each world.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {fnv1a} from './format3-codec.mjs';

// Beta 6.1 blampc_film_bake.c::same_match treats zero as an absent ID. Keep
// this format-level rule shared by later engines; old frozen recipes stay strict.
export function matchFilmPolicy(exporterRevision) {
  return {allowMissingClientMatchId:Number.isInteger(exporterRevision)&&exporterRevision>=27};
}

export function recordedMatchIdsCompatible(a,b,{allowMissingClientMatchId=false}={}) {
  if(!/^[0-9a-f]{16}$/.test(a)||!/^[0-9a-f]{16}$/.test(b))return false;
  return a===b || (allowMissingClientMatchId&&(a==='0000000000000000'||b==='0000000000000000'));
}

export function inspectMatchFilm(bytes,policy={}) {
  assert.ok(bytes.length >= 504 && bytes.length <= 512*1024*1024, 'Invalid film size');
  const u = n => bytes.readUInt32LE(n);
  const range = (offset, size, end=bytes.length) => assert.ok(offset <= end && size <= end-offset, 'Section outside bounds');
  const envelope = (offset, size) => {
    range(offset,size);
    assert.ok(size >= 504, 'Truncated envelope');
    assert.equal(u(offset),0x314d4c46,'Invalid film magic');
    assert.equal(u(offset+4),3,'Expected format 3');
    return {format:u(offset+4),protocol_revision:u(offset+8),tick_rate:u(offset+12),
      flags:u(offset+28),first_update:u(offset+40),frame_count:u(offset+44),
      build:bytes.subarray(offset+384,offset+448).toString('utf8').split('\0')[0],
      map:bytes.subarray(offset+128,offset+256).toString('utf8').split('\0')[0],
      match_id:bytes.readBigUInt64LE(offset+488).toString(16).padStart(16,'0')};
  };
  const outer=envelope(0,bytes.length);
  if(u(64)===504) {
    assert.ok(!(outer.flags&64)&&outer.match_id!=='0000000000000000','Invalid authoritative host');
    return {schema:'halospawns.h1MatchFilmInspection.v1',playback_validated:false,
      sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length,
      version:0,outer,host:outer,host_offset:0,host_size:bytes.length,parts:[]};
  }
  assert.ok(bytes.length>=536,'Truncated match envelope');
  assert.equal(u(64),536,'Unsupported match header');
  assert.equal(u(504),0x4843544d,'Missing MTCH magic');
  const version=u(508),hostOffset=u(512),hostSize=u(516),table=u(520),count=u(524),stride=u(528);
  assert.ok(version===1 || version===2,'Unsupported match version');
  assert.equal(stride,version===1?96:112,'Invalid entry size');
  assert.equal(u(532),0,'Reserved match flags');
  assert.ok(count<=16,'Too many client parts');
  range(table,count*stride);
  assert.equal(table+count*stride,bytes.length,'Trailing match bytes');
  assert.equal(hostOffset,u(64),'Host does not follow header');
  range(hostOffset,hostSize,table);
  const host=envelope(hostOffset,hostSize),parts=[];
  assert.ok(!(host.flags&64)&&host.match_id!=='0000000000000000','Invalid authoritative host');
  assert.equal(u(hostOffset+64),504,'Nested match film');
  const expected=Buffer.from(bytes.subarray(hostOffset,hostOffset+504));
  for(const at of [48,68,72,76,84,92,104,112,448,456,480,496]) {
    const value=expected.readUInt32LE(at);if(value)expected.writeUInt32LE(value+hostOffset,at);
  }
  expected.writeUInt32LE(536,64);
  // KEEP belongs to the downloaded file, independently of the embedded host copy.
  expected.writeUInt32LE((expected.readUInt32LE(28)&~1)|(u(28)&1),28);
  assert.deepEqual(bytes.subarray(0,504),expected,'Outer envelope differs from the host');
  let end=hostOffset+hostSize;
  for(let i=0;i<count;i++) {
    const at=table+i*stride,offset=u(at+4),size=u(at+8),accountOffset=u(at+12),accountSize=u(at+16);
    assert.equal(offset,end,'Overlapping parts or unindexed bytes');
    range(offset,size,table);
    end=offset+size;
    if(accountSize) {
      range(accountOffset,accountSize,table);
      const inHost=accountOffset===hostOffset+u(hostOffset+496)&&accountSize===u(hostOffset+500);
      assert.ok(inHost||accountOffset===end,'Unbound client account');
      if(!inHost)end+=accountSize;
    }
    const rest=version===2?{whole_size:u(at+96),fnv1a:u(at+100),base_part:u(at+104),flags:u(at+108)}:{whole_size:size,fnv1a:0,base_part:0,flags:0};
    assert.ok(rest.whole_size>=size&&rest.whole_size<=512*1024*1024&&rest.flags<=1,'Invalid restored size or flags');
    assert.ok(u(at)<16&&u(at+20)<=2&&u(at+24)<=2&&u(at+28)<=1,'Invalid recorded client status');
    assert.ok(bytes.subarray(at+32,at+96).includes(0),'Unterminated client status');
    if(!accountSize)assert.equal(accountOffset,0,'Empty account offset');
    if(!(rest.flags&1)) {
      assert.equal(rest.whole_size,size,'Whole client size differs');
      if(rest.fnv1a)assert.equal(fnv1a(bytes.subarray(offset,offset+size)),rest.fnv1a,'Client film checksum differs');
    }
    const client=envelope(offset,size);
    assert.ok(client.flags&64,'Part is not a client world');
    assert.equal(u(offset+64),504,'Nested client match');
    for(const key of ['format','protocol_revision','tick_rate','map'])assert.equal(client[key],host[key],`Client ${key} differs`);
    assert.ok(recordedMatchIdsCompatible(client.match_id,host.match_id,policy),'Client match_id differs');
    assert.ok(client.frame_count>0&&client.frame_count<=432000,'Invalid client frame count');
    parts.push({index:i,player:u(at),offset,size,account_offset:accountOffset,account_size:accountSize,
      inputs_trust:u(at+20),messages_trust:u(at+24),flags:u(at+28),
      reason:bytes.subarray(at+32,at+96).toString('utf8').split('\0')[0],rest,
      envelope:client});
  }
  for(const part of parts) if(part.rest.flags&1) {
    const base=parts[part.rest.base_part];
    assert.ok(base && base!==part && !(base.rest.flags&1),'Invalid thin part base');
  }
  assert.equal(end,table,'Unindexed match bytes');
  return {schema:'halospawns.h1MatchFilmInspection.v1',playback_validated:false,
    sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length,
    version,outer,host,host_offset:hostOffset,host_size:hostSize,parts};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length,3,'Usage: node inspect-match-film.mjs FILM.h1film');
  console.log(JSON.stringify(inspectMatchFilm(await readFile(process.argv[2])),null,2));
}
