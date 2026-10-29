import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [source, output, shared, commit, date] = process.argv.slice(2);
assert.match(commit, /^[0-9a-f]{40}$/);
assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
const host = name => readFile(join(source, 'host', name), 'utf8');
const objects = await host('blampc_net_universal_objects.c');
const damage = await host('blampc_net_universal_damage.c');
const network = await host('blampc_net_universal.c');

function extract(text, name) {
  const matches = [...text.matchAll(new RegExp(`^[A-Za-z_][^\\n;{}]*\\b${name}\\([^;{}]*\\)\\s*\\{[\\s\\S]*?^\\}`, 'gm'))];
  assert.equal(matches.length, 1, `Expected one upstream definition: ${name}`);
  return matches[0][0];
}

const functions = [
  ...['u_header_of', 'u_object', 'u_object_of_type', 'u_damage_material', 'blampc_universal_film_deal'].map(name => extract(damage, name)),
  extract(objects, 'blampc_universal_film_transform'),
  ...['u_object_header', 'u_unit', 'u_living_unit', 'u_real_valid', 'u_player_is_local', 'u_player', 'u_player_live', 'u_change_team_respawn', 'u_change_team_apply', 'blampc_universal_film_quit',
    'blampc_universal_film_end_game', 'blampc_universal_film_team', 'blampc_universal_respawn_waits',
    'blampc_universal_film_join']
    .map(name => extract(network, name)),
];
functions.push(extract(damage, 'u_unit_player'));
const deals = extract(damage, 'blampc_universal_damage_deals');
assert.equal(deals.split('connection = game_connection();').length, 2);
assert.equal(deals.split('if (!u_session())').length, 2);
const hostDeals = deals.replace(/    if \(blampc_film_client_view_playing\(\)\)[\s\S]*?(?=    if \(!u_session\(\)\))/, '    if (blampc_film_client_view_playing()) abort();\n');
functions.push(hostDeals.split('connection = game_connection();')[0].replace('if (!u_session())', 'if (1)') + '\n}');
const includes = [...new Set([...`${damage}\n${objects}\n${network}`.matchAll(/^#include "headers\/[^"\n]+"/gm)]
  .map(match => match[0]))];
const declarations = `
#include "blampc_film.h"
#include "blampc_film_clientview.h"
#include <stdlib.h>
#include <string.h>
#define U_NONE (-1)
#define U_MAX_PLAYERS 16
#define U_DAMAGE_DEAD_BIT 2
#define U_RATIO BLAMPC_TICKS_PER_ARTEFACT_TICK
static int s_dealing_report;
static unsigned char s_team_wait[U_MAX_PLAYERS];
static void blampc_universal_player_reset(int index) {
    if (index >= 0 && index < U_MAX_PLAYERS) s_team_wait[index] = 0;
}
extern void object_set_position(int, const real_point3d *, const real_vector3d *, const real_vector3d *);
extern void object_cause_damage(damage_data *, int, short, short, short, const real_vector3d *);
extern unsigned char game_engine_running(void);
extern void game_engine_end_game(void);
extern void object_deplete_body(int);
extern void unit_handle_forced_player_kill(int);
extern void player_died(int);
extern void game_engine_player_killed(int, int, int, unsigned char);
`;
await writeFile(join(output, 'offline-network.c'), includes.join('\n') + declarations + functions.join('\n\n'));
let stubs = await host('local/blampc_net_local_stub.c');
const projectile = await host('blampc_net_projectile_sync.c');
for (const match of projectile.matchAll(/^(?:int|void|unsigned int|float) +([a-zA-Z0-9_]+)\([^;{}]*\)\s*\{/gm)) {
  stubs = stubs.replace(new RegExp('\\b' + match[1] + '\\b', 'g'), 'hs_unused_' + match[1]);
}
for (const name of ['blampc_universal_damage_deals', 'blampc_universal_film_deal',
  'blampc_universal_film_transform', 'blampc_universal_film_quit', 'blampc_universal_film_end_game',
  'blampc_universal_film_team', 'blampc_universal_respawn_waits', 'blampc_universal_film_join',
  'blampc_net_gametype_received', 'blampc_net_gametype_host_base']) {
  stubs = stubs.replace(new RegExp(`\\b${name}\\b`, 'g'), `hs_unused_${name}`);
}
await writeFile(join(output, 'local-network.c'), stubs);
let headless = await readFile(join(shared, 'headless.c'), 'utf8');
for (const name of ['blampc_net_host_set_variant', 'blampc_net_session_variant']) {
  headless = headless.replace(new RegExp(`\\b${name}\\b`, 'g'), `hs_unused_${name}`);
}
headless += `
const char *blampc_menu_build_label(void) { return "${date} - BETA 5 - ${commit.slice(0, 8)}"; }
void blampc_log_start(void) { }
void blampc_log_install(void) { }
void blampc_log_stop(void) { }
void blampc_log_crash_copy(void) { }
void blampc_d3d_set_dpi_aware(void) { }
void blampc_bar_timer_set_teammate_respawn(int on) { (void)on; }
void blampc_kbm_drain(void) { }
void blampc_kbm_frame(int seat, int live) { (void)seat; if (live) abort(); }
void blampc_kbm_theater(int on) { (void)on; }
int blampc_kbm_theater_take(float *yaw, float *pitch) { (void)yaw; (void)pitch; return 0; }
int blampc_kbm_seat_is_mouse(int seat) { (void)seat; return 0; }
int blampc_kbm_take_facing(int seat, float zoom, float *yaw, float *pitch) {
    (void)seat; (void)zoom; (void)yaw; (void)pitch; return 0;
}
int blampc_kbm_pending_facing(int seat, float zoom, float *yaw, float *pitch) {
    (void)seat; (void)zoom; (void)yaw; (void)pitch; return 0;
}
void blampc_kbm_delay_print(void) { }
`;
headless += extract(await host('blampc_kbm.c'), 'blampc_kbm_seat_factor');
await writeFile(join(output, 'headless.c'), headless);

// The worker map contract remains cache version 7; do not reserve the MCC address window.
let mcc = await host('blampc_mcc_maps.c');
mcc = mcc.replace(extract(mcc, 'blampc_mcc_maps_reserve'), 'void blampc_mcc_maps_reserve(void) {}');
await writeFile(join(output, 'mcc-maps.c'), mcc);
