/* Ordered observations only. Never changes simulation state. Enabled only by a
 * new immutable exporter; retained combat and world bytes remain unchanged. */
extern int game_time_get(void);
extern int hs_original_universal_film_deal(const void *, int, int, short, short, short, const float *);
typedef struct {
    int kind, clock, slot, physical, victim, unit, weapon, relationship, headshot;
    unsigned int shot, deal;
    float before[2], after[2];
} hs_gameplay_event;
static hs_gameplay_event hs_gameplay_events[2048];
static int hs_gameplay_count;
static unsigned int hs_gameplay_deal, hs_gameplay_next_deal;

static hs_gameplay_event *hs_gameplay_add(int kind)
{
    hs_gameplay_event *e;
    if (hs_gameplay_count == 2048) hs_fail("gameplay event budget exceeded");
    e = &hs_gameplay_events[hs_gameplay_count++];
    memset(e, 0, sizeof *e);
    e->kind = kind; e->clock = game_time_get();
    e->slot = e->physical = e->victim = e->unit = e->weapon = -1;
    e->headshot = -1;
    return e;
}

int blampc_universal_film_deal(const void *bytes, int size, int object, short node,
    short region, short material, const float *normal)
{
    unsigned int previous = hs_gameplay_deal;
    const damage_data *damage = bytes;
    hs_gameplay_event *e = hs_gameplay_add(3);
    int result;
    if (size != sizeof(damage_data)) hs_fail("invalid gameplay network damage");
    hs_gameplay_deal = ++hs_gameplay_next_deal;
    e->deal = hs_gameplay_deal; e->unit = object;
    e->physical = damage->owner_player_index == -1 ? -1 : (unsigned short)damage->owner_player_index;
    e->slot = hs_slot(damage->owner_player_index);
    result = hs_original_universal_film_deal(bytes, size, object, node, region, material, normal);
    hs_gameplay_deal = previous;
    return result;
}

static void hs_gameplay_shot(int slot, int player, int weapon, unsigned int shot)
{
    hs_gameplay_event *e = hs_gameplay_add(0);
    e->slot = slot; e->physical = (unsigned short)player; e->weapon = weapon; e->shot = shot;
}

static void hs_gameplay_damage(int attacker, int victim, int object, const damage_data *damage,
    hs_lineage lineage, int relationship, float sb, float sa, float hb, float ha)
{
    hs_gameplay_event *e = hs_gameplay_add(1);
    e->slot = attacker; e->victim = victim; e->unit = object; e->weapon = lineage.weapon;
    e->physical = damage->owner_player_index == -1 ? -1 : (unsigned short)damage->owner_player_index;
    e->shot = lineage.shot; e->deal = hs_gameplay_deal; e->relationship = relationship;
    e->before[0] = sb; e->before[1] = hb; e->after[0] = sa; e->after[1] = ha;
}

static void hs_gameplay_death(const hs_death *death)
{
    hs_gameplay_event *e = hs_gameplay_add(2);
    e->slot = death->killer; e->victim = death->victim; e->weapon = death->weapon;
    e->relationship = death->kind; e->headshot = death->headshot;
}

static void hs_gameplay_frame(void)
{
    int i, j;
    hs_begin("gameplay", 1);
    hs_string("schema", "halospawns.h1GameplaySource.v1");
    hs_begin("events", 0);
    for (i = 0; i < hs_gameplay_count; ++i) {
        const hs_gameplay_event *e = &hs_gameplay_events[i];
        hs_begin(NULL, 1);
        hs_int("kind", e->kind); hs_int("clock", e->clock);
        hs_int("slot", e->slot); hs_int("physical", e->physical);
        hs_int("victim", e->victim); hs_int("unit", e->unit);
        hs_string("weapon", e->weapon < 0 ? NULL : hs_weapons[e->weapon].path);
        hs_uint("weapon_tag", e->weapon < 0 ? 0xffffffffu : (unsigned int)hs_weapons[e->weapon].definition);
        hs_uint("shot", e->shot); hs_uint("deal", e->deal);
        hs_int("relationship", e->relationship); hs_int("headshot", e->headshot);
        hs_begin("before", 0); for (j = 0; j < 2; ++j) hs_float(NULL, e->before[j]); hs_end();
        hs_begin("after", 0); for (j = 0; j < 2; ++j) hs_float(NULL, e->after[j]); hs_end();
        hs_end();
    }
    hs_end(); hs_end(); hs_gameplay_count = 0;
}
