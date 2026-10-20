#include "combat-hooks.h"
#include "headers/damage_data.h"
#include "headers/collision_result.h"
#include "headers/game_globals.h"
#include "headers/game_globals_grenade.h"
#include "headers/blampc_film_event.h"

extern int player_index_from_unit_index(int);
extern struct game_globals *global_game_globals;
extern void *datum_try_and_get(const data_array *, int);
extern unsigned char game_team_is_enemy(short, short);
extern void hs_original_weapon_trigger_fire(int, short);
extern unsigned char hs_original_projectile_new(int);
extern unsigned char hs_original_projectile_update(int);
extern void hs_original_projectile_collision(int, collision_result *, real_point3d *, real_vector3d *, float);
extern void hs_original_projectile_detonate(int, unsigned char, float);
extern int hs_original_effect_allocate(int, int, unsigned char);
extern void hs_original_effect_update(int, float);
extern void hs_original_unit_cause_player_melee_damage(int);
extern void hs_original_object_cause_damage(damage_data *, int, short, short, short, const real_vector3d *);
extern void hs_original_object_damage_aftermath(int, damage_data *, unsigned int, float, float, float, short, unsigned char);
extern void hs_original_game_statistics_record_kill(int, int, int, short);

typedef struct { unsigned int shot; int weapon, owner; } hs_lineage;
typedef struct { int handle; hs_lineage lineage; } hs_binding;
typedef struct { char path[241]; int category; } hs_weapon;
typedef struct { unsigned int id; int slot, weapon; } hs_shot;
typedef struct {
    hs_lineage lineage;
    int attacker, victim, relationship;
    double shield, health;
} hs_damage;
typedef struct {
    int kind, killer, victim, weapon, headshot, killer_present, victim_present;
    float killer_position[3], victim_position[3];
} hs_death;

static hs_lineage hs_current = {0, -1, -1};
static hs_binding hs_projectiles[65536], hs_effects[65536];
static hs_weapon hs_weapons[64];
static hs_shot hs_shots[256];
static hs_damage hs_damages[1024];
static hs_death hs_deaths[64];
static unsigned int hs_next_shot;
static int hs_weapon_count, hs_weapon_sent, hs_shot_count, hs_damage_count, hs_death_count;
static int hs_coverage[4], hs_awards[4][4], hs_award_eligible[4];
static int hs_headshot_target = -1, hs_aftermath_target = -1, hs_aftermath_headshot = -1;
static int hs_scoring_death;
static const damage_data *hs_aftermath_damage;
static hs_lineage hs_aftermath_lineage;
static const char *hs_categories[] = {"weapon", "grenade", "melee", "vehicle", "environment"};
static const char *hs_relationships[] = {"opponent", "friendly", "self", "environment", "unknown"};
static const char *hs_kinds[] = {"kill", "betrayal", "suicide", "environment", "unknown"};

static int hs_active(void)
{
    return game_engine && game_engine_globals.mode == game_engine_mode_active;
}

static int hs_slot(int handle)
{
    player_datum *value;
    if (handle == -1 || (unsigned short)handle >= 4 || !player_data) return -1;
    value = datum_try_and_get(player_data, handle);
    return value ? (unsigned short)handle : -1;
}

static void hs_missing(int section)
{
    if (hs_coverage[section] < 1) hs_coverage[section] = 1;
}

static int hs_catalogue(int definition, int category)
{
    int index;
    const char *path = global_tag_instances && definition != -1
        ? global_tag_instances[(unsigned short)definition].name : NULL;
    if (!path || !*path || strlen(path) > 240) return -1;
    for (index = 0; index < hs_weapon_count; ++index)
        if (hs_weapons[index].category == category && !strcmp(hs_weapons[index].path, path)) return index;
    if (hs_weapon_count == 64) {
        hs_coverage[0] = hs_coverage[1] = hs_coverage[2] = 2;
        return -1;
    }
    strcpy(hs_weapons[hs_weapon_count].path, path);
    hs_weapons[hs_weapon_count].category = category;
    return hs_weapon_count++;
}

static hs_lineage hs_bound(hs_binding *bindings, int handle)
{
    hs_lineage empty = {0, -1, -1};
    hs_binding *binding = &bindings[(unsigned short)handle];
    return handle != -1 && binding->handle == handle ? binding->lineage : empty;
}

