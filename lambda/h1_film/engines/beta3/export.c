/* Completed simulation state only: no render updates, RNG calls or world writes. */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <windows.h>
#include "headers/data_array.h"
#include "headers/object_header_datum.h"
#include "headers/player_datum.h"
#include "headers/biped_datum.h"
#include "headers/weapon_datum.h"
#include "headers/weapon_magazine_state.h"
#include "headers/first_person_weapon.h"
#include "headers/game_time_globals_struct.h"
#include "headers/game_time_constants.h"
#include "headers/cache_file_tag_instance.h"
#include "headers/real_matrix4x3.h"
#include "headers/game_variant.h"
#include "headers/game_engine.h"
#include "headers/game_engine_globals.h"
#include "headers/scenario.h"
#include "headers/scenario_player.h"
#include "headers/breakable_surface_globals.h"
#include "headers/observer_command.h"
#include "blampc_pgcr_stats.h"
#include "stream.h"

extern data_array *object_header_data;
extern data_array *player_data;
extern game_time_globals_struct *game_time_globals;
extern void first_person_camera_for_unit_and_vector(int, const real_vector3d *, observer_command *);

#include "roster.h"

/* Observe actual vitality removed, including self/environment damage. The original
 * PGCR hook still runs unchanged; a converter process plays exactly one match. */
void hs_note_damage(int attacker, int victim, int category, int part, float damage, const char *tag_name)
{
    int slot = hs_participant(victim);
    blampc_pgcr_stats_note_damage(attacker, victim, category, part, damage, tag_name);
    if (slot >= 0 && slot < H1_EXPORT_MAX_PLAYERS && damage > 0.0f) damage_received[slot] += damage;
}

static void reference(const char *key, int value)
{
    if (value == -1) hs_int(key, -1);
    else hs_uint(key, (unsigned int)value);
}

static unsigned int object_handle(int slot, const object_header_datum *header)
{
    return ((unsigned int)(unsigned short)header->identifier << 16) | (unsigned int)slot;
}

static object_header_datum *lookup(int reference, int type)
{
    int slot = (unsigned short)reference;
    object_header_datum *header;
    if (reference == -1 || !object_header_data || !object_header_data->data
        || slot >= object_header_data->count) return NULL;
    header = DATA_ARRAY_ELEMENT(object_header_data, object_header_datum, slot);
    if (!header->identifier || !header->datum || object_handle(slot, header) != (unsigned int)reference
        || (type >= 0 && header->type != type)) return NULL;
    return header;
}

static void tag(const char *key, int definition)
{
    const char *tag_name = global_tag_instances && definition != -1
        ? global_tag_instances[(unsigned short)definition].name : NULL;
    hs_string(key, tag_name);
}

static void name(const char *key, const wchar_t *wide)
{
    char utf8[49];
    int length = 0, bytes;
    while (length < 12 && wide[length]) ++length;
    bytes = length ? WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide, length,
                                         utf8, sizeof utf8 - 1, NULL, NULL) : 0;
    if (length && !bytes) hs_fail("invalid UTF-16 player name");
    utf8[bytes] = 0;
    hs_string(key, utf8);
}

static void vector(const char *x, const char *y, const char *z, const float *v)
{
    hs_float(x, v[0]); hs_float(y, v[1]); hs_float(z, v[2]);
}

static void object(int slot, const object_header_datum *header)
{
    const _object_datum *body = &header->datum->object;
    const int definition = header->datum->definition_index;
    const char *tag_name = global_tag_instances && definition != -1
        ? global_tag_instances[(unsigned short)definition].name : NULL;
#ifdef H1_FINITE_WORLD_OBJECTS
    if (header->type == 2 && body->parent_object_index == -1) {
        int component;
        for (component = 0; component < 3; ++component) {
            if (!isfinite(body->position.n[component]) || !isfinite(body->forward.n[component])
                || !isfinite(body->up.n[component])) return;
        }
    }
#endif
    hs_item(NULL);
    hs_byte(HS_WORLD_OBJECT);
    hs_u32(object_handle(slot, header));
    hs_u32((uint32_t)header->type);
    hs_text(tag_name ? tag_name : "");
    hs_raw_floats(body->position.n, 3);
    hs_raw_floats(body->forward.n, 3);
    hs_raw_floats(body->up.n, 3);
    hs_u32((uint32_t)body->parent_object_index);
    hs_u32((uint32_t)body->owner_object_index);
}

