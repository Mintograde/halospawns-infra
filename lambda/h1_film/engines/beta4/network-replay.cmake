option(H1_NETWORK_REPLAY_FIXES "Build candidate Beta 4 network replay corrections" OFF)

function(hs_beta4_network_replay_source name input output)
    set(content "${${input}}")
    if(H1_NETWORK_REPLAY_FIXES)
        if(name STREQUAL "game_engine_build_lighting.c")
            hs_beta4_replace(content "    if (global_variant.universal_variant.vehicle_set.__s1.preset != _game_engine_vehicles_none)"
                "    player_count = hs_film_lighting_players(player_count);\n\n    if (global_variant.universal_variant.vehicle_set.__s1.preset != _game_engine_vehicles_none)")
            string(PREPEND content "extern int hs_film_lighting_players(int);\n")
        elseif(name STREQUAL "player_spawn.c")
            hs_beta4_replace(content "    else if (game_connection() == _game_connection_network_client)"
                "    else if (game_connection() == _game_connection_network_client || blampc_film_network_playback())")
            string(PREPEND content "extern int blampc_film_network_playback(void);\n")
        elseif(EMSCRIPTEN AND name STREQUAL "effect_evaluate_function_integral.c")
            hs_beta4_replace(content "float effect_evaluate_function_integral(int16_t function, float fraction)"
                "double effect_evaluate_function_integral(int16_t function, float fraction)")
            hs_beta4_replace(content "return (fraction * fraction);"
                "return ((double)fraction * (double)fraction);")
            hs_beta4_replace(content "return (((float)2.0 - fraction) * fraction);"
                "return ((2.0 - (double)fraction) * (double)fraction);")
            hs_beta4_replace(content "return ((-(((fraction * 2.0f) - 3.0f) * fraction)) * fraction);"
                "return ((double)(-(((fraction * 2.0f) - 3.0f) * fraction)) * (double)fraction);")
        elseif(EMSCRIPTEN AND name STREQUAL "effect_generate_particles.c")
            hs_beta4_replace(content "extern float effect_evaluate_function_integral(int16_t function, float fraction);"
                "extern double effect_evaluate_function_integral(int16_t function, float fraction);")
            hs_beta4_replace(content "(int)(effect_evaluate_function_integral(count_function, fraction) * count_float)"
                "(int)(float)(effect_evaluate_function_integral(count_function, fraction) * count_float)")
            hs_beta4_replace(content "(int)(effect_evaluate_function_integral(count_function, last_event_fraction) * count_float)"
                "(int)(float)(effect_evaluate_function_integral(count_function, last_event_fraction) * count_float)")
        elseif(name STREQUAL "blampc_film.c")
            hs_beta4_replace(content "if (!g_film_network || physical < 4) return;" "if (!g_film_network) return;")
            hs_beta4_replace(content "    player->network_player_data.team_index = (char)player->team_index;"
                "    player->network_player_data.team_index = (char)player->team_index;\n    player->network_player_data.player_list_index = (char)player->team_index;")
            string(APPEND content "\nint hs_film_lighting_players(int fallback)\n{\n    return g_playing && g_film_network && (g_env.flags & BLAMPC_FILM_FLAG_UNIVERSAL)\n        ? (int)g_env.players : fallback;\n}\n")
        endif()
    endif()
    set(${output} "${content}" PARENT_SCOPE)
endfunction()
