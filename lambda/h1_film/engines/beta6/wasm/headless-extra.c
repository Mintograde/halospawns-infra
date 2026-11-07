#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include "xinput.h"
#include "blampc_bots.h"

/* Offline host-film playback has no live network session. */
#ifndef H1_CLIENT_VIEW
int u_session(void) { return 0; }
#endif

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

/* The converter stages exactly one approved map; no Workshop discovery. */
int blampc_map_folders_path(const char *stem, char *path, int size) {
    int n = snprintf(path, (size_t)size, "maps/%s.map", stem);
    return n > 0 && n < size;
}
/* Headless exports do not read external bitmap pixels, as in upstream server builds. */
void blampc_map_folders_open_bitmaps(const char *stem) { (void)stem; }
void *blampc_map_folders_bitmaps_handle(void) { return NULL; }
int blampc_map_folders_bitmap_readable(int offset, int size) { (void)offset; (void)size; return 0; }
/* Offline films apply the recorded delivery stream; there is no live socket. */
unsigned long blampc_net_client_stream_reads(void) { return 0; }
void blampc_net_universal_refusals(unsigned long *bad_slot, unsigned long *other_address) {
    if (bad_slot) *bad_slot = 0;
    if (other_address) *other_address = 0;
}
int blampc_net_universal_slots(int *slots, int maximum) { (void)slots; (void)maximum; return 0; }
int blampc_net_universal_joined_slots(int *slots, int maximum) { (void)slots; (void)maximum; return 0; }
int blampc_net_universal_queued(int slot) { (void)slot; return 0; }
int blampc_net_universal_send(int slot, int reliable, const void *body, int size) {
    (void)slot; (void)reliable; (void)body; (void)size; abort();
}
void blampc_net_universal_drop(int slot, const char *why) { (void)slot; (void)why; abort(); }
int blampc_net_client_udp_describe(char *out, int size) { if (size > 0) *out = 0; return 0; }
/* No negotiated live lobby; playback uses the recorded rule events. */
int blampc_net_lobby_velocity_blocks(float *out) { (void)out; return 0; }

/* Process metrics are collected by the Node runner, outside WASM. */
#include "blampc_proc_usage.h"
int blampc_proc_usage_read(blampc_proc_usage *out) { memset(out, 0, sizeof *out); return 0; }
int blampc_proc_memory_read(blampc_proc_memory *out) { memset(out, 0, sizeof *out); return 0; }
void blampc_proc_memory_trim(void) { }
void blampc_proc_alloc_trace_report(const char *when) { (void)when; }
