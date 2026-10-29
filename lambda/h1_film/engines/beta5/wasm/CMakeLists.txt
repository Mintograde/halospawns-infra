cmake_minimum_required(VERSION 3.20)
project(h1_film_wasm C)

if(NOT EMSCRIPTEN OR NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
    message(FATAL_ERROR "Build with the pinned Emscripten wasm32 toolchain")
endif()
if(NOT IS_DIRECTORY "${H1_SOURCE}/engine")
    message(FATAL_ERROR "Pass -DH1_SOURCE=<Performance Build source>")
endif()
set(CMAKE_C_STANDARD 17)
option(H1_COMBAT_EXPORT "Build candidate combat hooks" OFF)
option(H1_DAMAGE_ATTRIBUTION "Resolve untracked damage through map tag references" OFF)
option(H1_FINITE_WORLD_OBJECTS "Omit loose weapon objects with non-finite transforms" OFF)
if(H1_FINITE_WORLD_OBJECTS)
    add_compile_definitions(H1_FINITE_WORLD_OBJECTS=1)
endif()
if(H1_DAMAGE_ATTRIBUTION)
    if(NOT H1_COMBAT_EXPORT)
        message(FATAL_ERROR "Damage attribution requires combat export")
    endif()
    add_compile_definitions(H1_DAMAGE_ATTRIBUTION=1)
endif()
include("${CMAKE_CURRENT_SOURCE_DIR}/../../beta3/combat.cmake")
include("${CMAKE_CURRENT_SOURCE_DIR}/../replay.cmake")
include("${CMAKE_CURRENT_SOURCE_DIR}/../network-replay.cmake")
add_compile_definitions(H1_EXPORT_MAX_PLAYERS=16)
if(H1_COMBAT_EXPORT)
    add_compile_definitions(H1_COMBAT_EXPORT=1)
endif()
set(H1_BETA3_PORT "${CMAKE_CURRENT_SOURCE_DIR}/../../beta3/wasm")
include_directories(BEFORE "${CMAKE_CURRENT_SOURCE_DIR}/include")
include("${CMAKE_CURRENT_SOURCE_DIR}/prepare.cmake")
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
function(write_if_changed path content)
    if(EXISTS "${path}")
        file(READ "${path}" previous)
        if(previous STREQUAL content)
            return()
        endif()
    endif()
    file(WRITE "${path}" "${content}")
endfunction()
file(GLOB engine_sources "${H1_SOURCE}/engine/blam/*.c" "${H1_SOURCE}/engine/data/*.c")
file(READ "${H1_SOURCE}/CMakeLists.txt" upstream_cmake)
string(REGEX MATCH "set\\(SABER_EXCLUDED[^)]*\\)" excluded "${upstream_cmake}")
string(REGEX MATCHALL "[A-Za-z0-9_]+\\.c" excluded "${excluded}")
foreach(name IN LISTS excluded)
    list(REMOVE_ITEM engine_sources "${H1_SOURCE}/engine/blam/${name}")
endforeach()

# Adapt only CRT declarations and diagnostics in generated translation units.
# The original source mount stays read-only.
set(ported_sources)
foreach(source IN LISTS engine_sources)
    file(READ "${source}" original)
    set(ported "${original}")
    get_filename_component(name "${source}" NAME)
    if(name STREQUAL "create_local_players.c" OR name STREQUAL "game_engine_player_added.c")
        hs_beta5_replay_source("${name}" ported ported)
    endif()
    hs_beta5_network_replay_source("${name}" ported ported)
    if(H1_COMBAT_EXPORT)
        hs_combat_patch("${source}" ported ported)
    endif()
    if(name STREQUAL "hud_messaging_update.c")
        string(REGEX REPLACE "extern void[ \t]+qsort\\([^;]+;" "" ported "${ported}")
    endif()
    # Old-style empty parameter lists hide conflicting return types from wasm-ld.
    string(REGEX REPLACE "([A-Za-z_][A-Za-z0-9_]*)\\(\\)([ \t\r\n]*\\{)" "\\1(void)\\2" ported "${ported}")
    # MSVC's long double is binary64, unlike Clang's wasm32 long double.
    string(REPLACE "long double" "double" ported "${ported}")
    # Return addresses are used only by disabled native diagnostic probes.
    string(REPLACE "_ReturnAddress()" "((void *)0)" ported "${ported}")
    string(REPLACE "extern void object_new_by_name(" "extern int object_new_by_name(" ported "${ported}")
    string(REPLACE "extern void game_engine_playlist_initialize(" "extern int game_engine_playlist_initialize(" ported "${ported}")
    string(REPLACE "extern void actor_action_handle_vehicle_entry(" "extern int actor_action_handle_vehicle_entry(" ported "${ported}")
    string(REPLACE "extern int game_engine_post_rasterize_post_game(" "extern void game_engine_post_rasterize_post_game(" ported "${ported}")
    string(REPLACE "extern void hcex_pix_end_event(" "extern int hcex_pix_end_event(" ported "${ported}")
    string(REPLACE "extern void hcex_obj_clear(" "extern int hcex_obj_clear(" ported "${ported}")
    string(REPLACE "extern void motion_sensor_tick(" "extern int motion_sensor_tick(" ported "${ported}")
    string(REPLACE "extern void game_engine_post_rasterize(" "extern int game_engine_post_rasterize(" ported "${ported}")
    string(REPLACE "extern void physics_variable_speed_update_seek(" "extern int physics_variable_speed_update_seek(" ported "${ported}")
    string(REPLACE "extern void playlist_profile_create_default_profiles_on_disk(" "extern int playlist_profile_create_default_profiles_on_disk(" ported "${ported}")
    if(source MATCHES "/game_engine_post_rasterize\\.c$")
        string(REPLACE "return game_engine_post_rasterize_post_game();" "game_engine_post_rasterize_post_game(); return 0;" ported "${ported}")
        string(REPLACE "extern int game_engine_post_rasterize_in_game(" "extern void game_engine_post_rasterize_in_game(" ported "${ported}")
        string(REPLACE "return game_engine_post_rasterize_in_game();" "{ game_engine_post_rasterize_in_game(); return 0; }" ported "${ported}")
    endif()
    if(source MATCHES "/king_engine_update\\.c$")
        string(REPLACE "extern int king_calculate_hill_state(" "extern void king_calculate_hill_state(" ported "${ported}")
        string(REPLACE "return king_calculate_hill_state();" "{ king_calculate_hill_state(); return 0; }" ported "${ported}")
    endif()
    if(source MATCHES "/hud_draw_screen\\.c$")
        string(REPLACE "extern int rasterizer_hud_" "extern void rasterizer_hud_" ported "${ported}")
        string(REPLACE "return rasterizer_hud_end();" "{ rasterizer_hud_end(); return 0; }" ported "${ported}")
    endif()
    if(source MATCHES "/main_loop_update\\.c$")
        string(REPLACE "hcex_pix_begin_event" "hs_pix_begin_event_timed" ported "${ported}")
    endif()
    if(source MATCHES "/cache_file_windows_thread_proc\\.c$")
        string(REPLACE "    while (1)\n    {\n        /* 192" "    {\n        /* 192" ported "${ported}")
        string(REPLACE "        while (WaitForSingleObjectEx(cache_file_globals_0.sleep_event, 0xFFFFFFFF, 1) == 192)\n            ;" "        /* Called synchronously when a request is submitted. */" ported "${ported}")
    endif()
    if(source MATCHES "/firing_position_pre_evaluate\\.c$")
        string(REPLACE "extern unsigned char pre_evaluator_global;" "#include <stdlib.h>\n#define pre_evaluator_global (fprintf(stderr, \"Unsupported native code/data alias in AI pre-evaluation\\n\"), abort(), 0)" ported "${ported}")
    endif()
    if(source MATCHES "/_rasterizer_decals_update_function_pointers\\.c$")
        string(REPLACE "extern void (*rasterizer_decal_vertices_purge_proc)(int);" "extern void rasterizer_decal_vertices_purge_proc(int);" ported "${ported}")
        string(REPLACE "extern unsigned char (*rasterizer_decal_vertices_locked_proc)(int);" "extern unsigned char rasterizer_decal_vertices_locked_proc(int);" ported "${ported}")
    endif()
    string(REPLACE "\"headers/FCOLOR.h\"" "\"headers/fcolor.h\"" ported "${ported}")
    if(source MATCHES "/(csstrcasecmp|ustrnupr|ustrnlwr)\\.c$")
        string(REPLACE "towlower" "hs_towlower16" ported "${ported}")
        string(REPLACE "towupper" "hs_towupper16" ported "${ported}")
    endif()
    if(source MATCHES "/uisspace\\.c$")
        string(REPLACE "iswctype" "hs_iswctype16" ported "${ported}")
    endif()
    if(source MATCHES "/game_engine_replicate_game_state_to_new_client\\.c$")
        string(REPLACE "extern int _message_delta_mode_stateless;" "" ported "${ported}")
        string(PREPEND ported "#include \"headers/message_delta_processor_mode.h\"\n")
    endif()
    if(ported MATCHES "_iobuf")
        string(REPLACE "typedef struct _iobuf _iobuf;" "" ported "${ported}")
        string(REPLACE "struct _iobuf" "FILE" ported "${ported}")
        string(REPLACE "_iobuf" "FILE" ported "${ported}")
        string(REGEX REPLACE "__iob_func\\(\\)[ \t]*\\+[ \t]*1" "stdout" ported "${ported}")
        string(REGEX REPLACE "__iob_func\\(\\)[ \t]*\\+[ \t]*2" "stderr" ported "${ported}")
        string(REPLACE "__iob_func()" "stdin" ported "${ported}")
        string(PREPEND ported "#include <stdio.h>\n")
    endif()
    string(REGEX REPLACE "extern[ \t]+[^;{}\n]*[ *](memcpy|memset|memmove|memcmp|strlen|strnlen|strcpy|strncpy|strcat|strncat|strcmp|strncmp|strchr|fopen|fclose|fwrite|fprintf|_snprintf|_vsnprintf|vsnprintf|wcslen|_localtime32|strftime)[ \t]*\\([^;{}]*\\)[ \t]*;" "/* CRT declaration supplied by the port prelude. */" ported "${ported}")
    string(REPLACE "_D3DFORMAT_storage rasterizer_bitmap_format_table[19]" "_D3DFORMAT rasterizer_bitmap_format_table[19]" ported "${ported}")
    if(NOT original STREQUAL ported)
        file(RELATIVE_PATH relative "${H1_SOURCE}/engine" "${source}")
        get_filename_component(parent "${CMAKE_CURRENT_BINARY_DIR}/ported/${relative}" DIRECTORY)
        file(MAKE_DIRECTORY "${parent}")
        write_if_changed("${CMAKE_CURRENT_BINARY_DIR}/ported/${relative}" "${ported}")
        list(APPEND ported_sources "${CMAKE_CURRENT_BINARY_DIR}/ported/${relative}")
    else()
        list(APPEND ported_sources "${source}")
    endif()
endforeach()
set(engine_sources "${ported_sources}")

add_compile_options(-O2 -g -fms-extensions -fshort-wchar -fno-strict-aliasing
    -ffp-contract=off -fno-fast-math -fno-builtin
    -Wno-ignored-attributes -Wno-microsoft -Wno-incompatible-pointer-types
    -Wno-int-conversion -Wno-deprecated-non-prototype -Wno-visibility
    "-include${CMAKE_CURRENT_SOURCE_DIR}/prelude.h")
include_directories("${H1_BETA3_PORT}/include" "${H1_SOURCE}/engine"
    "${H1_SOURCE}/engine/data"
    "${H1_SOURCE}/engine/headers" "${H1_SOURCE}/host/compat" "${H1_SOURCE}/host"
    "${H1_SOURCE}/host/stubs")
add_compile_definitions(BLAMPC_LOCAL_2V2 BLAMPC_TICK_RATE=120)
foreach(name IN ITEMS wcslen wcsnlen wcscpy wcsncpy wcscat wcsncat wcscmp wcsncmp wcschr wcsrchr wcsstr)
    add_compile_definitions(${name}=hs_${name})
endforeach()
add_library(blam STATIC ${engine_sources})
foreach(source IN LISTS engine_sources)
    if(source MATCHES "/object_cause_damage\\.c$")
        set_property(SOURCE "${source}" APPEND PROPERTY COMPILE_DEFINITIONS blampc_pgcr_stats_note_damage=hs_note_damage)
    endif()
endforeach()

file(READ "${H1_SOURCE}/host/blampc_film.c" film_source)
hs_beta5_replay_source(blampc_film.c film_source film_source)
hs_beta5_network_replay_source(blampc_film.c film_source film_source)
file(READ "${H1_SOURCE}/host/blampc_film_join.c" join_source)
hs_beta5_replay_source(blampc_film_join.c join_source join_source)
write_if_changed("${CMAKE_CURRENT_BINARY_DIR}/film_join.c" "${join_source}")
foreach(anchor IN ITEMS "film_pad_load(g_file, &g_env);" "if (g_kf_failed || !film_keyframe_open())")
    string(FIND "${film_source}" "${anchor}" first)
    string(FIND "${film_source}" "${anchor}" last REVERSE)
    if(first EQUAL -1 OR NOT first EQUAL last)
        message(FATAL_ERROR "Unrecognized film source: ${anchor}")
    endif()
endforeach()
string(REPLACE "film_pad_load(g_file, &g_env);" "/* No presentation pad cache. */" film_source "${film_source}")
string(REPLACE "if (g_kf_failed || !film_keyframe_open())" "if (1 /* No native snapshots. */)" film_source "${film_source}")
string(REGEX REPLACE "static void film_kf_head_now\\(film_kf_head \\*h\\)[\r\n]+\\{[^}]*\\}" "static void film_kf_head_now(film_kf_head *h) { (void)h; abort(); }" film_source "${film_source}")
write_if_changed("${CMAKE_CURRENT_BINARY_DIR}/film_sequential.c" "${film_source}")

file(READ "${H1_SOURCE}/host/main.c" main_source)
string(REPLACE "classic Blam, 32-bit x86 host" "classic Blam, wasm32 headless host" main_source "${main_source}")
string(REPLACE "__asm { fnstsw sw }" "/* WASM has no x87 register stack. */" main_source "${main_source}")
string(REPLACE "__asm { fclex }" "/* WASM floating-point operations do not expose exception flags. */" main_source "${main_source}")
string(REGEX REPLACE "extern unsigned long[^;]*GetTickCount\\(void\\);" "" main_source "${main_source}")
string(REGEX REPLACE "extern void[^;]*Sleep\\(unsigned long[^;]*;" "" main_source "${main_source}")
write_if_changed("${CMAKE_CURRENT_BINARY_DIR}/main_headless.c" "${main_source}")
include("${H1_BETA3_PORT}/stub-signatures.cmake")
file(READ "${H1_SOURCE}/host/stubs/blampc_platform.c" platform_source)
string(REPLACE "void STRONG_ASSERT_DUMMY_Crash(void)" "void STRONG_ASSERT_DUMMY_Crash(void *unused, const char *message, const char *file, int line, const char *info)" platform_source "${platform_source}")
string(REPLACE "blampc_stub_hit(\"STRONG_ASSERT_DUMMY_Crash (ASSERTION)\");" "blampc_stub_hit(\"STRONG_ASSERT_DUMMY_Crash (ASSERTION)\"); abort();" platform_source "${platform_source}")
string(REPLACE "blampc_stub_hit(\"apDumpNoMemLeft (ALLOCATION FAILURE)\");" "blampc_stub_hit(\"apDumpNoMemLeft (ALLOCATION FAILURE)\"); abort();" platform_source "${platform_source}")
write_if_changed("${CMAKE_CURRENT_BINARY_DIR}/platform_buffers.c" "${platform_source}")
file(READ "${H1_SOURCE}/host/blampc_snapshot.c" snapshot_source)
string(REPLACE "extern lights_globals_t lights_globals;" "/* Declared by lights_globals.h. */" snapshot_source "${snapshot_source}")
write_if_changed("${CMAKE_CURRENT_BINARY_DIR}/snapshot.c" "${snapshot_source}")
file(READ "${H1_SOURCE}/host/blampc_rollback.c" rollback_source)
string(REPLACE "extern lights_globals_t lights_globals;" "/* Declared by lights_globals.h. */" rollback_source "${rollback_source}")
write_if_changed("${CMAKE_CURRENT_BINARY_DIR}/rollback.c" "${rollback_source}")
set(host_sources blampc_base_collision.c blampc_bot_names.c blampc_bot_settings.c blampc_bot_view.c blampc_config_fill.c blampc_crouch_slide_anim.c blampc_decal_vertices.c blampc_film_client.c blampc_film_clientview.c blampc_film_effects.c blampc_film_layers.c blampc_film_ledger.c blampc_film_link.c blampc_film_pairtime.c blampc_film_shotmarks.c blampc_film_viewswitch.c blampc_fpw_sway_interp.c blampc_hud_layout.c blampc_particle_interp.c blampc_vehicle_at.c blampc_wall_kick.c blampc_world_ping.c
    blampc_hs_mcc.c blampc_net_projectile_sync.c blampc_config.c blampc_gametype.c blampc_colors.c
    blampc_statehash.c blampc_pgcr_stats.c blampc_pgcr_rows.c blampc_teams.c
    blampc_playernames.c blampc_tuning.c blampc_hill_order.c blampc_camo_drop.c
    blampc_overshield.c blampc_shield_up.c blampc_os_assassination.c
    blampc_plasma_climb.c blampc_world_owner.c
    blampc_graphics_detail.c blampc_msgdelta_table.c
    blampc_envq.c blampc_db_variants.c blampc_fireteam.c blampc_hit_at.c
    blampc_interp.c blampc_place.c blampc_ray_sweep.c blampc_sweep_test.c blampc_shotdelay.c
    blampc_stats.c blampc_spawn_odds.c blampc_hitch.c blampc_tickcost.c blampc_console.c
    blampc_audio.c blampc_object_shadows.c blampc_reticle.c blampc_reticle_art.c
    blampc_display_hud.c blampc_net_gametype.c blampc_font_hires.c blampc_mpsound_probe.c
    blampc_hs_remap.c blampc_hs_special_forms.c blampc_hs_trace.c
    blampc_input.c blampc_input_profile.c blampc_input_pipeline.c blampc_input_delay.c
    blampc_bindings.c blampc_pad_settings.c blampc_fov.c
    "${CMAKE_CURRENT_BINARY_DIR}/local-network.c"
    stubs/blampc_stub_runtime.c stubs/blampc_stubs_data.c
    stubs/blampc_stubs_manual.c
    stubs/blampc_hs_definitions_generated.c)
list(REMOVE_ITEM host_sources "${CMAKE_CURRENT_BINARY_DIR}/local-network.c")
list(APPEND host_sources blampc_wall_jump.c blampc_crouch_slide.c blampc_movement.c blampc_loglevel.c)
list(APPEND host_sources blampc_film_actions.c blampc_kbm_binds.c blampc_spectate.c
    blampc_screen_effect_at.c blampc_teleport_probe.c)
list(TRANSFORM host_sources PREPEND "${H1_SOURCE}/host/")
list(APPEND host_sources "${CMAKE_CURRENT_BINARY_DIR}/local-network.c" "${CMAKE_CURRENT_BINARY_DIR}/film_join.c")
set_property(SOURCE "${CMAKE_CURRENT_BINARY_DIR}/local-network.c" APPEND PROPERTY INCLUDE_DIRECTORIES "${H1_SOURCE}/host/local")
set_property(SOURCE "${H1_SOURCE}/host/blampc_db_variants.c" APPEND PROPERTY COMPILE_OPTIONS "-include${H1_BETA3_PORT}/include/environment.h")
set_property(SOURCE "${H1_SOURCE}/host/blampc_kbm_binds.c" APPEND PROPERTY COMPILE_OPTIONS "-include${CMAKE_CURRENT_SOURCE_DIR}/include/keys.h")
add_executable(h1-film ${host_sources} "${CMAKE_CURRENT_BINARY_DIR}/film_sequential.c" "${CMAKE_CURRENT_BINARY_DIR}/main_headless.c"
    "${CMAKE_CURRENT_BINARY_DIR}/typed_stubs.c"
    "${CMAKE_CURRENT_BINARY_DIR}/platform_buffers.c"
    "${CMAKE_CURRENT_BINARY_DIR}/snapshot.c"
    "${CMAKE_CURRENT_BINARY_DIR}/rollback.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../beta3/export.c" "${H1_BETA3_PORT}/platform.c" "${CMAKE_CURRENT_BINARY_DIR}/headless.c"
    "${H1_BETA3_PORT}/cache-io.c" "${H1_BETA3_PORT}/wide-format.c"
    "${CMAKE_CURRENT_BINARY_DIR}/offline-network.c" mszip.c)
set_property(SOURCE "${CMAKE_CURRENT_BINARY_DIR}/main_headless.c" APPEND PROPERTY COMPILE_DEFINITIONS
    blampc_state_dump=hs_export_tick blampc_spawn_odds_tick=hs_unused_spawn_odds_tick)
# The exporter is new portable code, so its bounded memcpy/strlen calls can
# use compiler intrinsics. Keep the decompiled engine's CRT policy unchanged.
set_property(SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/../../beta3/export.c" APPEND PROPERTY COMPILE_OPTIONS -fbuiltin)
target_link_libraries(h1-film PRIVATE blam)
target_compile_options(h1-film PRIVATE -sUSE_ZLIB=1)
target_link_options(h1-film PRIVATE -sUSE_ZLIB=1)
# The reference map contains absolute tag addresses at 0x40440000. Keep all
# compiler-owned data above that region until a separately verified relocation port.
target_link_options(h1-film PRIVATE -O2 -g -sENVIRONMENT=node -sNODERAWFS=1
    -sEMULATE_FUNCTION_POINTER_CASTS=1
    -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=1207959552
    -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=8388608 -sGLOBAL_BASE=1124073472
    -sASSERTIONS=1 -sERROR_ON_UNDEFINED_SYMBOLS=0 -Wl,--Map=engine.map
    "--pre-js=${H1_BETA3_PORT}/node-pre.js")
set_target_properties(h1-film PROPERTIES SUFFIX ".js")
target_sources(h1-film PRIVATE presentation.c headless-extra.c platform-extra.c bot-replay.c
    "${H1_SOURCE}/host/blampc_any_device.c" "${H1_SOURCE}/host/blampc_viewer_input.c"
    "${H1_SOURCE}/host/blampc_picture_probe.c" "${H1_SOURCE}/host/blampc_announcer.c"
    "${H1_SOURCE}/host/blampc_powerup_nav.c")

target_sources(h1-film PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/mcc-maps.c")
target_sources(h1-film PRIVATE "${H1_SOURCE}/host/blampc_crouch_slide_clip.c" "${H1_SOURCE}/host/blampc_wall_kick_clip.c")
set_source_files_properties("${H1_SOURCE}/host/blampc_film_effects.c" "${H1_SOURCE}/host/blampc_film_ledger.c" "${H1_SOURCE}/host/blampc_world_ping.c" PROPERTIES COMPILE_OPTIONS "-include${CMAKE_CURRENT_SOURCE_DIR}/host-platform.h")

target_sources(h1-film PRIVATE "${H1_SOURCE}/host/blampc_film_arrival.c" "${H1_SOURCE}/host/blampc_film_blasts.c" "${H1_SOURCE}/host/blampc_film_netstrip.c")
