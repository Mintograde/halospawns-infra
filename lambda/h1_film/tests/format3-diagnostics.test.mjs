import assert from 'node:assert/strict';
import test from 'node:test';
import {readClientAccount,decodeAccountRows} from '../runtime/format3-diagnostics.mjs';
import {TABLES} from '../runtime/diagnostics-codec.mjs';

function idleAccount(player=-1) {
  const bytes=Buffer.alloc(168);
  bytes.write('LDC1');bytes.writeUInt32LE(12,4);bytes.writeUInt32LE(160,8);
  bytes.writeUInt32LE(120,16);bytes.writeUInt32LE(14,20);
  bytes.writeInt32LE(0,24);bytes.writeInt32LE(player,28);bytes.writeInt32LE(-1,44);
  for(let i=0;i<14;i++)bytes.writeUInt32LE(i===13?1:TABLES.client[i][1],52+i*8);
  bytes.writeUInt32LE(1,56);bytes.writeInt32LE(10,160);bytes.writeInt32LE(12,164);
  return bytes;
}

test('Beta 7 idle account retains its unknown player and exact clock evidence',()=>{
  const bytes=idleAccount(),before=Buffer.from(bytes);
  const account=readClientAccount(bytes,{allowUnassignedPlayer:true});
  assert.equal(account.own_player,-1);assert.equal(account.own_machine_slot,0);
  assert.deepEqual(account.tables.find(t=>t.name==='clock').bytes,bytes.subarray(160));
  assert.equal(decodeAccountRows(account,'clock').length,1);
  assert.deepEqual(bytes,before);
  assert.throws(()=>readClientAccount(bytes),/recording player/);
});

test('the unknown-player exception does not admit out-of-range identities or broken tables',()=>{
  for(const player of [-2,16,2147483647])
    assert.throws(()=>readClientAccount(idleAccount(player),{allowUnassignedPlayer:true}),/recording player/);
  for(const player of [0,15])assert.equal(readClientAccount(idleAccount(player)).own_player,player);
  const bad=idleAccount();bad.writeUInt32LE(2,56);
  assert.throws(()=>readClientAccount(bad,{allowUnassignedPlayer:true}),/Truncated/);
});
