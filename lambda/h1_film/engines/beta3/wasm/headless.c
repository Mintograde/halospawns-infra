#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "blampc_config.h"
#include "blampc_raw_pad.h"

/* No window, GPU, audio device, or native exception handler in this worker.
 * Simulation and export still use the original engine implementations. */
void blampc_d3d_decide_window_background(int scripted) { (void)scripted; }
void blampc_install_crash_handler(void) { }
/* The HUD probability table has no exported fields. New builds require a new
 * exporter pin and full transport/hash parity before adoption. */
void hs_unused_spawn_odds_tick(void) { }
void blampc_priority_apply(int player_session) { if (player_session) abort(); }
const char *blampc_exe_basename(void) { return "headless-wasm"; }
void blampc_devkit_root_set(const char *root) { if (root && *root) abort(); }
int blampc_render_threads(void) { return 0; }
void blampc_sound_select_device(const char *name) { (void)name; }
void blampc_sound_select_team_device(int team, const char *name) { (void)team; (void)name; }
void blampc_sound_set_listener_team(int listener, int team) { (void)listener; (void)team; }
void blampc_sound_set_map(const char *root, const char *name) { (void)root; (void)name; }
void blampc_bsp_index_watch(const char *where) { (void)where; }
void blampc_map_list_watch(const char *where) { (void)where; }
void *blampc_d3d_vbuf_create(int size) { (void)size; return NULL; }
void *blampc_d3d_ibuf_create(int size) { (void)size; return NULL; }
void *hcex_get_global_d3d_device(void) { return NULL; }
void *hcex_get_global_d3d(void) { return NULL; }
void blampc_d3d_device_size(int *width, int *height) {
    /* blampc_d3d.c defaults before any render-device configuration. */
    if (width) *width = 1920;
    if (height) *height = 1080;
}
int Direct3D_GetDeviceCaps(unsigned int adapter, unsigned int device_type, void *caps) {
    (void)adapter; (void)device_type;
    if (caps) memset(caps, 0, 304);
    return 0;
}

/* blampc_d3d_api.c returns NULL for these allocations without a device. */
void *D3DDevice_CreateTexture(unsigned int width, unsigned int height,
    unsigned int depth, unsigned int levels, unsigned int usage, unsigned int format,
    unsigned int unknown, unsigned int type) {
    (void)width; (void)height; (void)depth; (void)levels;
    (void)usage; (void)format; (void)unknown; (void)type;
    return NULL;
}
void *D3DDevice_CreateVertexDeclaration(void *elements) { (void)elements; return NULL; }

/* No concurrent renderer exists in this single-threaded worker. */
void blampc_render_shared_lock(void) { }
void blampc_render_shared_unlock(void) { }
void blampc_object_marker_lock(void) { }
void blampc_object_marker_unlock(void) { }

/* The native headless texture registry owns opaque handles, but no GPU resource. */
void *hcex_tex_new(const char *name, int index) { (void)name; (void)index; return calloc(1, 1); }
void hcex_tex_del(void *handle) { free(handle); }
void *hcex_tex_gethw(void *handle) { (void)handle; return NULL; }
int hcex_tex_get_hardware_format(void *handle, unsigned char block, unsigned char load) {
    (void)handle; (void)block; (void)load; return 0;
}
void hcex_tex_2d_copytohw(void *handle, void *pixels, int width, int height,
    int levels, unsigned int format, int size) {
    (void)handle; (void)pixels; (void)width; (void)height;
    (void)levels; (void)format; (void)size;
}
void hcex_tex_cube_copytohw(void *handle, void *pixels, int width, int height,
    int levels, unsigned int format, int size) {
    hcex_tex_2d_copytohw(handle, pixels, width, height, levels, format, size);
}
void hcex_tex_3d_copytohw(void *handle, void *pixels, int width, int height,
    int levels, int depth, unsigned int format, int size) {
    (void)depth; hcex_tex_2d_copytohw(handle, pixels, width, height, levels, format, size);
}

/* The local network shim predates this variant-name store in blampc_net.c. */
static char session_variant[16];
void blampc_net_host_set_variant(const char *variant) {
    snprintf(session_variant, sizeof(session_variant), "%s", variant && *variant ? variant : "slayer");
}
const char *blampc_net_session_variant(void) { return session_variant; }
const char *blampc_net_host_variant(void) { return session_variant; }

/* Inactive diagnostic/presentation paths in an unrendered, unscripted run. */
void blampc_prof_arm(const char *spec) { if (spec && *spec && strcmp(spec, "0")) abort(); }
void blampc_prof_stop(void) { }
void blampc_prof_print(void) { }
void blampc_watch_report(void) { }
void blampc_keyboard_script_pump(void) { }
unsigned int XInputGetKeystrokeEx(unsigned int *user_index, unsigned int flags, void *keystroke) {
    (void)user_index; (void)flags; (void)keystroke;
    return 1004; /* blampc_keyboard.c's empty-queue result. */
}
int blampc_crt_arm(int play) { if (play) abort(); return 0; }
void blampc_crt_report(void) { }
void blampc_sound_wav_tick(void) { }
void blampc_sound_wav_end(void) { }
void blampc_sound_output_end(void) { }
void blampc_sound_report(void) { }
void blampc_outline_set_teammates(int on) { (void)on; }
void input_set_gamepad_vibrater_state(int controller, unsigned short left, unsigned short right) {
    (void)controller; (void)left; (void)right;
}
int blampc_xinput_set_state(int controller, unsigned short left, unsigned short right) {
    (void)controller; (void)left; (void)right; return 0;
}
void dsound_dispose(void) { }
int blampc_loop_probe(void) { return 0; }
int blampc_sound_probe_on(void) { return 0; }
int blampc_sound_watch_active(void) { return 0; }
void blampc_render_rng_note(void *return_address) { (void)return_address; }
void blampc_render_rng_frame(unsigned int seed) { (void)seed; }

