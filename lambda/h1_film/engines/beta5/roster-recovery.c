/* Exporter 12: bounded worker-derived FNET evidence, never a film rewrite.
 * The worker validates the entire recording and freezes this evidence in the
 * job. All original seed/hash/network application checks remain authoritative. */
static unsigned int hs_recovery_count;
static unsigned int hs_recovery_handles[16], hs_recovery_teams[16];

static unsigned int hs_recovery_number(const char **cursor, int final)
{
    unsigned int value = 0;
    const char *end = *cursor;
    if (**cursor < '0' || **cursor > '9') abort();
    while (*end >= '0' && *end <= '9') {
        unsigned int digit = (unsigned int)(*end++ - '0');
        if (value > (0xffffffffu - digit) / 10u) abort();
        value = value * 10u + digit;
    }
    if (end == *cursor || (final ? *end != 0 : *end != ',')) abort();
    *cursor = final ? end : end + 1;
    return value;
}

static unsigned int hs_initial_team(int physical)
{
    if (hs_recovery_count && physical >= 8 && physical < (int)hs_recovery_count)
        return hs_recovery_teams[physical];
    if (physical < 0 || physical >= BLAMPC_FILM_ROSTER_MAX) abort();
    return (g_env.reserved[0] >> (physical * 4)) & 15u;
}

static void hs_load_roster_recovery(void)
{
    const char *text = getenv("H1_ROSTER_RECOVERY");
    unsigned int count, seen = 0, i;
    hs_recovery_count = 0;
    if (!text || !*text) return;
    if (strlen(text) > 200 || g_env.format != 2 || g_env.proto_revision != 9818
        || (g_env.flags & 10u) != 10u || (g_env.flags & 64u)
        || g_env.first_update != 0 || g_env.players != 1
        || (g_env.reserved[1] & 255u) != 8 || g_env.names_size != 196
        || g_env.net_reserved[0] != 0) abort();
    count = hs_recovery_number(&text, 0);
    if (count <= 8 || count > 16) abort();
    for (i = 0; i < count; ++i) {
        unsigned int team;
        if (i < 8) team = hs_initial_team((int)i);
        else {
            hs_recovery_handles[i] = hs_recovery_number(&text, 0);
            if ((hs_recovery_handles[i] & 65535u) != i || (hs_recovery_handles[i] >> 16) == 0) abort();
            team = hs_recovery_number(&text, i == count - 1);
        }
        if (team > 15 || (seen & (1u << team))) abort();
        seen |= 1u << team;
        hs_recovery_teams[i] = team;
    }
    hs_recovery_count = count;
    g_env.reserved[1] = (g_env.reserved[1] & ~255u) | count;
    log_info("[roster-recovery] initial players 8 -> %u; missing names remain unknown\n", count);
}
