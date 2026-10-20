#ifndef HS_COMBAT_HOOKS_H
#define HS_COMBAT_HOOKS_H
#include "headers/damage_data.h"
void object_cause_damage(damage_data *, int, short, short, short, const real_vector3d *);
void hs_combat_discharge(int weapon, int owner);
void hs_combat_melee(int definition);
void hs_combat_applied(const void *damage, int object, int actual,
    float shield_before, float shield_after, float shield_maximum,
    float health_before, float health_after, float health_maximum, int part);
void hs_combat_headshot(int object);
void hs_combat_death(int kind, int killer, int victim);
void hs_combat_kill(int killer, int victim, int spree);
void hs_combat_multikill(int player, int tier);
#endif
