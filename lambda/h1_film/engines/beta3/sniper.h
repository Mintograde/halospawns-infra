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

#ifdef H1_SNIPER_EVIDENCE
typedef struct { int clock, weapon, scope; hs_sniper_impact hit; } hs_sniper_contact;
static hs_sniper_contact hs_contacts[256];
static int hs_contact_count, hs_contact_capped;

static int hs_sniper_impact_of(hs_sniper_impact *out, const damage_data *damage, int object)
{
    int i;
    if (object == -1 || damage->definition_index == -1 || damage->owner_player_index == -1
        || damage->owner_object_index == -1 || (damage->flags & (1u << _damage_area_of_effect_bit))) return 0;
    for (i = 0; i < 3; ++i)
        if (!isfinite(damage->origin.n[i]) || !isfinite(damage->epicenter.n[i])
            || !isfinite(damage->direction.n[i])) return 0;
    if (!damage->direction.n[0] && !damage->direction.n[1] && !damage->direction.n[2]) return 0;
    out->tag = damage->definition_index;
    out->owner = damage->owner_player_index;
    out->shooter_body = damage->owner_object_index;
    out->struck = object;
    memcpy(out->vectors, damage->origin.n, 12);
    memcpy(out->vectors + 3, damage->epicenter.n, 12);
    memcpy(out->vectors + 6, damage->direction.n, 12);
    return 1;
}

static void hs_sniper_predicted(const damage_data *damage, int object)
{
    hs_sniper_impact hit;
    if (!hs_current.shot || hs_current.weapon < 0 || hs_current.owner != damage->owner_player_index
        || !hs_is_sniper(hs_weapons[hs_current.weapon].path) || !hs_sniper_impact_of(&hit, damage, object)) return;
    if (hs_contact_count == 256) { hs_contact_capped = 1; return; }
    hs_contacts[hs_contact_count++] = (hs_sniper_contact){game_time_get(),
        hs_weapons[hs_current.weapon].definition, hs_current.scope, hit};
}

static void hs_sniper_emit_impact(const hs_sniper_impact *hit)
{
    int i;
    hs_begin(NULL, 0);
    hs_uint(NULL, (unsigned int)hit->tag); hs_uint(NULL, (unsigned int)hit->owner);
    hs_uint(NULL, (unsigned int)hit->shooter_body); hs_int(NULL, hit->struck);
    for (i = 0; i < 9; ++i) hs_uint(NULL, hit->vectors[i]);
    hs_end();
}
#endif

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
        int kind = 1, definition;
#ifdef H1_SNIPER_EVIDENCE
        if (d->kind == 0 && d->weapon < 0 && d->excludes_sniper) {
            hs_begin(NULL, 0); hs_int(NULL, 3); hs_int(NULL, i);
            hs_int(NULL, d->killer); hs_int(NULL, d->victim); hs_end();
        }
#endif
#ifdef H1_SNIPER_DAMAGE_GRAPH
        if (d->recovered_sniper) { kind = 6; definition = d->recovered_definition; }
        else
#endif
        {
            if (d->kind != 0 || d->weapon < 0 || hs_weapons[d->weapon].category != 0
                || !hs_is_sniper(hs_weapons[d->weapon].path)) continue;
            definition = hs_weapons[d->weapon].definition;
        }
        hs_begin(NULL, 0); hs_int(NULL, kind); hs_int(NULL, i); hs_int(NULL, d->scope);
        hs_uint(NULL, d->deal); hs_uint(NULL, (unsigned int)definition);
        hs_int(NULL, d->physical); hs_int(NULL, d->object);
        hs_int(NULL, d->killer); hs_int(NULL, d->victim);
#ifdef H1_SNIPER_EVIDENCE
        if (d->direct_report) hs_sniper_emit_impact(&d->report);
#endif
        hs_end();
    }
#ifdef H1_SNIPER_EVIDENCE
    for (i = 0; i < hs_contact_count; ++i) {
        const hs_sniper_contact *s = &hs_contacts[i];
        hs_begin(NULL, 0); hs_int(NULL, 4); hs_int(NULL, s->clock);
        hs_uint(NULL, (unsigned int)s->weapon); hs_int(NULL, s->scope);
        hs_sniper_emit_impact(&s->hit); hs_end();
    }
    if (hs_contact_capped) { hs_begin(NULL, 0); hs_int(NULL, 5); hs_end(); }
    hs_contact_count = hs_contact_capped = 0;
#endif
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
