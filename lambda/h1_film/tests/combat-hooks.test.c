#include <assert.h>
#define H1_COMBAT_EXPORT 1
#include "../engines/beta3/export.c"

static player_datum test_players[4];
static object_header_datum test_headers[8];
static object_datum test_objects[8];
static cache_file_tag_instance test_tags[3];
static data_array test_player_array, test_object_array;
data_array *player_data = &test_player_array;
data_array *object_header_data = &test_object_array;
game_time_globals_struct *game_time_globals;
game_engine_globals_t game_engine_globals;
struct game_engine *game_engine = (struct game_engine *)1;
cache_file_tag_instance *global_tag_instances = test_tags;
struct game_globals *global_game_globals;

void *datum_try_and_get(const data_array *array, int handle)
{
    int slot = (unsigned short)handle;
    player_datum *player;
    if (handle == -1 || slot >= array->count) return NULL;
    player = DATA_ARRAY_ELEMENT(array, player_datum, slot);
    return (unsigned short)(handle >> 16) == (unsigned short)player->identifier ? player : NULL;
}

int player_index_from_unit_index(int object)
{
    int slot;
    for (slot = 0; slot < 4; ++slot)
        if (test_players[slot].unit_index == object) return 0x10000 | slot;
    return -1;
}

unsigned char game_team_is_enemy(short team, short other) { return team != other; }
void blampc_film_note_death(int kind, int killer, int victim) { (void)kind; (void)killer; (void)victim; }
void blampc_pgcr_stats_note_kill(int killer, int victim, int spree) { (void)killer; (void)victim; (void)spree; }
void blampc_pgcr_stats_note_multikill(int player, int tier) { (void)player; (void)tier; }
unsigned char hs_original_projectile_new(int handle) { (void)handle; return 1; }
int hs_original_effect_allocate(int definition, int owner, unsigned char deterministic)
{
    (void)definition; (void)owner; (void)deterministic;
    return 0x10001;
}

