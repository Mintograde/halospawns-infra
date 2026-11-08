// Build an isolated snapshot. Never patch a registered engine or archived source.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const {values} = parseArgs({options:{out:{type:'string'},ref:{type:'string',default:'HEAD'}}});
assert(values.out,'Pass --out <new directory> [--ref <commit>]');
const repo = fileURLToPath(new URL('../../../../',import.meta.url));
const root = path.resolve(values.out), ports = path.join(root,'port/lambda/h1_film/engines');
assert(!fs.existsSync(root),'Use a new output directory; previous evidence is never overwritten');
const git = (...args) => execFileSync('git',args,{cwd:repo,windowsHide:true,encoding:'utf8'}).trim();
const revision = git('rev-parse','--verify',values.ref + '^{commit}');
assert(/^[a-f0-9]{40}$/.test(revision));
fs.mkdirSync(root,{recursive:true});
git('archive','--format=tar','--output=' + path.join(root,'ports.tar'),revision,'lambda/h1_film/engines');
fs.mkdirSync(path.join(root,'port'));
execFileSync('tar',['-xf',path.join(root,'ports.tar'),'-C',path.join(root,'port')],{windowsHide:true});
function replace(file,from,to) {
  const source = fs.readFileSync(file,'utf8');
  assert.equal(source.split(from).length,2,'Unfamiliar engine integration: ' + from);
  fs.writeFileSync(file,source.replace(from,to));
}
const probe = fs.readFileSync(new URL('./probe.h',import.meta.url));
fs.writeFileSync(path.join(ports,'beta3/host-shot-probe.h'),probe);
replace(ports + '/beta3/combat.h','#include "gameplay.h"',
  '#include "host-shot-probe.h"\n#include "gameplay.h"');
replace(ports + '/beta3/combat.h',
  '    hs_original_projectile_collision(handle, collision, position, velocity, remaining);',
  '    hs_probe_collision(handle, collision);\n    hs_original_projectile_collision(handle, collision, position, velocity, remaining);');
replace(ports + '/beta3/gameplay.h',
  '    result = hs_original_universal_film_deal(bytes, size, object, node, region, material, normal);',
  '    hs_probe_deal(hs_gameplay_deal, damage, object);\n    result = hs_original_universal_film_deal(bytes, size, object, node, region, material, normal);');
for (const beta of ['beta5','beta6']) fs.appendFileSync(ports + '/' + beta + '/native/CMakeLists.txt',String.raw`
set_property(SOURCE "${'${H1_SOURCE}'}/host/blampc_net_shot_ledger.c" TARGET_DIRECTORY blampc
 APPEND PROPERTY COMPILE_DEFINITIONS
 blampc_shot_ledger_projectile=hs_probe_original_projectile
 blampc_shot_ledger_detonation=hs_probe_original_detonation
 blampc_shot_ledger_deleted=hs_probe_original_deleted)
`);
const file = ports + '/beta3/export.c', original = fs.readFileSync(file,'utf8');
const at = original.indexOf('void hs_export_tick(FILE *out, int frame)');
assert(at > 0 && at === original.lastIndexOf('void hs_export_tick(FILE *out, int frame)'));
// Keep the roster and combat/gameplay observations; omit full viewer serialization.
fs.writeFileSync(file,original.slice(0,at) + String.raw`
void hs_export_tick(FILE *out, int frame)
{
    static int previous = -1, ended = 0;
    int i, tick = game_time_globals ? game_time_globals->local_time - 1 : -1;
    int now_ended = game_engine_globals.mode != game_engine_mode_active;
    (void)frame;
#ifdef H1_CLIENT_VIEW
    extern int hs_film_export_tick(int);
    tick = hs_film_export_tick(tick);
#endif
    if (tick < 0 || tick == previous) return;
    if (previous >= 0 && tick != previous + 1) hs_fail("simulation clock skipped a tick");
    previous = tick;
    hs_tick = tick;
    hs_begin(NULL, 1);
    hs_int("current_tick", tick);
    hs_bool("game_ended_this_tick", now_ended && !ended);
    ended = now_ended;
    hs_begin("players", 0);
    if (player_data && player_data->data) {
        for (i = 0; i < player_data->count; ++i) {
            const player_datum *p = DATA_ARRAY_ELEMENT(player_data, player_datum, i);
            if (p->identifier) hs_int(NULL, hs_participant(((unsigned int)(unsigned short)p->identifier << 16) | i));
        }
    }
    hs_end();
    hs_combat_frame(tick);
    hs_end();
    hs_flush_frame(out);
}
`);
fs.writeFileSync(path.join(root,'preparation.json'),JSON.stringify({revision,
  probe_sha256:createHash('sha256').update(probe).digest('hex')},null,2) + '\n');
console.log(JSON.stringify({root,ports,revision}));
