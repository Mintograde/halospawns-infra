/* No window, live spectator session or update client exists in offline conversion.
 * Signatures follow the pinned upstream headers; simulation modules are compiled separately. */
#include <stdlib.h>
#include <string.h>
#include "blampc_share_window.h"
void blampc_share_window_set_mode(int mode) {  }
int  blampc_share_window_mode(void) { return 0; }
void blampc_share_window_set_monitor(int monitor) {  }
int  blampc_share_window_monitor(void) { return 0; }
void blampc_share_window_get_rect(int *x, int *y, int *w, int *h) { *x = *y = *w = *h = 0; }
const char *blampc_share_window_mode_word(int mode) { return "off"; }
int  blampc_share_window_parse_mode(const char *word) { return 0; }
int  blampc_share_window_parse_rect(const char *text) { return 0; }
void blampc_share_window_get_size(int *w, int *h) { *w = *h = 0; }
int  blampc_share_window_parse_size(const char *text) { return 0; }
void blampc_share_window_import(void) {  }
int  blampc_share_window_planned(int seats, int screens) { return 0; }
int  blampc_share_window_take_view(int seats) { return 0; }
void blampc_share_window_idle(void) {  }
int  blampc_share_window_closed(void) { return 0; }
void blampc_share_window_view_bounds(short pix[4], short safe[4]) { memset(pix, 0, 8); memset(safe, 0, 8); }
#include "blampc_spectate_session.h"
int blampc_spectate_session_config(const char *key, const char *value) { return 0; }
void blampc_spectate_session_write(void *file) {  }
void blampc_spectate_session_poll(void) {  }
const blampc_spectate_session_info *blampc_spectate_session_selected(void) { return 0; }
void blampc_spectate_session_retry(void) {  }
int blampc_spectate_session_boot(struct blampc_boot_options *opts) { abort(); }
int blampc_spectate_session_watching(void) { return 0; }
void blampc_spectate_session_leave(void) {  }
#include "blampc_spectate_live.h"
void blampc_relay_set_spec(const char *spec) {  }
int  blampc_relay_wanted(void) { return 0; }
int  blampc_film_relay_open(void) { abort(); }
void blampc_film_relay_send(const void *data, int size) {  }
void blampc_film_relay_close(void) {  }
void blampc_spectate_announce(const char *kv) {  }
void blampc_spectate_status(int tick, int hz) {  }
int  blampc_spectate_live_boot(struct blampc_boot_options *opts, const char *spec) { abort(); }
void blampc_spectate_live_pump(void) {  }
int  blampc_spectate_live_hold(void) { return 0; }
int  blampc_spectate_live_active(void) { return 0; }
int  blampc_spectate_live_interrupted(void) { return 0; }
void blampc_spectate_live_end(void) {  }
int blampc_film_relay_active(void) { return 0; }
#include "blampc_update.h"
int  blampc_update_config_key(const char *key, const char *val) { return 0; }
void blampc_update_config_write(void *fh) {  }

#include "blampc_colorblind.h"
#include "blampc_decal_check.h"
void blampc_colorblind_set(int group, int mode, int strength, int brightness, int contrast) {}
void blampc_decal_check_op(const char *op, int decal_index) {}
void blampc_decal_check_delete_begin(int decal_index) {}
void blampc_decal_check_vertices_new(void) {}
int blampc_decal_check_assume_resident(void) { return 0; }

void blampc_bar_timer_show_teammate_respawn(int on) {  }
int blampc_chdir_to_game_root(void) { return 0; }
void blampc_d3d_resume_session(void) {  }
void blampc_d3d_scene_reference_size(int *w, int *h) { *w = *h = 0; }
void blampc_hud_apply_scale(void) {  }
void blampc_d3d11_jit_wait(void) {  }
void blampc_scanline_set(int line) {  }
void blampc_d3d_map_textures_end(void) {  }
void blampc_display_refresh_describe(char *buf, int size) { if (size > 0) buf[0] = 0; }
void blampc_hud_readout_set_loss(int enabled) {  }
void blampc_ingame_menu_map_end(void) {  }
void blampc_frame_clock_set_display(int on) {  }
void blampc_frame_clock_vsync_lock(int ok) {  }
void blampc_live_input_peek_freecam0(unsigned char *lt, unsigned char *rt, int *fast) { *lt = *rt = 0; *fast = 0; }
int blampc_live_input_unbound_key(int seat, int control) { return 0; }
void blampc_menu_spectate_report(void) {  }
void blampc_menu_spectate_return(void) {  }
void blampc_menu_font_set_text_size(int percent) {  }
void blampc_menu_font_shutdown(void) {  }
int blampc_outline_available(void) { return 0; }
void blampc_pace_trace_drawn(int game_time) {  }
void blampc_pace_trace_frame_begin(void) {  }
void blampc_pace_trace_mark(int which) {  }
void blampc_pace_trace_steps(int steps) {  }
void blampc_sound_category_origin(int definition_index, int scenery_owned) {  }
void blampc_sound_directional_origin(int sound_index) {  }
void blampc_sound_map_end(void) {  }
void blampc_sound_mark_directional(int sound_index, const float *position) {  }
void blampc_sound_set_category_gain(int category, float g) {  }
void blampc_sound_set_category_tags(int category, const int *tag_indices, int count) {  }
void blampc_sound_set_scenery_gain(float g) {  }
int blampc_sound_loop_owner_is_scenery(int looping_sound_index) { return 0; }
void blampc_spectate_probe(void) {  }