int main(void)
{
    int index;
    damage_data damage = {0};
    struct game_globals globals = {0};
    game_globals_grenade grenade = {0};
    hs_lineage first;
    test_player_array.count = 4;
    test_player_array.size = sizeof(player_datum);
    test_player_array.data = test_players;
    test_object_array.count = 8;
    test_object_array.size = sizeof(object_header_datum);
    test_object_array.data = test_headers;
    game_engine_globals.mode = game_engine_mode_active;
    test_tags[0].name = "weapons\\pistol\\pistol";
    test_tags[1].name = "weapons\\rocket launcher\\rocket launcher";
    for (index = 0; index < 8; ++index) {
        test_headers[index].identifier = 1;
        test_headers[index].datum = &test_objects[index];
        test_headers[index].type = index < 4 ? 0 : index == 4 ? 2 : 5;
        test_objects[index].definition_index = 0;
        test_objects[index].object.position.n[0] = index;
    }
    for (index = 0; index < 4; ++index) {
        test_players[index].identifier = 1;
        test_players[index].unit_index = 0x10000 | index;
        test_players[index].dead_unit_index = -1;
        test_players[index].team_index = index < 2 ? 0 : 1;
    }
    hs_combat_discharge(0x10004, 0x10000);
    first = hs_current;
    assert(hs_shot_count == 1 && first.shot == 1 && first.weapon == 0);
    projectile_new(0x10005);
    projectile_new(0x10006);
    effect_allocate(0, 0x10000, 1);
    assert(hs_bound(hs_projectiles, 0x10005).shot == first.shot);
    assert(hs_bound(hs_projectiles, 0x10006).shot == first.shot);
    assert(hs_bound(hs_effects, 0x10001).shot == first.shot);
    assert(hs_bound(hs_projectiles, 0x20005).weapon == -1);
    test_objects[4].definition_index = 1;
    hs_combat_discharge(0x10004, 0x10000);
    assert(hs_current.weapon == 1 && hs_current.shot == 2);
    hs_current = hs_bound(hs_projectiles, 0x10005);
    damage.owner_player_index = 0x10000;
    hs_combat_applied(&damage, 0x10002, 1, 3.0f, 1.0f, 70.0f, 1.0f, -5.0f, 100.0f, 2);
    assert(hs_damage_count == 1);
    assert(hs_damages[0].lineage.weapon == 0 && hs_damages[0].lineage.shot == 1);
    assert(hs_damages[0].shield == 140.0 && hs_damages[0].health == 100.0);
    assert(hs_damages[0].relationship == 0);
    hs_combat_applied(&damage, 0x10002, 1, 1.0f, 3.0f, 70.0f, -1.0f, -5.0f, 100.0f, -1);
    hs_combat_applied(&damage, 0x10002, 0, 1.0f, 0.0f, 70.0f, 1.0f, 0.0f, 100.0f, -1);
    assert(hs_damage_count == 1);
    hs_combat_applied(&damage, 0x10001, 1, 1, 0, 1, 1, 1, 1, -1);
    assert(hs_damages[1].relationship == 1);
    hs_combat_applied(&damage, 0x10000, 1, 1, 0, 1, 1, 1, 1, -1);
    assert(hs_damages[2].relationship == 2);
    damage.owner_player_index = -1;
    hs_combat_applied(&damage, 0x10002, 1, 1, 0, 1, 1, 1, 1, -1);
    assert(hs_damages[3].relationship == 3 && hs_damages[3].lineage.weapon == -1);
    damage.owner_player_index = 0x10000;
    hs_aftermath_damage = &damage;
    hs_aftermath_target = 2;
    hs_aftermath_lineage = first;
    hs_aftermath_headshot = 1;
    hs_combat_death(0, 0x10000, 0x10002);
    assert(hs_death_count == 0);
    hs_scoring_death = 1;
    hs_combat_death(0, 0x10000, 0x10002);
    assert(hs_deaths[0].weapon == 0 && hs_deaths[0].headshot == 1);
    assert(hs_deaths[0].killer_position[0] == 0 && hs_deaths[0].victim_position[0] == 2);
    hs_combat_death(0, 0x10001, 0x10002);
    assert(hs_deaths[1].weapon == -1 && hs_deaths[1].headshot == -1);
    hs_combat_kill(0x10000, 0x10002, 5);
    hs_combat_multikill(0x10000, 2);
    hs_combat_multikill(0x10000, 3);
    hs_combat_multikill(0x10000, 4);
    hs_combat_multikill(0x10000, 5);
    assert(hs_awards[0][0] == 5 && hs_awards[0][1] == 1 && hs_awards[0][2] == 1 && hs_awards[0][3] == 2);
    test_tags[2].name = "weapons\\frag grenade\\frag grenade";
    grenade.projectile.index = 2;
    globals.grenades.count = 1;
    globals.grenades.address = &grenade;
    global_game_globals = &globals;
    test_objects[7].definition_index = 2;
    test_objects[7].object.owner_player_index = 0x10000;
    hs_current = (hs_lineage){0, -1, -1};
    projectile_new(0x10007);
    assert(hs_bound(hs_projectiles, 0x10007).owner == 0x10000);
    assert(hs_weapons[hs_bound(hs_projectiles, 0x10007).weapon].category == 1);
    assert(hs_bound(hs_projectiles, 0x10007).shot == 0);
    hs_combat_melee(0);
    assert(hs_weapons[hs_current.weapon].category == 2 && hs_current.shot == 0);
    game_engine_globals.mode = -1;
    hs_combat_applied(&damage, 0x10002, 1, 1, 0, 1, 1, 0, 1, -1);
    hs_combat_death(0, 0x10000, 0x10002);
    assert(hs_damage_count == 4 && hs_death_count == 2);
    hs_combat_multikill(0x10000, 2);
    hs_combat_multikill(0x10002, 2);
    assert(hs_awards[0][1] == 2 && hs_awards[2][1] == 0);
    game_engine_globals.mode = game_engine_mode_active;
    hs_shot_count = 256;
    hs_combat_discharge(0x10004, 0x10000);
    assert(hs_coverage[0] == 2 && hs_shot_count == 256);
    hs_damage_count = 1024;
    hs_combat_applied(&damage, 0x10002, 1, 1, 0, 1, 1, 0, 1, -1);
    assert(hs_coverage[1] == 2 && hs_damage_count == 1024);
    hs_death_count = 64;
    hs_combat_death(0, 0x10000, 0x10002);
    assert(hs_coverage[2] == 2 && hs_death_count == 64);
    hs_weapon_count = 64;
    assert(hs_catalogue(2, 0) == -1);
    puts("combat hook lineage, applied vitality, callbacks, awards and boundaries passed");
    return 0;
}