static void weapon(int reference)
{
    object_header_datum *header = lookup(reference, 2);
    hs_begin(NULL, 1);
    hs_uint("object_id", (unsigned int)reference);
    if (header) {
        const weapon_datum *w = (const weapon_datum *)header->datum;
        tag("tag_name", w->definition_index);
        hs_int("magazine_ammo_count", w->weapon.magazines[0].rounds_loaded);
        hs_int("backpack_ammo_count", w->weapon.magazines[0].rounds_total);
        hs_bool("reloading", w->weapon.magazines[0].state == _magazine_reloading);
        hs_int("reload_time", w->weapon.magazines[0].state_timer);
    }
    hs_end();
}

static void player(int slot, const player_datum *p)
{
    int body_reference = p->unit_index != -1 ? p->unit_index : p->dead_unit_index;
    object_header_datum *header = lookup(body_reference, 0);
    const biped_datum *b = header ? (const biped_datum *)header->datum : NULL;
    int i, player_handle = ((unsigned int)(unsigned short)p->identifier << 16) | slot;
    hs_begin(NULL, 1);
    int participant = hs_participant(player_handle);
    if (participant < 0) hs_fail("unknown player identity");
    hs_int("player_index", participant);
    name("name", p->name);
    hs_int("team", p->team_index);
    hs_int("local_player", p->local_player_index);
    hs_int("respawn_timer", p->respawn_timer);
    hs_int("kills", p->statistics.kills[0]);
    hs_int("deaths", p->statistics.deaths);
    hs_int("assists", p->statistics.assists[0]);
    hs_int("team_kills", p->statistics.friendly_fire_kills);
    hs_int("suicides", p->statistics.suicides);
    hs_int("shots_fired", hs_pgcr_value(participant, 0, blampc_pgcr_stats_shots_fired(slot)));
    hs_int("shots_hit", hs_pgcr_value(participant, 1, blampc_pgcr_stats_shots_hit(slot)));
    reference("object_ref", p->unit_index);
    reference("player_object_id", header ? body_reference : -1);
    if (game_engine && game_engine->get_score)
        hs_int("score", game_engine->get_score(player_handle, _get_score_individual));
    if (global_variant.game_engine_index == 1)
        hs_int("ctf_score", p->statistics.multiplayer_statistics.ctf_statistics.flag_scores);
    if (!b) {
        hs_null("player_object_data");
    } else {
        observer_command camera = {0};
        hs_begin("player_object_data", 1);
        int selected_weapon = -1, weapon_count = 0;
        for (i = 0; i < 4; ++i) {
            if (!lookup(b->unit.weapon_object_indices[i], 2)) continue;
            if (i == b->unit.current_weapon_index) selected_weapon = weapon_count;
            ++weapon_count;
        }
        hs_uint("object_id", (unsigned int)body_reference);
        hs_int("object_type", 0);
        tag("tag_name", b->definition_index);
        vector("x", "y", "z", b->object.position.n);
        vector("x_vel", "y_vel", "z_vel", b->object.translational_velocity.n);
        vector("aiming_vector_x", "aiming_vector_y", "aiming_vector_z", b->unit.aiming_vector.n);
        vector("xaim1", "yaim1", "zaim1", b->unit.aiming_vector.n);
        vector("looking_vector_x", "looking_vector_y", "looking_vector_z", b->unit.looking_vector.n);
        vector("object_up_x", "object_up_y", "object_up_z", b->object.up.n);
        /* The deterministic eye includes crouch and parent seats. Dead units can
         * have absent head markers, so leave their camera absent. */
        if (p->unit_index != -1 && b->object.body_vitality > 0.0f) {
            first_person_camera_for_unit_and_vector(body_reference, &b->unit.aiming_vector, &camera);
            vector("camera_x", "camera_y", "camera_z", camera.focus_position.n);
        }
        hs_float("health", b->object.body_vitality);
        hs_float("max_health", b->object.maximum_body_vitality);
        hs_float("shields", b->object.shield_vitality);
        hs_float("max_shields", b->object.maximum_shield_vitality);
        hs_float("move_forward", b->unit.throttle.n[0]);
        hs_float("move_left", b->unit.throttle.n[1]);
        hs_int("primary_nades", (unsigned char)b->unit.grenade_counts[0]);
        hs_int("secondary_nades", (unsigned char)b->unit.grenade_counts[1]);
        hs_int("selected_weapon_index", selected_weapon);
        hs_int("zoom_level", b->unit.current_zoom_level);
        hs_int("airborne_ticks", b->biped.airborne_ticks);
        hs_bool("airborne", b->biped.airborne_ticks > 0);
        hs_int("melee_animation_remaining", b->biped.player_melee_ticks);
        hs_begin("weapons", 0);
        for (i = 0; i < 4; ++i) {
            if (lookup(b->unit.weapon_object_indices[i], 2)) weapon(b->unit.weapon_object_indices[i]);
        }
        hs_end(); hs_end();
        {
            unsigned int bytes = (unsigned short)b->object.node_matrices.size;
            unsigned int offset = (unsigned short)b->object.node_matrices.offset;
            unsigned int count = bytes / sizeof(real_matrix4x3);
            const real_matrix4x3 *nodes = (const real_matrix4x3 *)((const char *)b + offset);
            if (count > 64 || bytes % sizeof(real_matrix4x3)
                || offset + bytes > (unsigned short)header->data_size)
                hs_fail("invalid model node block");
            hs_begin("model_nodes", 0);
            for (i = 0; i < (int)count; ++i) {
                hs_item(NULL);
                hs_byte(HS_MATRIX);
                hs_raw_floats(nodes[i].position.n, 3);
                hs_raw_floats(&nodes[i].scale, 1);
                hs_raw_floats(&nodes[i].n[0][0], 9);
            }
            hs_end();
        }
    }
    if (first_person_weapons && p->local_player_index >= 0 && p->local_player_index < 4) {
        const first_person_weapon *fp = &first_person_weapons[p->local_player_index];
        hs_begin("first_person_weapon", 1);
        reference("weapon_object", fp->weapon_index);
        reference("player_object", fp->unit_index);
        hs_int("state", fp->state);
        hs_int("animation_id", fp->state_animation.index);
        hs_int("animation_tick", fp->state_animation.frame_index);
        hs_float("firing_push_back", fp->firing_push_back);
        hs_end();
    }
    hs_end();
}

