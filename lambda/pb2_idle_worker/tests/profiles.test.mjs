import test from 'node:test';
import assert from 'node:assert/strict';
import {inputProfiles} from '../profiles.mjs';

function film(sources, {copy=false, client=false, named='Alpha', mask=4, style='mcc_modern'}={}) {
  const ini=Buffer.from('[lobby]\nseat1_profile=3\n[profile0]\nsensitivity=99\n[profile3]\nstick_behavior='+style+
    '\nsensitivity=3.25\nmcc_horizontal_sensitivity=5\nmcc_vertical_sensitivity=6\nmouse_sensitivity=1.2\n'+
    'input_delay_ms=auto\npassword=private\n[video]\nfiring_input_polling=30\n');
  const roster=Buffer.alloc(464);roster.writeUInt32LE(0x52545352);roster.writeUInt32LE(3,4);
  roster.write(named,76,24,'utf16le');
  const pad=Buffer.alloc(64+sources.length*14);
  [0x31444150,1,64,1,14,sources.length,0,4+(copy?16:0),0,16,64,64,2,mask,0,0].forEach((v,i)=>pad.writeUInt32LE(v,i*4));
  sources.forEach(([v,flags],i)=>{pad[64+i*14+12]=v;pad[64+i*14+13]=flags??0;});
  const head=Buffer.alloc(504);
  [[0,0x314d4c46],[4,3],[28,client?66:2],[64,504],[76,504],[80,ini.length],
    [104,504+ini.length],[108,pad.length],[456,504+ini.length+pad.length],[460,roster.length]]
    .forEach(([off,v])=>head.writeUInt32LE(v,off));
  head.write('beta-8',384);
  return Buffer.concat([head,ini,pad,roster]);
}
const inspect=(b,client_slot=null)=>inputProfiles({film:{size_bytes:b.length},client_slot,
  roster:[{slot:2,name:'Alpha'}],stable:true},async(at,n)=>b.subarray(at,at+n));
test('attributes the selected seat, excludes menus, and reads only allowed profile fields',async()=>{
  const [r]=await inspect(film([[1],[1],[2],[2,1],[0],[3],[4]]));
  assert.deepEqual(r,{slot:2,name:'Alpha',controller:2,mouse:1,recording:'host',profile:{
    stick_mode:'mcc_modern',pb_sensitivity:3.25,mcc_horizontal:5,mcc_vertical:6,
    mouse_sensitivity:1.2,input_delay_ms:'auto',firing_poll_hz:30,pipeline_ticks:2,build:'beta-8'}});
});
test('copied host inputs never inherit recorder settings, unmatched and scripted seats stay unknown',async()=>{
  assert.deepEqual((await inspect(film([[2]],{copy:true})))[0].profile,{pipeline_ticks:2});
  for(const b of [film([[1]],{named:'Other'}),film([[1]],{mask:0}),film([[0],[3],[4]])]) assert.deepEqual(await inspect(b),[]);
  assert.deepEqual(await inspect(film([[1]],{client:true}),1),[]);
  assert.equal((await inspect(film([[2]],{client:true}),2))[0].recording,'client');
});
