#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include "xinput.h"
#include "blampc_bots.h"

static int background_pad;
int blampc_live_input_phys_slot(int port) { return port >= 0 && port < 4 ? port : -1; }
int blampc_live_input_slot_state(int port, XINPUT_STATE *state)
{
    (void)port;
    memset(state, 0, sizeof *state);
    return 0;
}
void blampc_pad_claim_sync(unsigned int mask) { (void)mask; }
unsigned int blampc_pad_claim_foreign(void) { return 0; }
int blampc_live_input_background_pad(void) { return background_pad; }
void blampc_live_input_set_background_pad(int on) { background_pad = on != 0; }
int blampc_kbm_seat_active_mouse(int seat) { (void)seat; return 0; }
void blampc_play_clock_start(void) { }
void blampc_bots_inject(int absolute_index, int update_number, struct player_action *action)
{
    (void)absolute_index; (void)update_number; (void)action;
}
void blampc_bot_options_lock(int bots, int skill) { (void)bots; (void)skill; }
int blampc_bot_nav_set_mode(const char *name, int saved) { (void)name; (void)saved; return 0; }
const char *blampc_bot_nav_mode_name(void) { return "off"; }
void blampc_spawnzones_pre_tick(void) { }
const char *blampc_spawnzones_mode_label(int mode)
{
    static const char *labels[] = { "NO", "MARKERS", "MARKERS + ZONES", "MARKERS + ZONES + ODDS" };
    return mode >= 0 && mode < 4 ? labels[mode] : labels[0];
}
