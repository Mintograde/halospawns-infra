#include <string.h>
#include "xinput.h"

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
#ifdef __EMSCRIPTEN__
void blampc_play_clock_start(void) { }
#endif
#ifndef __EMSCRIPTEN__
float blampc_kbm_seat_factor(float seat_rate, float default_rate)
{
    if (!(seat_rate > 0.0f) || !(default_rate > 0.0f)) return 1.0f;
    return seat_rate / default_rate;
}
#endif