static void metadata(void)
{
    int i;
    hs_begin("game_meta", 1);
    hs_int("game_type", global_variant.game_engine_index);
    hs_bool("has_teams", global_variant.universal_variant.teams);
    hs_begin("players", 1);
    if (player_data && player_data->data) {
        for (i = 0; i < player_data->count; ++i) {
            char key[16];
            const player_datum *p = DATA_ARRAY_ELEMENT(player_data, player_datum, i);
            if (!p->identifier) continue;
            int participant = hs_participant(((unsigned int)(unsigned short)p->identifier << 16) | i);
            if (participant < 0) hs_fail("unknown player identity");
            sprintf_s(key, sizeof key, "%d", participant);
            hs_begin(key, 1);
            name("name", p->name);
            hs_int("team", p->team_index);
            hs_int("damage_dealt", hs_pgcr_value(participant, 2, blampc_pgcr_stats_damage_given_points(i)));
            hs_double("damage_received", damage_received[participant]);
            hs_int("camo_count", hs_pgcr_value(participant, 3, blampc_pgcr_stats_camo_pickups(i)));
            hs_int("overshield_count", hs_pgcr_value(participant, 4, blampc_pgcr_stats_overshield_pickups(i)));
            hs_end();
        }
    }
    hs_end(); hs_end();
}

