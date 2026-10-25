#define H1_DAMAGE_ATTRIBUTION 1
#define main hs_test_original_hooks
#include "combat-hooks.test.c"
#undef main

cache_file_tags_globals cache_file_globals;
static cache_file_tags_header damage_tags_header;
static cache_file_tag_instance damage_tags[32];
static weapon_definition damage_weapons[3];
static weapon_trigger_definition damage_triggers[3];
static projectile_definition damage_projectiles[3];
static effect_definition damage_effect;
static effect_event_definition damage_event;
static effect_part_definition damage_parts[3];
static projectile_material_response_definition damage_response;

static int damage_handle(int index) { return 0x10000 | index; }

static void damage_tag_set(int index, int group, void *address, char *name)
{
    damage_tags[index].tag_index = damage_handle(index);
    damage_tags[index].group_tag = group;
    damage_tags[index].base_address = address;
    damage_tags[index].name = name;
}

static void damage_reset_index(void)
{
    hs_damage_ready = hs_damage_complete = hs_damage_tag_count = 0;
    memset(hs_damage_sources, 0, sizeof hs_damage_sources);
}

static void damage_fixture(void)
{
    int index;
    static struct game_globals globals;
    static game_globals_grenade grenade;
    memset(damage_tags, 0, sizeof damage_tags);
    memset(damage_weapons, 0, sizeof damage_weapons);
    memset(damage_triggers, 0, sizeof damage_triggers);
    memset(damage_projectiles, 0, sizeof damage_projectiles);
    for (index = 0; index < 32; ++index)
        damage_tag_set(index, HS_DAMAGE_TAG, &damage_tags[index], "custom\\damage");
    for (index = 0; index < 3; ++index) {
        weapon_definition *weapon = &damage_weapons[index];
        projectile_definition *projectile = &damage_projectiles[index];
        damage_tag_set(index, HS_WEAPON_TAG, weapon, index == 0 ? "custom\\primary" : "custom\\secondary");
        damage_tag_set(index + 3, HS_PROJECTILE_TAG, projectile, "custom\\projectile");
        weapon->weapon.melee_attack_damage.index = damage_handle(15 + index);
        weapon->weapon.overheated_effect.index = weapon->weapon.detonation_effect.index = -1;
        weapon->weapon.triggers = (tag_block){1, &damage_triggers[index], NULL};
        damage_triggers[index].projectile.index = damage_handle(index + 3);
        damage_triggers[index].charging_effect.index = -1;
        projectile->projectile.impact_damage.index = damage_handle(index + 10);
        projectile->projectile.detonation_damage.index = -1;
        projectile->projectile.detonation_effect.index = -1;
        projectile->projectile.super_detonation_effect.index = -1;
        projectile->projectile.detonation_timer_started.index = -1;
    }
    damage_tags[2].group_tag = HS_DAMAGE_TAG;
    damage_tag_set(6, HS_EFFECT_TAG, &damage_effect, "custom\\effect");
    damage_effect.events = (tag_block){1, &damage_event, NULL};
    damage_event.parts = (tag_block){3, damage_parts, NULL};
    damage_parts[0].reference.index = damage_handle(13);
    damage_parts[1].reference.index = damage_handle(6);
    damage_parts[2].reference.index = damage_handle(14);
    damage_projectiles[2].projectile.detonation_effect.index = damage_handle(6);
    grenade.projectile.index = damage_handle(5);
    globals.grenades = (tag_block){1, &grenade, NULL};
    global_game_globals = &globals;
    damage_response.default_effect.index = damage_handle(18);
    damage_response.possible_response_effect.index = damage_handle(19);
    damage_response.detonation_effect.index = damage_handle(20);
    damage_projectiles[1].projectile.material_responses = (tag_block){1, &damage_response, NULL};
    damage_tags_header.tag_count = 32;
    cache_file_globals.tags_header = &damage_tags_header;
    global_tag_instances = damage_tags;
    hs_weapon_count = hs_weapon_sent = hs_damage_count = hs_death_count = hs_shot_count = 0;
    memset(hs_coverage, 0, sizeof hs_coverage);
    hs_current = (hs_lineage){0, -1, -1};
    damage_reset_index();
}

