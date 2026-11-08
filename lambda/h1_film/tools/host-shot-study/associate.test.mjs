import test from 'node:test';
import assert from 'node:assert/strict';
import {associateHostShots,configs} from './associate.mjs';
import {deriveGameplayMetrics} from '../../runtime/gameplay-metrics.mjs';

test('even perfect host collision and trajectory evidence cannot detect an omitted client miss',()=>{
  const weapon='weapons\\pistol\\pistol', events=[], geometry=[];
  for(let i=0;i<3;i++) {
    const clock=i*40,shot=i+1;
    events.push({kind:0,source_tick:clock,clock,slot:0,physical:2,weapon,weapon_tag:1,shot});
    events.push({kind:1,source_tick:clock,clock,slot:0,physical:2,victim:1,unit:99,
      weapon,weapon_tag:1,deal:shot,shot:0,relationship:0,
      before:i===0?[1,1]:i===1?[0.5,1]:[0,1],after:i===0?[0.5,1]:i===1?[0,1]:[0,0]});
    geometry.push({event:'round',shot,origin:[0,0,0],direction:[1,0,0]},
      {event:'collision',shot,object:99},
      {event:'deal',deal:shot,direction:[1,0,0],impact:[10,0,0]});
  }
  events.push({kind:2,source_tick:80,slot:0,victim:1,weapon,relationship:0});
  const common={slots:[0,1],deaths:[{event_index:0,source_tick:80,killer_slot:0,victim_slot:1}]};
  const result=events=>deriveGameplayMetrics({...common,events}).metrics[0].players[0];
  const original=events.map(e=>e.kind===0?{...e,discharge:'host/'+e.shot,domain:'host'}:
    e.kind===1?{...e,discharge:'client/'+e.deal,
      // Original pulls are 1, (miss 2), 3, 4; the host has only 1, 2, 3.
      remoteShot:{slot:0,weapon,domain:'client',sequence:e.deal===1?1:e.deal+1}}:e);
  assert.equal(result(original).value,0);
  for(const config of configs) {
    assert.equal(result(associateHostShots(events,geometry,config).events).value,1,config.name);
  }
});
