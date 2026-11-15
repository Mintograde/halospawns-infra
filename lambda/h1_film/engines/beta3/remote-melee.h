/* A lower bound on the ORIGINAL timer still remaining at a damaging impact.
 * Take the minimum across every melee-capable weapon in the approved map: the
 * weapon can change between swing start and impact, so the damage tag alone
 * must never choose the animation. Reads only; no animation/RNG/world calls. */
#include "headers/cache_file_tags_globals.h"
#include "headers/weapon_definition.h"
#include "headers/animation_graph.h"
#include "headers/animation_graph_first_person_weapon_animations.h"
#include "headers/animation.h"
#include "headers/first_person_weapon_animation.h"
#include "headers/weapon_definition_flags.h"

static int hs_remote_melee_bound = -1;

static const void *hs_melee_tag(int handle, unsigned int group)
{
    const cache_file_tag_instance *tag;
    if (handle == -1 || !cache_file_globals.tags_header || !global_tag_instances
        || (unsigned short)handle >= cache_file_globals.tags_header->tag_count) return NULL;
    tag = &global_tag_instances[(unsigned short)handle];
    return tag->tag_index == handle && (unsigned int)tag->group_tag == group ? tag->base_address : NULL;
}

static int hs_remote_melee_recovery(void)
{
    int i, minimum = 0;
    if (hs_remote_melee_bound >= 0) return hs_remote_melee_bound;
    hs_remote_melee_bound = 0;
    if (!cache_file_globals.tags_header || !global_tag_instances) return 0;
    for (i = 0; i < cache_file_globals.tags_header->tag_count; ++i) {
        const cache_file_tag_instance *tag = &global_tag_instances[i];
        const weapon_definition *weapon;
        const animation_graph *graph;
        const animation_graph_first_person_weapon_animations *set;
        const animation *anim;
        int index, total, offset, adjusted, remaining;
        if ((unsigned int)tag->group_tag != 0x77656170u) continue; /* weap */
        weapon = (const weapon_definition *)tag->base_address;
        if (!weapon) return 0;
        if (weapon->weapon.flags & _weapon_definition_flag_prevents_melee_attack) continue;
        if (weapon->weapon.interface_definition.first_person_animations.index == -1) continue;
        graph = hs_melee_tag(weapon->weapon.interface_definition.first_person_animations.index, 0x616e7472u);
        if (!graph) return 0; /* antr */
        if (!graph->first_person_weapon_animations.count) continue;
        set = (const animation_graph_first_person_weapon_animations *)graph->first_person_weapon_animations.address;
        if (!set || set->animations.count <= _first_person_weapon_animation_melee) continue;
        if (!set->animations.address) return 0;
        index = ((const short *)set->animations.address)[_first_person_weapon_animation_melee];
        if (index == -1) continue;
        if (index < 0 || index >= graph->animations.count || !graph->animations.address) return 0;
        anim = &((const animation *)graph->animations.address)[index];
        total = anim->frame_count; offset = anim->private_key_frame_index;
        if (!total) continue; /* No timer, hence no damage-window execution. */
        if (total < 0 || total > 127 || offset < 0 || offset > 127) return 0;
        adjusted = total - (total >> 2);
        if (offset >= adjusted) return 0;
        /* The first decrement is the next 30 Hz phase. Damage happens BEFORE
         * its decrement, after offset earlier decrements. Expiry follows
         * adjusted - offset - 1 phases later. Equality never qualifies. */
        remaining = (adjusted - offset - 1) * 4;
        if (remaining <= 0) return 0;
        if (!minimum || remaining < minimum) minimum = remaining;
    }
    hs_remote_melee_bound = minimum;
    return minimum;
}
