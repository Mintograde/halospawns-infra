int hs_film_initial_count(int fallback)
{
    int count = g_film_network ? (int)(g_env.reserved[1] & 255u) : fallback;
    if (count < 1 || count > BLAMPC_FILM_ROSTER_MAX) abort();
    return count;
}

void hs_film_initial_player(int handle)
{
    int physical = (unsigned short)handle, character;
    player_datum *player;
    if (!g_film_network || physical < 4) return;
    if (physical >= BLAMPC_FILM_ROSTER_MAX) abort();
    player = DATA_ARRAY_ELEMENT(player_data, player_datum, handle);
    player->team_index = (g_env.reserved[0] >> (physical * 4)) & 15u;
    player->network_player_data.team_index = (char)player->team_index;
    if (g_film_names_loaded) {
        for (character = 0; character < FILM_NAME_CHARS; ++character)
            player->name[character] = (wchar_t)g_film_names.name[physical][character];
        player->name[FILM_NAME_CHARS] = 0;
    }
}

int hs_film_creation_team(int handle, int fallback)
{
    const player_datum *player = DATA_ARRAY_ELEMENT(player_data, player_datum, handle);
    return g_film_network && player->local_player_index < 0 ? player->network_player_data.team_index : fallback;
}
