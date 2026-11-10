// Real client playback replaces offline stubs; no live transport is linked.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export const clientViewSources = [
  'blampc_net_rules.c','blampc_net_idle.c','blampc_net_lagcomp.c',
  'blampc_net_confirmed_hit_effects.c','blampc_net_ping_variant.c',
  'blampc_net_universal.c','blampc_net_universal_objects.c',
  'blampc_net_universal_damage.c','blampc_net_universal_game.c',
  'blampc_net_universal_devices.c','blampc_net_teleport_hold.c',
  'blampc_net_knockback.c',
  'blampc_net_reliable.c','blampc_net_clock_sync.c','blampc_net_link.c',
  'blampc_net_arrival.c','blampc_net_quality.c',
  'blampc_net_aimcheck.c','blampc_net_rewind.c','blampc_net_sight.c',
  'blampc_net_stick.c','blampc_net_trace.c','blampc_net_incident.c','blampc_net_bench.c',
  'blampc_net_ping.c','blampc_net_quality_core.c','blampc_net_universal_tags.c',
  'blampc_net_shot_ledger.c',
];
export async function prepareClientView(source,output,stubs) {
  for(const name of clientViewSources) {
    const text=await readFile(join(source,'host',name),'utf8');
    if(name==='blampc_net_ping.c') {
      // Only the portable clock/board code is used. Neither socket header is referenced.
      await writeFile(join(output,name),text.replace('#include <winsock2.h>','').replace('#include "blampc_net_waitq.h"',''));
    }
    for(const match of text.matchAll(/^(?!static\b)(?:[\w]+[ \t*]+)+([A-Za-z_]\w*)\([^;{}]*\)\s*\{/gm)) {
      const name=match[1];
      const definition=new RegExp(`^(?:[\\w]+[ \\t*]+)+${name}\\([^;{}]*\\)\\s*\\{(?:[^{}]*|[\\s\\S]*?^)}[ \\t]*$`,'gm');
      stubs=stubs.replace(definition,`/* ${name}: upstream client-view implementation. */`);
    }
  }
  await writeFile(join(output,'local-network.c'),stubs);
  await writeFile(join(output,'client-network-sources.cmake'),
    'set(network_sources\n'+clientViewSources.map(name=>`    "${name==='blampc_net_ping.c'?output:join(source,'host')}/${name}"`).join('\n')+'\n)\n');
}
