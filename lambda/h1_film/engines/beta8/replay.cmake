function(hs_beta8_replace input anchor replacement)
    string(FIND "${${input}}" "${anchor}" first)
    string(FIND "${${input}}" "${anchor}" last REVERSE)
    if(first EQUAL -1 OR NOT first EQUAL last)
        message(FATAL_ERROR "Beta 8 replay anchor changed: ${anchor}")
    endif()
    string(REPLACE "${anchor}" "${replacement}" content "${${input}}")
    set(${input} "${content}" PARENT_SCOPE)
endfunction()

function(hs_beta8_replay_source name input output)
    set(content "${${input}}")
    if(name STREQUAL "blampc_film.c")
        string(APPEND content "\nint hs_film_export_tick(int fallback)\n{\n    return (g_env.flags & BLAMPC_FILM_FLAG_CLIENT_VIEW) ? (int)g_frames - 1 : fallback;\n}\n")
        string(APPEND content [=[

/* A host's initial RSTR stores the actual FFA team (network list index) of each
 * player. Local theater seats can have different indices after a lobby departure. */
int hs_film_initial_ffa_team(int player_index, int fallback)
{
    const unsigned int slot = (unsigned short)player_index;
    if (!g_film_network || g_film_client_view || !g_film_roster_loaded ||
        g_frames != 0 || slot >= g_film_roster.count)
        return fallback;
    const unsigned int team = g_film_roster.player[slot].team;
    return team < BLAMPC_FILM_ROSTER_SLOTS ? (int)team : fallback;
}

/* Only the first host spawn may have a recorded opening inventory. A later
 * respawn must use the variant, even if it reuses the same object-array slot. */
void hs_film_opening_grenades(int player_index, int unit_index, int *frags, int *plasmas,
                              int max_frags, int max_plasmas)
{
    const unsigned int slot = (unsigned short)player_index;
    if (!g_film_network || g_film_client_view || g_frames > 1 || game_time_get() != 0 ||
        slot >= BLAMPC_FILM_ROSTER_SLOTS || unit_index == -1)
        return;
    char key[64], trailing;
    unsigned int frag, plasma;
    snprintf(key, sizeof key, "H1_EXPORT_OPENING_GRENADES_%u_%08X", slot, (unsigned int)unit_index);
    const char *row = getenv(key);
    if (row && sscanf(row, "%u,%u%c", &frag, &plasma, &trailing) == 2 &&
        max_frags >= 0 && max_plasmas >= 0 && frag <= (unsigned int)max_frags &&
        plasma <= (unsigned int)max_plasmas)
    {
        *frags = (int)frag;
        *plasmas = (int)plasma;
    }
    fprintf(stderr, "[h1-opening] slot=%u unit=%08X grenades=%d,%d\n",
            slot, (unsigned int)unit_index, *frags, *plasmas);
}
]=])
    elseif(name STREQUAL "game_engine_postspawn_player_update.c")
        hs_beta8_replace(content "    unit->unit.grenade_counts[0] = (char)frag_count;"
            "    hs_film_opening_grenades(player_index, unit_index, &frag_count, &plasma_count, frag_maximum, plasma_maximum);\n    unit->unit.grenade_counts[0] = (char)frag_count;")
        string(PREPEND content "extern void hs_film_opening_grenades(int, int, int *, int *, int, int);\n")
    elseif(name STREQUAL "game_engine_player_added.c")
        hs_beta8_replace(content "char preferred_team = player->network_player_data.player_list_index;"
            "char preferred_team = (char)hs_film_initial_ffa_team(player_index, player->network_player_data.player_list_index);")
        string(PREPEND content "extern int hs_film_initial_ffa_team(int player_index, int fallback);\n")
    elseif(name STREQUAL "create_local_players.c")
        hs_beta8_replace(content "blampc_bots_create_players();" "blampc_bots_create_players();\n            hs_register_players();")
        string(PREPEND content "extern void hs_register_players(void);\n")
    elseif(name STREQUAL "blampc_film_join.c")
        hs_beta8_replace(content "    return seat < 0 ? BLAMPC_FILM_JOIN_REMOTE : seat;" "    hs_register_players();\n    return seat < 0 ? BLAMPC_FILM_JOIN_REMOTE : seat;")
        string(PREPEND content "extern void hs_register_players(void);\n")
    endif()
    set(${output} "${content}" PARENT_SCOPE)
endfunction()
