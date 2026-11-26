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

test('style requires complete original coverage and leaves public settings available on abstention',async()=>{
  const count=3600, b=film(Array.from({length:count},()=>[1]));
  b.writeUInt32LE(30,12); b.writeUInt32LE(count,44);
  const pad=b.readUInt32LE(104), samples=pad+64;
  for(let i=0;i<count;i++){
    b.writeInt16LE(20000,samples+i*14+8);
    if(i%30===15) b.writeUInt16LE(0x1000,samples+i*14);
  }
  const [original]=await inspect(b);
  assert.equal(original.style.metrics.a_rate,60);
  b.writeUInt32LE(count+1,44);
  const [partial]=await inspect(b);
  assert.equal(partial.style,undefined);
  assert.deepEqual(partial.profile,original.profile);
  b.writeUInt32LE(count,44); b.writeUInt32LE(20,pad+28);
  assert.equal((await inspect(b))[0].style,undefined);
});

function legacyFilm(sources, {protocol=9818, own=2, mask=4, name='Alpha', client=true}={}) {
  const bytes = film(sources,{client});
  bytes.writeUInt32LE(2,4);
  bytes.writeUInt32LE(protocol,8);
  bytes.writeUInt32LE(1,100);
  bytes.writeUInt32LE((mask << 16) | (own << 8) | 3,124);
  const pad = bytes.readUInt32LE(104);
  bytes.writeUInt32LE(0,pad+28);
  bytes.writeUInt32LE(0,pad+52);
  const names = Buffer.alloc(196);
  names.writeUInt32LE(0x454d414e);
  names.write(name,4+2*24,24,'utf16le');
  bytes.writeUInt32LE(names.length,460);
  return Buffer.concat([bytes.subarray(0,bytes.readUInt32LE(456)),names]);
}

test('Beta 4 and 5 attribute original input through their own envelope and NAME roster',async()=>{
  const [client] = await inspect(legacyFilm([[2],[2],[1],[1,1]]),2);
  assert.deepEqual([client.slot,client.name,client.recording,client.controller,client.mouse],[2,'Alpha','client',1,2]);
  assert.equal(client.profile.mouse_sensitivity,1.2);
  const [host] = await inspect(legacyFilm([[1]],{protocol:9803,mask:0,client:false}));
  assert.deepEqual([host.slot,host.recording,host.controller],[2,'host',1]);
  for (const options of [{own:1},{mask:5},{name:'Another'},{protocol:9848}]) {
    assert.deepEqual(await inspect(legacyFilm([[1]],options),2),[]);
  }
  assert.deepEqual(await inspect(legacyFilm([[0],[3],[4]]),2),[]);
  const mirror = legacyFilm([[1]]);
  mirror.writeUInt32LE(0,104);
  mirror.writeUInt32LE(0,108);
  assert.deepEqual(await inspect(mirror,2),[]);
});

test('legacy split-screen seats keep separate samples and the source roster order',async()=>{
  const bytes = legacyFilm([[1],[2]],{protocol:9803,own:1,mask:0,client:false});
  const pad = bytes.readUInt32LE(104), names = bytes.readUInt32LE(456);
  bytes.writeUInt32LE(2,100);
  bytes.writeUInt32LE(2,pad+12);
  bytes.writeUInt32LE(1,pad+20);
  bytes.write('Bravo',names+4+24,24,'utf16le');
  const job = {film:{size_bytes:bytes.length},stable:true,roster:[{slot:1,name:'Bravo'},{slot:2,name:'Alpha'}]};
  const rows = await inputProfiles(job,async(at,n)=>bytes.subarray(at,at+n));
  assert.deepEqual(rows.map(r=>[r.name,r.controller,r.mouse]),[['Bravo',1,0],['Alpha',0,1]]);
});
