/* Private shot-time observations. The public combat death and the replay
 * state keep their existing encoding. A zero scope means unknown. */
extern int game_time_get(void);
static struct hs_sniper_fire { int clock, physical, tag, scope; } hs_sniper_fires[256];
static int hs_sniper_count;

static int hs_is_sniper(const char *path)
{
    const char *expected = "weapons/sniper rifle/sniper rifle";
    if (!path) return 0;
    while (*path && *expected) {
        int c = *path++;
        if (c == '\\') c = '/';
        if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
        if (c != *expected++) return 0;
    }
    return !*path && !*expected;
}

static int hs_sniper_discharge(object_header_datum *weapon, int owner, int player)
{
    int tag, zoom, scope;
    object_header_datum *body;
    const player_datum *shooter;
    if (!weapon || player == -1 || !global_tag_instances || !player_data) return 0;
    tag = weapon->datum->definition_index;
    if (tag == -1 || !hs_is_sniper(global_tag_instances[(unsigned short)tag].name)) return 0;
    body = lookup(owner, 0);
    shooter = datum_try_and_get(player_data, player);
    if (!body || !shooter || shooter->unit_index != owner) return 0;
    zoom = (signed char)((const biped_datum *)body->datum)->unit.current_zoom_level;
    scope = zoom == -1 ? 1 : zoom >= 0 ? 2 : 0;
    /* Film playback assigns virtual seats. The physical player index survives
     * playback and identifies the original shooter in the client's account. */
    if (hs_sniper_count == 256) hs_fail("sniper discharge frame limit");
    hs_sniper_fires[hs_sniper_count++] = (struct hs_sniper_fire){
        game_time_get(), (unsigned short)player, tag, scope};
    return scope;
}

static void hs_sniper_frame(void)
{
    int i;
    hs_begin("sniper_events", 0);
    for (i = 0; i < hs_sniper_count; ++i) {
        const struct hs_sniper_fire *s = &hs_sniper_fires[i];
        hs_begin(NULL, 0); hs_int(NULL, 0); hs_int(NULL, s->clock);
        hs_int(NULL, s->physical); hs_uint(NULL, (unsigned int)s->tag);
        hs_int(NULL, s->scope); hs_end();
    }
    hs_sniper_count = 0;
    for (i = 0; i < hs_death_count; ++i) {
        const hs_death *d = &hs_deaths[i];
        if (d->kind != 0 || d->weapon < 0 || hs_weapons[d->weapon].category != 0
            || !hs_is_sniper(hs_weapons[d->weapon].path)) continue;
        hs_begin(NULL, 0); hs_int(NULL, 1); hs_int(NULL, i); hs_int(NULL, d->scope);
        hs_uint(NULL, d->deal); hs_uint(NULL, (unsigned int)hs_weapons[d->weapon].definition);
        hs_int(NULL, d->physical); hs_int(NULL, d->object);
        hs_int(NULL, d->killer); hs_int(NULL, d->victim); hs_end();
    }
#ifdef H1_GAMEPLAY_EXPORT
    for (i = 0; i < hs_gameplay_count; ++i) {
        const hs_gameplay_event *e = &hs_gameplay_events[i];
        if (e->kind != 3) continue;
        hs_begin(NULL, 0); hs_int(NULL, 2); hs_int(NULL, e->clock);
        hs_uint(NULL, e->deal); hs_int(NULL, e->physical); hs_int(NULL, e->unit); hs_end();
    }
#endif
    hs_end();
}