int main(void)
{
    int weapon, grenade, melee, index;
    damage_data damage = {0};
    hs_test_original_hooks();
    damage_fixture();
    weapon = hs_damage_weapon(damage_handle(10));
    assert(weapon >= 0 && hs_weapons[weapon].category == 0);
    assert(!strcmp(hs_weapons[weapon].path, "custom\\primary"));
    grenade = hs_damage_weapon(damage_handle(13));
    assert(grenade >= 0 && hs_weapons[grenade].category == 1);
    assert(hs_damage_weapon(damage_handle(12)) == grenade);
    assert(hs_damage_weapon(damage_handle(14)) == grenade);
    melee = hs_damage_weapon(damage_handle(15));
    assert(melee >= 0 && hs_weapons[melee].category == 2);
    for (index = 18; index <= 20; ++index)
        assert(hs_damage_weapon(damage_handle(index)) == hs_damage_weapon(damage_handle(11)));
    assert(hs_damage_weapon(damage_handle(25)) == -1);

    damage.owner_player_index = 0x10003;
    damage.definition_index = damage_handle(10);
    hs_combat_applied(&damage, 0x10000, 1, 3, 1, 70, 1, -5, 100, -1);
    assert(hs_damage_count == 1 && hs_damages[0].lineage.weapon == weapon);
    assert(hs_damages[0].attacker == 3 && hs_damages[0].victim == 0);
    assert(hs_damages[0].shield == 140 && hs_damages[0].health == 100);
    assert(hs_damages[0].lineage.shot == 0 && hs_shot_count == 0 && hs_coverage[0] == 1);
    hs_aftermath_damage = &damage;
    hs_aftermath_target = 0;
    hs_aftermath_lineage = hs_damage_lineage(&damage);
    hs_aftermath_headshot = 1;
    hs_scoring_death = 1;
    hs_combat_death(0, 0x10003, 0x10000);
    assert(hs_death_count == 1 && hs_deaths[0].weapon == weapon && hs_deaths[0].headshot == 1);
    damage.owner_player_index = -1;
    assert(hs_damage_lineage(&damage).weapon == -1);

    damage_triggers[1].projectile.index = damage_handle(3);
    damage_reset_index();
    assert(hs_damage_weapon(damage_handle(10)) == -1);
    assert(hs_damage_weapon(damage_handle(13)) == grenade);
    damage.owner_player_index = 0x10003;
    hs_current = (hs_lineage){42, weapon, damage.owner_player_index};
    assert(hs_damage_lineage(&damage).weapon == weapon && hs_damage_lineage(&damage).shot == 42);
    damage.owner_player_index = 0x10002;
    assert(hs_damage_lineage(&damage).weapon == -1 && hs_damage_lineage(&damage).shot == 0);

    damage_fixture();
    assert(hs_damage_weapon(0x2000a) == -1);
    damage_reset_index();
    damage_triggers[0].projectile.index = damage_handle(100);
    assert(hs_damage_weapon(damage_handle(13)) == -1);
    damage_fixture();
    damage_event.parts.count = 1025;
    assert(hs_damage_weapon(damage_handle(10)) == -1);
    damage_event.parts.count = 3;
    damage_fixture();
    damage_weapons[1].weapon.triggers.address = NULL;
    assert(hs_damage_weapon(damage_handle(10)) == -1);
    damage_fixture();
    damage_tags_header.tag_count = 65537;
    assert(hs_damage_weapon(damage_handle(10)) == -1);
    puts("damage attribution: remote vitality/deaths, tag graphs, ambiguity, cycles, bounds and shot isolation passed");
    return 0;
}
