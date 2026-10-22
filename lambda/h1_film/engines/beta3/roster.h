#ifndef H1_EXPORT_MAX_PLAYERS
#define H1_EXPORT_MAX_PLAYERS 4
#endif

static double damage_received[H1_EXPORT_MAX_PLAYERS];

#if H1_EXPORT_MAX_PLAYERS > 4
static unsigned int hs_roster_handles[H1_EXPORT_MAX_PLAYERS];
static int hs_roster_count;
static int hs_pgcr_baselines[H1_EXPORT_MAX_PLAYERS][5];

void hs_register_players(void)
{
    int physical, participant;
    if (!player_data || !player_data->data) return;
    for (physical = 0; physical < player_data->count; ++physical) {
        const player_datum *player = DATA_ARRAY_ELEMENT(player_data, player_datum, physical);
        unsigned int handle;
        if (!player->identifier) continue;
        if (physical >= H1_EXPORT_MAX_PLAYERS) hs_fail("player slot exceeds exporter limit");
        handle = ((unsigned int)(unsigned short)player->identifier << 16) | (unsigned int)physical;
        for (participant = 0; participant < hs_roster_count; ++participant)
            if (hs_roster_handles[participant] == handle) break;
        if (participant < hs_roster_count) continue;
        if (hs_roster_count == H1_EXPORT_MAX_PLAYERS) hs_fail("participant roster exceeds exporter limit");
        hs_roster_handles[hs_roster_count++] = handle;
        hs_pgcr_baselines[participant][0] = blampc_pgcr_stats_shots_fired(physical);
        hs_pgcr_baselines[participant][1] = blampc_pgcr_stats_shots_hit(physical);
        hs_pgcr_baselines[participant][2] = blampc_pgcr_stats_damage_given_points(physical);
        hs_pgcr_baselines[participant][3] = blampc_pgcr_stats_camo_pickups(physical);
        hs_pgcr_baselines[participant][4] = blampc_pgcr_stats_overshield_pickups(physical);
    }
}

static int hs_participant(int handle)
{
    int participant;
    if (handle == -1) return -1;
    hs_register_players();
    for (participant = 0; participant < hs_roster_count; ++participant)
        if (hs_roster_handles[participant] == (unsigned int)handle) return participant;
    return -1;
}

static int hs_pgcr_value(int participant, int metric, int value)
{
    if (participant < 0 || participant >= hs_roster_count) hs_fail("unknown player identity");
    return value - hs_pgcr_baselines[participant][metric];
}
#else
static int hs_participant(int handle)
{
    return handle == -1 || (unsigned short)handle >= H1_EXPORT_MAX_PLAYERS ? -1 : (unsigned short)handle;
}

static int hs_pgcr_value(int participant, int metric, int value)
{
    (void)participant;
    (void)metric;
    return value;
}
#endif