void hs_combat_discharge(int weapon, int owner)
{
    object_header_datum *header = lookup(weapon, 2);
    int player = player_index_from_unit_index(owner), slot = hs_slot(player);
    hs_current = (hs_lineage){0, -1, player};
    if (!hs_active() || slot < 0) return;
    hs_current.weapon = header ? hs_catalogue(header->datum->definition_index, 0) : -1;
    if (hs_current.weapon < 0) { hs_missing(0); return; }
    hs_current.shot = ++hs_next_shot;
    if (hs_shot_count == 256) { hs_coverage[0] = 2; return; }
    hs_shots[hs_shot_count++] = (hs_shot){hs_current.shot, slot, hs_current.weapon};
}

void weapon_trigger_fire(int weapon, short trigger)
{
    hs_lineage previous = hs_current;
    hs_current = (hs_lineage){0, -1, -1};
    hs_original_weapon_trigger_fire(weapon, trigger);
    hs_current = previous;
}

unsigned char projectile_new(int handle)
{
    unsigned char result = hs_original_projectile_new(handle);
    object_header_datum *header = lookup(handle, 5);
    hs_lineage lineage = hs_current;
    if (result && header) {
        if (lineage.weapon < 0 && global_game_globals) {
            int index;
            const tag_block *block = &global_game_globals->grenades;
            const game_globals_grenade *grenades = block->address;
            if (block->count >= 0 && block->count <= 16 && grenades)
                for (index = 0; index < block->count; ++index)
                    if (grenades[index].projectile.index == header->datum->definition_index) {
                        lineage.weapon = hs_catalogue(header->datum->definition_index, 1);
                        lineage.owner = header->datum->object.owner_player_index;
                    }
        }
        hs_projectiles[(unsigned short)handle] = (hs_binding){handle, lineage};
    }
    return result;
}

unsigned char projectile_update(int handle)
{
    hs_lineage previous = hs_current;
    unsigned char result;
    hs_current = hs_bound(hs_projectiles, handle);
    result = hs_original_projectile_update(handle);
    hs_current = previous;
    return result;
}

void projectile_collision(int handle, collision_result *collision, real_point3d *position,
    real_vector3d *velocity, float remaining)
{
    hs_lineage previous = hs_current;
    hs_current = hs_bound(hs_projectiles, handle);
    hs_original_projectile_collision(handle, collision, position, velocity, remaining);
    hs_current = previous;
}

void projectile_detonate(int handle, unsigned char first, float remaining)
{
    hs_lineage previous = hs_current;
    hs_current = hs_bound(hs_projectiles, handle);
    hs_original_projectile_detonate(handle, first, remaining);
    hs_current = previous;
}

int effect_allocate(int definition, int owner, unsigned char deterministic)
{
    int handle = hs_original_effect_allocate(definition, owner, deterministic);
    if (handle != -1) hs_effects[(unsigned short)handle] = (hs_binding){handle, hs_current};
    return handle;
}

void effect_update(int handle, float elapsed)
{
    hs_lineage previous = hs_current;
    hs_current = hs_bound(hs_effects, handle);
    hs_original_effect_update(handle, elapsed);
    hs_current = previous;
}

void unit_cause_player_melee_damage(int unit)
{
    hs_lineage previous = hs_current;
    hs_current = (hs_lineage){0, -1, player_index_from_unit_index(unit)};
    hs_original_unit_cause_player_melee_damage(unit);
    hs_current = previous;
}

void hs_combat_melee(int definition)
{
    hs_current.weapon = hs_catalogue(definition, 2);
}

void object_cause_damage(damage_data *damage, int object, short node, short region,
    short material, const real_vector3d *normal)
{
    int previous = hs_headshot_target;
    hs_headshot_target = -1;
    hs_original_object_cause_damage(damage, object, node, region, material, normal);
    hs_headshot_target = previous;
}

void hs_combat_headshot(int object)
{
    hs_headshot_target = object;
}

static hs_lineage hs_damage_lineage(const damage_data *damage)
{
    hs_lineage lineage = hs_current;
    if (lineage.owner != damage->owner_player_index)
        lineage = (hs_lineage){0, -1, damage->owner_player_index};
    return lineage;
}

