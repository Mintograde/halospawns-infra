// Additive source audit; does not alter simulation products or frozen recipes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readEnvelope} from './film.mjs';
import {unpackMszip} from './adapters/beta5-v2-120.mjs';
import {unpackNetworkColumns} from './format3-codec.mjs';

export function stableNetworkRoster(bytes, start, end) {
  if (!bytes.length) return true;
  assert.ok(bytes.length >= 32 && bytes.readUInt32LE(0) === 0x54454e46);
  const version = bytes.readUInt32LE(4);
  assert.ok(version === 1 || version === 2);
  assert.equal(bytes.readUInt32LE(20), 0);
  let cursor = 32, seen = 0, stable = true;
  for (let block = 0; block < bytes.readUInt32LE(24); block++) {
    assert.ok(cursor + 24 <= bytes.length);
    const rawSize=bytes.readUInt32LE(cursor), packedSize=bytes.readUInt32LE(cursor+4);
    const records=bytes.readUInt32LE(cursor+16), flags=bytes.readUInt32LE(cursor+20);
    assert.ok(rawSize > 0 && rawSize <= 16*1024*1024 && flags <= (version===2?3:1));
    cursor += 24;
    assert.ok(cursor+packedSize <= bytes.length);
    const packed=bytes.subarray(cursor,cursor+packedSize);
    const expanded=flags&1?unpackMszip(packed,rawSize):packed;
    const raw=flags&2?unpackNetworkColumns(expanded,records):expanded;
    assert.equal(raw.length,rawSize);
    let at=0;
    for(let i=0;i<records;i++) {
      assert.ok(at+8<=raw.length);
      const tick=raw.readUInt32LE(at), type=raw.readUInt16LE(at+4), size=raw.readUInt16LE(at+6);
      assert.ok(at+8+size<=raw.length);
      // Team changes also invalidate a fixed-team category. Events after the
      // match result do not turn a completed game into a departure game.
      if(tick>=start && tick<end && [4,6,7].includes(type))stable=false;
      at+=8+size;
    }
    assert.equal(at,raw.length);
    cursor+=packedSize; seen+=records;
  }
  assert.equal(cursor,bytes.length);
  assert.equal(seen,bytes.readUInt32LE(12));
  return stable;
}

export async function auditRoster(path, start, end) {
  const envelope=await readEnvelope(path,{botAwareHost:true});
  const bytes=await readFile(path);
  assert.ok(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>=start&&end<=envelope.ticks);
  const extended=bytes.readUInt32LE(64)>=480;
  const offset=extended?bytes.readUInt32LE(448):0, size=extended?bytes.readUInt32LE(452):0;
  assert.ok(offset+size<=bytes.length);
  const host=envelope.network?.host;
  const bots=host?.bot_slots?.length ?? (envelope.format===3 && envelope.network ? null : envelope.bots??0);
  return {version:1,source_sha256:createHash('sha256').update(bytes).digest('hex'),
    start_tick:start,end_tick:end,stable:stableNetworkRoster(bytes.subarray(offset,offset+size),start,end),
    bot_count:bots,initial_player_count:envelope.players};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await auditRoster(process.argv[2],Number(process.argv[3]),Number(process.argv[4]))));
}
