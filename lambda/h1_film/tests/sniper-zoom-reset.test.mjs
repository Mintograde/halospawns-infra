import assert from 'node:assert/strict';
import test from 'node:test';
import {originalUnzoomedShots} from '../runtime/sniper-zoom-reset.mjs';

test('a local injury resets zoom through the exact original shooter inputs', async () => {
  const track = {part:{player:1}, envelope:{format:3,players:2, ticks:4, first_update:10,
    recorded_own_player:1,recorded_local_player_mask:2,network:{clocks:[{frame:10,game_tick:99}]}}};
  const hit = {victim:1, attacker:0, flags:0, client_tick:100, host_tick:78, damage_tag:9,
    body_vitality:1, shield_damage:5, body_damage:0};
  const shot = {clock:102, deal:7, body:0xa1234567};
  const damage = Buffer.alloc(112);
  damage[0]=1; damage.writeUInt32LE(shot.body,4); damage.writeUInt32LE(9,8);
  damage.writeInt32LE(78,108); damage.writeFloatLE(5,80);
  const action = (frame,level) => {
    const buffer=Buffer.alloc(83);
    buffer.writeUInt16LE(79,1); buffer[4]=1; buffer.writeUInt32LE(frame,5);
    buffer[21]=2; buffer.writeInt16LE(level,80); buffer[82]=3;
    return buffer;
  };
  async function run({receipt=hit, victim=shot, inputs=[0,-1,-1,-1], records=[[11,70,damage]],
                      anchors=[]}={}) {
    const inspect = async (_, {observeRecord,observeTickBlock}) => {
      observeTickBlock(Buffer.concat(inputs.map((zoom,i)=>action(10+i,zoom))),0,4);
      for(const [frame,type,data] of records) observeRecord(frame,type,data);
    };
    return [...await originalUnzoomedShots('',track,[receipt],[victim],anchors,inspect)];
  }
  assert.deepEqual(await run(),[7]);
  for(const receipt of [{...hit,flags:2},{...hit,victim:0},{...hit,host_tick:77}])
    assert.deepEqual(await run({receipt}),[]);
  assert.deepEqual(await run({victim:{...shot,body:0xb1234567}}),[]);
  assert.deepEqual(await run({inputs:[0,-1,1,-1]}),[]);
  assert.deepEqual(await run({records:[[11,70,damage],[12,76,Buffer.alloc(5)]]}),[]);
  assert.deepEqual(await run({records:[[11,70,damage],[12,79,Buffer.from([0,0,0,0,0])]]}),[]);
  assert.deepEqual(await run({records:[]}),[]);
  assert.deepEqual(await run({records:[],anchors:[[1,shot.body]]}),[7]);
  track.envelope.network.clocks.push({frame:12,game_tick:99});
  assert.deepEqual(await run(),[]);
});
