#include "headers/cache_file_tags_globals.h"
#include "headers/weapon_definition.h"
#include "headers/weapon_trigger_definition.h"
#include "headers/trigger_firing_effect.h"
#include "headers/projectile_definition.h"
#include "headers/projectile_material_response_definition.h"
#include "headers/effect_definition.h"
#include "headers/effect_event_definition.h"
#include "headers/effect_part_definition.h"

enum { HS_DAMAGE_TAG = 0x6a707421, HS_EFFECT_TAG = 0x65666665,
    HS_PROJECTILE_TAG = 0x70726f6a, HS_WEAPON_TAG = 0x77656170 };

typedef struct { int definition, category, status; } hs_damage_source;
static hs_damage_source hs_damage_sources[65536];
static unsigned int hs_damage_visited[65536], hs_damage_visit;
static int hs_damage_ready, hs_damage_complete, hs_damage_tag_count, hs_damage_budget;

static const cache_file_tag_instance *hs_damage_tag(int handle)
{
    const cache_file_tag_instance *tag;
    if (handle == -1) return NULL;
    if ((unsigned short)handle >= hs_damage_tag_count) {
        hs_damage_complete = 0;
        return NULL;
    }
    tag = &global_tag_instances[(unsigned short)handle];
    if (tag->tag_index != handle || !tag->base_address) {
        hs_damage_complete = 0;
        return NULL;
    }
    return tag;
}

static int hs_damage_block(const tag_block *block)
{
    if (block->count < 0 || block->count > 1024 || (block->count && !block->address)) {
        hs_damage_complete = 0;
        return 0;
    }
    return block->count;
}

static void hs_damage_bind(int damage, int definition, int category)
{
    hs_damage_source *source = &hs_damage_sources[(unsigned short)damage];
    if (!source->status) *source = (hs_damage_source){definition, category, 1};
    else if (source->definition != definition || source->category != category) source->status = 2;
}

static void hs_damage_walk(int handle, int definition, int category, int depth)
{
    const cache_file_tag_instance *tag = hs_damage_tag(handle);
    int index;
    if (!tag) return;
    if (hs_damage_visited[(unsigned short)handle] == hs_damage_visit) return;
    if (depth > 32 || --hs_damage_budget < 0) { hs_damage_complete = 0; return; }
    hs_damage_visited[(unsigned short)handle] = hs_damage_visit;
    if (tag->group_tag == HS_DAMAGE_TAG) {
        hs_damage_bind(handle, definition, category);
    } else if (tag->group_tag == HS_EFFECT_TAG) {
        const effect_definition *effect = tag->base_address;
        for (index = 0; index < hs_damage_block(&effect->events); ++index) {
            const effect_event_definition *event = &((const effect_event_definition *)effect->events.address)[index];
            int part;
            for (part = 0; part < hs_damage_block(&event->parts); ++part) {
                const effect_part_definition *entry = &((const effect_part_definition *)event->parts.address)[part];
                hs_damage_walk(entry->reference.index, definition, category, depth + 1);
            }
        }
    } else if (tag->group_tag == HS_PROJECTILE_TAG) {
        const projectile_definition *projectile = tag->base_address;
        hs_damage_walk(projectile->projectile.impact_damage.index, definition, category, depth + 1);
        hs_damage_walk(projectile->projectile.detonation_damage.index, definition, category, depth + 1);
        hs_damage_walk(projectile->projectile.detonation_effect.index, definition, category, depth + 1);
        hs_damage_walk(projectile->projectile.super_detonation_effect.index, definition, category, depth + 1);
        hs_damage_walk(projectile->projectile.detonation_timer_started.index, definition, category, depth + 1);
        for (index = 0; index < hs_damage_block(&projectile->projectile.material_responses); ++index) {
            const projectile_material_response_definition *response =
                &((const projectile_material_response_definition *)projectile->projectile.material_responses.address)[index];
            hs_damage_walk(response->default_effect.index, definition, category, depth + 1);
            hs_damage_walk(response->possible_response_effect.index, definition, category, depth + 1);
            hs_damage_walk(response->detonation_effect.index, definition, category, depth + 1);
        }
    }
}

static void hs_damage_root(int handle, int definition, int category)
{
    ++hs_damage_visit;
    hs_damage_budget = 4096;
    hs_damage_walk(handle, definition, category, 0);
}

static void hs_damage_index(void)
{
    int index;
    hs_damage_ready = 1;
    if (!global_tag_instances || !cache_file_globals.tags_header) return;
    hs_damage_tag_count = cache_file_globals.tags_header->tag_count;
    if (hs_damage_tag_count <= 0 || hs_damage_tag_count > 65536) return;
    hs_damage_complete = 1;
    for (index = 0; index < hs_damage_tag_count; ++index) {
        const cache_file_tag_instance *tag = &global_tag_instances[index];
        const weapon_definition *weapon;
        int trigger;
        if (tag->group_tag != HS_WEAPON_TAG) continue;
        if (!hs_damage_tag(tag->tag_index)) continue;
        weapon = tag->base_address;
        hs_damage_root(weapon->weapon.melee_attack_damage.index, weapon->weapon.melee_attack_damage.index, 2);
        hs_damage_root(weapon->weapon.overheated_effect.index, tag->tag_index, 0);
        hs_damage_root(weapon->weapon.detonation_effect.index, tag->tag_index, 0);
        for (trigger = 0; trigger < hs_damage_block(&weapon->weapon.triggers); ++trigger) {
            const weapon_trigger_definition *entry = &((const weapon_trigger_definition *)weapon->weapon.triggers.address)[trigger];
            int firing;
            hs_damage_root(entry->projectile.index, tag->tag_index, 0);
            hs_damage_root(entry->charging_effect.index, tag->tag_index, 0);
            for (firing = 0; firing < hs_damage_block(&entry->firing_effects); ++firing) {
                const trigger_firing_effect *effect = &((const trigger_firing_effect *)entry->firing_effects.address)[firing];
                int state;
                for (state = 0; state < 3; ++state) {
                    hs_damage_root(effect->effects[state].index, tag->tag_index, 0);
                    hs_damage_root(effect->damage_effects[state].index, tag->tag_index, 0);
                }
            }
        }
    }
    if (global_game_globals) {
        const tag_block *block = &global_game_globals->grenades;
        for (index = 0; index < hs_damage_block(block); ++index) {
            const game_globals_grenade *grenade = &((const game_globals_grenade *)block->address)[index];
            hs_damage_root(grenade->projectile.index, grenade->projectile.index, 1);
        }
    }
}

static int hs_damage_weapon(int damage)
{
    const hs_damage_source *source;
    const cache_file_tag_instance *tag;
    if (!hs_damage_ready) hs_damage_index();
    if (!hs_damage_complete) return -1;
    tag = hs_damage_tag(damage);
    if (!tag || tag->group_tag != HS_DAMAGE_TAG) return -1;
    source = &hs_damage_sources[(unsigned short)damage];
    return source->status == 1 ? hs_catalogue(source->definition, source->category) : -1;
}