/* These volume controls only scale mixer output, never simulation or RNG. */
#define HEADLESS_GAIN(name) \
    static float name##_gain = 1.0f; \
    void blampc_sound_set_##name##_gain(float gain) { \
        name##_gain = gain < 0 ? 0 : gain > 1 ? 1 : gain; \
    } \
    float blampc_sound_get_##name##_gain(void) { return name##_gain; }
HEADLESS_GAIN(movement)
HEADLESS_GAIN(ambience)
HEADLESS_GAIN(announcer)
HEADLESS_GAIN(timer)
HEADLESS_GAIN(death)
#undef HEADLESS_GAIN

/* Preserve the native sound-tag classifications even with no mixer. */
#define HEADLESS_TAGS(name, capacity) \
    static int name##_tags[capacity], name##_count; \
    void blampc_sound_set_##name##_tags(const int *tags, int count) { \
        name##_count = !tags || count <= 0 ? 0 : count > capacity ? capacity : count; \
        if (name##_count) memcpy(name##_tags, tags, name##_count * sizeof(int)); \
    } \
    int blampc_sound_is_##name##_tag(int tag) { \
        if (tag == -1) return 0; \
        for (int i = 0; i < name##_count; ++i) if (name##_tags[i] == tag) return 1; \
        return 0; \
    }
HEADLESS_TAGS(cue, 32)
HEADLESS_TAGS(announcer, 64)
HEADLESS_TAGS(timer, 64)
HEADLESS_TAGS(timer_muted, 64)
HEADLESS_TAGS(death, 8)
HEADLESS_TAGS(movement, 256)
#undef HEADLESS_TAGS
void blampc_vibration_set_strength(int seat, int strength) { (void)seat; (void)strength; }
void blampc_pad_name_probe(void) { }
/* Recorded actions are already indexed by seat; no physical ports are read. */
void blampc_live_input_set_seat_ports(const int *ports, int count) { (void)ports; (void)count; }
void blampc_live_input_print_theater_keys(void) { puts("[film] headless WASM playback; no interactive controls"); }
unsigned int blampc_sound_clock_ms(unsigned int wall_ms) { return wall_ms; }
static int trigger_mode[4] = {BLAMPC_DEFAULT_TRIGGER_MODE, BLAMPC_DEFAULT_TRIGGER_MODE,
    BLAMPC_DEFAULT_TRIGGER_MODE, BLAMPC_DEFAULT_TRIGGER_MODE};
void blampc_live_input_set_trigger_mode(int seat, int mode) {
    if (seat < 0 || seat >= 4) return;
    if (mode != BLAMPC_TRIGGER_CEA && mode != BLAMPC_TRIGGER_XBOX && mode != BLAMPC_TRIGGER_NO_DEADZONE)
        mode = BLAMPC_DEFAULT_TRIGGER_MODE;
    trigger_mode[seat] = mode;
}
int blampc_live_input_trigger_mode(int seat) {
    return seat >= 0 && seat < 4 ? trigger_mode[seat] : BLAMPC_DEFAULT_TRIGGER_MODE;
}
static blampc_raw_pad raw_pad[4], raw_pad_read[4];
void blampc_raw_pad_note_read(int seat, const blampc_raw_pad *pad) {
    if (seat >= 0 && seat < 4 && pad) raw_pad[seat] = raw_pad_read[seat] = *pad;
}
void blampc_raw_pad_set(int seat, const blampc_raw_pad *pad) {
    if (seat >= 0 && seat < 4 && pad) raw_pad[seat] = *pad;
}
void blampc_raw_pad_get(int seat, blampc_raw_pad *out) {
    if (!out) return;
    if (seat >= 0 && seat < 4) *out = raw_pad[seat]; else memset(out, 0, sizeof(*out));
}
void blampc_raw_pad_get_read(int seat, blampc_raw_pad *out) {
    if (!out) return;
    if (seat >= 0 && seat < 4) *out = raw_pad_read[seat]; else memset(out, 0, sizeof(*out));
}
/* Sound diagnostics have no effect when their opt-in probes are disabled. */
void blampc_sound_drop_print(const char *tag, const char *stage) { (void)tag; (void)stage; }
void blampc_latency_print(void) { /* No rendered frames or live input samples. */ }
void blampc_perf_print(void) { /* Optional on-screen performance readout is disabled. */ }
void blampc_sound_cull_print(const char *tag, float distance, float obstruction, float occlusion) {
    (void)tag; (void)distance; (void)obstruction; (void)occlusion;
}
void blampc_sound_probe_print(const char *format, ...) { (void)format; }
void blampc_sound_note_propagation(int listener, int encoded, float propagation, float straight) {
    (void)listener; (void)encoded; (void)propagation; (void)straight;
}
void blampc_sound_watch_impulse(short channel, const char *name, short mode, const float *position,
    float fade, float gain, float minimum, float maximum) {
    (void)channel; (void)name; (void)mode; (void)position;
    (void)fade; (void)gain; (void)minimum; (void)maximum;
}
