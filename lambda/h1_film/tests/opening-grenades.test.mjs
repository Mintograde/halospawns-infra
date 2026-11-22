import assert from 'node:assert/strict';
import test from 'node:test';
import {openingSpawnRows, openingInventoryWitness, corroboratedOpening, verifyOpening} from '../runtime/opening-grenades.mjs';

const log = '[h1-opening] slot=0 unit=E2770008 grenades=4,0\n[h1-opening] slot=1 unit=E27A000B grenades=4,0\n';
const spawns = openingSpawnRows(log,2);
function unitState(slot, unit, tick=1) {
  const data = Buffer.alloc(68);
  data[0]=slot; data[1]=3; data.writeUInt32LE(unit,4); data.writeInt32LE(tick,64);
  return data;
}
function inventory(unit, plasmas=1) {
  const data = Buffer.alloc(64);
  data.writeUInt32LE(unit); data[4]=4; data[5]=plasmas;
  return data;
}
const units = spawns.map(s=>parseInt(s.unit,16));
function witness(records=[], clock=1) {
  const w=openingInventoryWitness(spawns,120), clk=Buffer.alloc(4);
  clk.writeInt32LE(clock); w.record(0,64,clk);
  units.forEach((u,i)=>w.record(0,67,unitState(i,u)));
  for (const [frame,type,data] of records) w.record(frame,type,data);
  return w.rows();
}
const start=units.map(u=>[18,69,inventory(u)]);
test('opening recovery requires agreement between distinct recordings for all spawned units',()=>{
  const rows=witness(start);
  assert.deepEqual(rows,spawns.map(s=>({...s,plasmas:1})));
  assert.deepEqual(corroboratedOpening(spawns,[{player:0,rows},{player:1,rows}]),rows);
  for (const views of [[{player:0,rows}],[{player:0,rows},{player:0,rows}],[{player:0,rows},{player:1,rows:null}],
    [{player:0,rows},{player:1,rows:spawns}],[{player:0,rows:spawns},{player:1,rows:spawns}]])
    assert.equal(corroboratedOpening(spawns,views),null);
  assert.throws(()=>verifyOpening(log,{rows,players:[0,1],mismatch:486}));
  assert.equal(verifyOpening(log.replaceAll('4,0','4,1'),{rows,players:[0,1],mismatch:486}).initial_spawns,rows);
  assert.equal(openingSpawnRows(log+log,2),null);
});
test('a later inventory, pickup, reassigned unit or late clock cannot represent an opening spawn',()=>{
  assert.equal(witness([start[0]]),null);
  assert.equal(witness(start,121),null);
  assert.equal(witness([[1,74,Buffer.alloc(8)],...start]),null);
  assert.equal(witness([[1,67,unitState(1,units[0])],...start]),null);
  assert.equal(witness([...start,[25,69,inventory(units[1],0)]]),null);
  assert.equal(witness(units.map(u=>[121,69,inventory(u)])),null);
  assert.deepEqual(witness([...start,[400,69,inventory(units[1],0)]]),witness(start));
});