static void spawns(void)
{
    int i;
    hs_begin("spawns", 0);
    if (global_scenario) {
        const tag_block *block = &global_scenario->players;
        const scenario_player *spawn = (const scenario_player *)block->address;
        if (block->count < 0 || block->count > 4096 || (block->count && !spawn))
            hs_fail("invalid scenario spawn block");
        for (i = 0; i < block->count; ++i) {
            int j;
            hs_item(NULL);
            hs_byte(HS_SPAWN);
            hs_u32((uint32_t)i);
            hs_raw_floats(spawn[i].position.n, 3);
            hs_raw_floats(&spawn[i].facing, 1);
            hs_u32((uint32_t)spawn[i].team_index);
            for (j = 0; j < 4; ++j) hs_u32((uint32_t)spawn[i].game_type[j]);
        }
    }
    hs_end();
}

static void network(void)
{
    int i;
    hs_begin("network_game_object", 1);
    hs_begin("network_game_data", 1);
    hs_begin("network_players", 0);
    if (player_data && player_data->data) {
        for (i = 0; i < player_data->count; ++i) {
            const player_datum *p = DATA_ARRAY_ELEMENT(player_data, player_datum, i);
            const network_player *n = &p->network_player_data;
            if (!p->identifier) continue;
            hs_begin(NULL, 1);
            hs_int("player_list_index", n->player_list_index);
            hs_int("machine_index", n->machine_index);
            hs_int("controller_index", n->controller_index);
            hs_int("team", n->team_index);
            hs_int("color", n->primary_color_index);
            hs_end();
        }
    }
    hs_end(); hs_end(); hs_end();
}

#ifdef H1_COMBAT_EXPORT
#include "combat.h"
#endif

void hs_export_tick(FILE *out, int frame)
{
    static int previous = -1, ended = 0;
    int i, tick = game_time_globals ? game_time_globals->local_time - 1 : -1;
    int now_ended = game_engine_globals.mode != game_engine_mode_active;
    char elapsed[32];
    (void)frame;
    if (tick < 0 || tick == previous) return;
    if (previous >= 0 && tick != previous + 1) hs_fail("simulation clock skipped a tick");
    previous = tick;
    hs_tick = tick;
    hs_begin(NULL, 1);
    hs_int("current_tick", tick);
    hs_double("current_game_time_seconds", (double)tick / TICKS_PER_SECOND);
    if (globals && global_scenario && global_scenario->structure_bsp_references.count == 1
        && global_structure_bsp_index == 0) {
        const unsigned char *flags = globals->breakable_surface_flags[0];
        /* Engine bits mean intact; the viewer snapshot uses one for broken. */
        unsigned int intact = (unsigned int)flags[0] | ((unsigned int)flags[1] << 8)
            | ((unsigned int)flags[2] << 16) | ((unsigned int)flags[3] << 24);
        hs_uint("broken_surfaces", ~intact);
    } else {
        hs_null("broken_surfaces");
    }
    hs_int("game_type", global_variant.game_engine_index);
    hs_bool("game_engine_has_teams", global_variant.universal_variant.teams);
    hs_bool("game_ended_this_tick", now_ended && !ended);
    ended = now_ended;
    hs_begin("game_time_info", 1);
    hs_int("game_time", tick);
    sprintf_s(elapsed, sizeof elapsed, "%d:%02d:%02d", tick / TICKS_PER_SECOND / 3600,
              tick / TICKS_PER_SECOND / 60 % 60, tick / TICKS_PER_SECOND % 60);
    hs_string("real_time_elapsed", elapsed);
    hs_end();
    hs_begin("players", 0);
    if (player_data && player_data->data) {
        for (i = 0; i < player_data->count; ++i) {
            const player_datum *p = DATA_ARRAY_ELEMENT(player_data, player_datum, i);
            if (p->identifier) player(i, p);
        }
    }
    hs_end();
    hs_begin("objects", 0);
    if (object_header_data && object_header_data->data) {
        for (i = 0; i < object_header_data->count; ++i) {
            const object_header_datum *header = DATA_ARRAY_ELEMENT(object_header_data, object_header_datum, i);
            if (header->identifier && header->datum) object(i, header);
        }
    }
    hs_end();
    metadata(); spawns(); network();
#ifdef H1_COMBAT_EXPORT
    hs_combat_frame(tick);
#endif
    hs_end();
    hs_flush_frame(out);
}
