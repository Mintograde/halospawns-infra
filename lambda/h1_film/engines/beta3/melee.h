/* Private observations. Full object handles distinguish respawns/slot reuse.
 * Network DEALs deliberately have no local action identity: their original
 * client timer is not established by the host's predicted animation. */
typedef struct { int unit; unsigned int id; } hs_melee_action;
static hs_melee_action hs_melee_actions[65536];
static unsigned int hs_melee_next, hs_melee_current;
static int hs_melee_backwhack_target = -1, hs_melee_aftermath_object = -1;
extern int hs_original_unit_throw_grenade_begin(int, const real_vector2d *);

void hs_melee_begin(int unit, int frames, int phase)
{
    int player = player_index_from_unit_index(unit), slot = hs_slot(player);
    hs_gameplay_event *e;
    if (!hs_active() || slot < 0) return;
    if (phase != 4) hs_fail("unsupported melee timer phase");
    /* A weapon may have no first-person melee animation. Do not reject its
     * replay or reuse an older swing's identity when no timer can be proven. */
    if (frames <= 0 || frames > 127) {
        hs_melee_actions[(unsigned short)unit] = (hs_melee_action){unit, 0};
        return;
    }
    e = hs_gameplay_add(4);
    e->slot = slot; e->physical = (unsigned short)player; e->unit = unit;
    e->melee = ++hs_melee_next;
    /* First decrement is the NEXT phase tick. On the decrement to zero the
     * start arm cannot run; the next source tick is the first normal restart. */
    e->ready_clock = e->clock - e->clock % phase + frames * phase + 1;
    hs_melee_actions[(unsigned short)unit] = (hs_melee_action){unit, e->melee};
}

void hs_melee_backwhack(int object)
{
    hs_melee_backwhack_target = object;
}

int unit_throw_grenade_begin(int unit, const real_vector2d *alignment)
{
    const object_header_datum *header = lookup(unit, 0);
    const biped_datum *biped = header ? (const biped_datum *)header->datum : NULL;
    hs_melee_action action = hs_melee_actions[(unsigned short)unit];
    int cancelled = biped && biped->biped.player_melee_ticks > 0 && action.unit == unit && action.id;
    int result = hs_original_unit_throw_grenade_begin(unit, alignment);
    if (result && cancelled && hs_active()) {
        hs_gameplay_event *e = hs_gameplay_add(5);
        e->slot = hs_slot(player_index_from_unit_index(unit));
        e->unit = unit; e->melee = action.id;
    }
    return result;
}