void hs_combat_applied(const void *event, int object, int actual,
    float shield_before, float shield_after, float shield_maximum,
    float health_before, float health_after, float health_maximum, int part)
{
    const damage_data *damage = event;
    int victim = hs_slot(player_index_from_unit_index(object)), attacker = hs_slot(damage->owner_player_index);
    int relationship = 4;
    double shield, health;
    hs_lineage lineage;
    (void)part;
    if (!hs_active() || victim < 0 || !actual) return;
    shield = fmax(0.0, (fmax(0.0, shield_before) - fmax(0.0, shield_after)) * shield_maximum);
    health = fmax(0.0, (fmax(0.0, health_before) - fmax(0.0, health_after)) * health_maximum);
    if (!isfinite(shield) || !isfinite(health)) hs_fail("invalid applied damage");
    if (shield == 0.0 && health == 0.0) return;
    lineage = hs_damage_lineage(damage);
    if (damage->owner_player_index == -1) relationship = 3;
    else if (attacker == victim) relationship = 2;
    else if (attacker >= 0) {
        const player_datum *player = datum_try_and_get(player_data, damage->owner_player_index);
        const player_datum *target = DATA_ARRAY_ELEMENT(player_data, player_datum, victim);
        relationship = game_team_is_enemy(player->team_index, target->team_index) ? 0 : 1;
    }
    if (relationship == 0 && lineage.weapon < 0) hs_missing(0);
    if (hs_damage_count == 1024) { hs_coverage[0] = hs_coverage[1] = 2; return; }
    hs_damages[hs_damage_count++] = (hs_damage){lineage, attacker, victim, relationship, shield, health};
}

void object_damage_aftermath(int object, damage_data *damage, unsigned int flags,
    float shield, float health, float multiplier, short part, unsigned char actual)
{
    const damage_data *previous_damage = hs_aftermath_damage;
    hs_lineage previous_lineage = hs_aftermath_lineage;
    int previous_target = hs_aftermath_target, previous_headshot = hs_aftermath_headshot;
    hs_aftermath_damage = damage;
    hs_aftermath_target = hs_slot(player_index_from_unit_index(object));
    hs_aftermath_lineage = hs_damage_lineage(damage);
    hs_aftermath_headshot = actual ? hs_headshot_target == object : -1;
    hs_original_object_damage_aftermath(object, damage, flags, shield, health, multiplier, part, actual);
    hs_aftermath_damage = previous_damage;
    hs_aftermath_lineage = previous_lineage;
    hs_aftermath_target = previous_target;
    hs_aftermath_headshot = previous_headshot;
}

static int hs_position(int handle, float *position)
{
    const player_datum *player = hs_slot(handle) >= 0 ? datum_try_and_get(player_data, handle) : NULL;
    object_header_datum *body = player ? lookup(player->unit_index != -1 ? player->unit_index : player->dead_unit_index, 0) : NULL;
    if (!body) return 0;
    memcpy(position, body->datum->object.position.n, 3 * sizeof(float));
    return 1;
}

void hs_combat_death(int kind, int killer, int victim)
{
    hs_death *death;
    int slot = hs_slot(victim);
    blampc_film_note_death(kind, killer, victim);
    if (!hs_active() || !hs_scoring_death || slot < 0) return;
    if (hs_death_count == 64) { hs_coverage[2] = 2; return; }
    death = &hs_deaths[hs_death_count++];
    memset(death, 0, sizeof(*death));
    death->kind = kind >= 0 && kind < 4 ? kind : 4;
    death->killer = hs_slot(killer);
    death->victim = slot;
    if (kind == 0 && death->killer >= 0) hs_award_eligible[death->killer] = 1;
    death->weapon = death->headshot = -1;
    death->killer_present = hs_position(killer, death->killer_position);
    death->victim_present = hs_position(victim, death->victim_position);
    if (hs_aftermath_damage && hs_aftermath_target == slot
        && hs_aftermath_damage->owner_player_index == killer) {
        death->weapon = hs_aftermath_lineage.weapon;
        if (kind == 0 && death->weapon >= 0) death->headshot = hs_aftermath_headshot;
    }
}

void game_statistics_record_kill(int object, int player, int owner, short team)
{
    int previous = hs_scoring_death;
    hs_scoring_death = 1;
    hs_original_game_statistics_record_kill(object, player, owner, team);
    hs_scoring_death = previous;
}

void hs_combat_kill(int killer, int victim, int spree)
{
    int slot = hs_slot(killer);
    blampc_pgcr_stats_note_kill(killer, victim, spree);
    if (hs_active() && slot >= 0 && spree > hs_awards[slot][0]) hs_awards[slot][0] = spree;
}

