/* Copy observations only: never call a rating function or consume randomness. */
#define HS_SPAWN_POINTS 4096
#define HS_SPAWN_EVENTS 64
typedef struct {
    int slot, unit, index, count, rated;
    float ratings[HS_SPAWN_POINTS];
} hs_spawn_event;
static hs_spawn_event hs_spawn_pending, hs_spawn_events[HS_SPAWN_EVENTS];
static int hs_spawn_player = -1, hs_spawn_seen, hs_spawn_count;

void hs_spawn_begin(int player, int count)
{
    hs_spawn_player = player;
    hs_spawn_pending.count = count;
    hs_spawn_pending.rated = count > 0 && count <= HS_SPAWN_POINTS;
    hs_spawn_seen = 0;
}

void hs_spawn_rating(int player, int index, float rating)
{
    if (player != hs_spawn_player || index != hs_spawn_seen || !isfinite(rating))
        hs_spawn_pending.rated = 0;
    if (hs_spawn_pending.rated && index >= 0 && index < hs_spawn_pending.count)
        hs_spawn_pending.ratings[index] = rating;
    ++hs_spawn_seen;
}

void hs_spawn_success(int player, int unit, int index, int selected)
{
    hs_spawn_event *e;
    if (hs_spawn_count == HS_SPAWN_EVENTS) hs_fail("spawn event budget exceeded");
    e = &hs_spawn_events[hs_spawn_count++];
    e->slot = hs_participant(player);
    if (e->slot < 0) hs_fail("spawn participant is unknown");
    e->unit = unit; e->index = index;
    e->rated = selected && player == hs_spawn_player && hs_spawn_pending.rated
        && hs_spawn_seen == hs_spawn_pending.count && index >= 0
        && index < hs_spawn_pending.count;
    e->count = e->rated ? hs_spawn_pending.count : 0;
    if (e->rated) memcpy(e->ratings, hs_spawn_pending.ratings, e->count * sizeof(float));
    hs_spawn_player = -1;
}

static void hs_spawn_frame(void)
{
    int i, j;
    hs_begin("spawn_events", 0);
    for (i = 0; i < hs_spawn_count; ++i) {
        const hs_spawn_event *e = &hs_spawn_events[i];
        hs_begin(NULL, 1);
        hs_int("slot_index", e->slot);
        hs_uint("unit_handle", (unsigned int)e->unit);
        hs_int("spawn_index", e->index);
        if (!e->rated) hs_null("ratings");
        else {
            hs_begin("ratings", 0);
            for (j = 0; j < e->count; ++j) hs_float(NULL, e->ratings[j]);
            hs_end();
        }
        hs_end();
    }
    hs_end();
    hs_spawn_count = 0;
}