void hs_combat_multikill(int player, int tier)
{
    int slot = hs_slot(player);
    blampc_pgcr_stats_note_multikill(player, tier);
    if (slot >= 0 && (hs_active() || hs_award_eligible[slot]) && tier >= 2)
        ++hs_awards[slot][tier >= 4 ? 3 : tier - 1];
}

static void hs_optional_slot(const char *key, int slot)
{
    if (slot < 0) hs_null(key); else hs_int(key, slot);
}

static void hs_weapon_id(const char *key, int weapon)
{
    char identifier[16];
    if (weapon < 0) { hs_null(key); return; }
    sprintf_s(identifier, sizeof identifier, "w%d", weapon);
    hs_string(key, identifier);
}

static void hs_coordinates(const char *key, int present, const float *position)
{
    int index;
    if (!present) { hs_null(key); return; }
    hs_begin(key, 0);
    for (index = 0; index < 3; ++index) hs_float(NULL, position[index]);
    hs_end();
}

static void hs_combat_frame(int clock)
{
    int index;
    (void)clock;
    hs_begin("combat", 1);
    hs_string("schema", "halospawns.h1CombatSource.v1");
    hs_begin("coverage", 0);
    for (index = 0; index < 4; ++index) hs_int(NULL, hs_coverage[index]);
    hs_end();
    hs_begin("weapons", 0);
    for (; hs_weapon_sent < hs_weapon_count; ++hs_weapon_sent) {
        hs_begin(NULL, 1);
        hs_weapon_id("weapon_id", hs_weapon_sent);
        hs_string("tag_path", hs_weapons[hs_weapon_sent].path);
        hs_string("category", hs_categories[hs_weapons[hs_weapon_sent].category]);
        hs_end();
    }
    hs_end();
    hs_begin("shots", 0);
    for (index = 0; index < hs_shot_count; ++index) {
        hs_begin(NULL, 1);
        hs_uint("discharge_id", hs_shots[index].id);
        hs_int("slot_index", hs_shots[index].slot);
        hs_weapon_id("weapon_id", hs_shots[index].weapon);
        hs_end();
    }
    hs_end();
    hs_begin("damage", 0);
    for (index = 0; index < hs_damage_count; ++index) {
        const hs_damage *damage = &hs_damages[index];
        hs_begin(NULL, 1);
        if (damage->lineage.shot) hs_uint("discharge_id", damage->lineage.shot); else hs_null("discharge_id");
        hs_optional_slot("attacker_slot", damage->attacker);
        hs_int("victim_slot", damage->victim);
        hs_weapon_id("weapon_id", damage->lineage.weapon);
        hs_string("relationship", hs_relationships[damage->relationship]);
        hs_double("shield_damage", damage->shield);
        hs_double("health_damage", damage->health);
        hs_end();
    }
    hs_end();
    hs_begin("deaths", 0);
    for (index = 0; index < hs_death_count; ++index) {
        const hs_death *death = &hs_deaths[index];
        hs_begin(NULL, 1);
        hs_optional_slot("killer_slot", death->killer);
        hs_int("victim_slot", death->victim);
        hs_string("kind", hs_kinds[death->kind]);
        hs_weapon_id("weapon_id", death->weapon);
        if (death->headshot < 0) hs_null("headshot"); else hs_bool("headshot", death->headshot);
        hs_coordinates("killer_position", death->killer_present, death->killer_position);
        hs_coordinates("victim_position", death->victim_present, death->victim_position);
        hs_end();
    }
    hs_end();
    hs_begin("awards", 0);
    if (player_data && player_data->data)
        for (index = 0; index < player_data->count && index < 4; ++index) {
            const player_datum *player = DATA_ARRAY_ELEMENT(player_data, player_datum, index);
            if (!player->identifier) continue;
            hs_begin(NULL, 1);
            hs_int("slot_index", index);
            hs_int("longest_kill_streak", hs_awards[index][0]);
            hs_int("double_kills", hs_awards[index][1]);
            hs_int("triple_kills", hs_awards[index][2]);
            hs_int("overkills", hs_awards[index][3]);
            hs_end();
        }
    hs_end();
    hs_end();
    hs_shot_count = hs_damage_count = hs_death_count = 0;
    memset(hs_award_eligible, 0, sizeof hs_award_eligible);
}
