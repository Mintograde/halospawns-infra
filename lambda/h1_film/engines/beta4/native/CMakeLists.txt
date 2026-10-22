cmake_minimum_required(VERSION 3.20)
project(halospawns_h1_film C)

if(NOT IS_DIRECTORY "${H1_SOURCE}/engine")
    message(FATAL_ERROR "Pass -DH1_SOURCE=<Performance Build src directory>")
endif()

file(READ "${H1_SOURCE}/source-revision.json" source_revision)
string(JSON source_commit GET "${source_revision}" git_commit)
string(JSON source_date GET "${source_revision}" git_date)
if(NOT source_commit STREQUAL "e78e4daa4b6d6b3e9ca290e3ebfe7a993ed558ad")
    message(FATAL_ERROR "Beta 4 requires its exact archived source commit")
endif()
set(ENV{BLAMPC_BUILD_COMMIT} "e78e4daa")
set(ENV{BLAMPC_BUILD_DATE} "${source_date}")
set(ENV{BLAMPC_BUILD_LABEL} "BETA 4")

# Reuse the original simulator and its strict x86 floating-point build settings.
add_subdirectory("${H1_SOURCE}" engine)
if(MSVC)
    target_compile_options(blam PRIVATE /MP12)
    target_compile_options(blampc PRIVATE /MP12)
endif()
option(H1_COMBAT_EXPORT "Build candidate combat hooks" OFF)
if(H1_COMBAT_EXPORT)
    include("${CMAKE_CURRENT_SOURCE_DIR}/../../beta3/combat.cmake")
    hs_combat_native()
endif()

# A sequential converter never uses theater pad displays or seek snapshots.
# Patch only a generated copy, and refuse an unfamiliar upstream source layout.
file(READ "${H1_SOURCE}/host/blampc_film.c" film_source)
foreach(anchor IN ITEMS "film_pad_load(g_file, &g_env);" "if (g_kf_failed || !film_keyframe_open())")
    string(FIND "${film_source}" "${anchor}" anchor_offset)
    string(FIND "${film_source}" "${anchor}" anchor_last REVERSE)
    if(anchor_offset EQUAL -1 OR NOT anchor_offset EQUAL anchor_last)
        message(FATAL_ERROR "H1 film integration changed: expected exactly one ${anchor}")
    endif()
endforeach()
string(REPLACE "film_pad_load(g_file, &g_env);" "/* Converter: no raw-pad display. */" film_source "${film_source}")
string(REPLACE "if (g_kf_failed || !film_keyframe_open())" "if (1 /* Converter: no seek snapshots. */)" film_source "${film_source}")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/film_sequential.c" "${film_source}")
get_target_property(host_sources blampc SOURCES)
list(FILTER host_sources EXCLUDE REGEX "(^|/)blampc_film\\.c$")
set_property(TARGET blampc PROPERTY SOURCES "${host_sources}")
target_sources(blampc PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/film_sequential.c")
set_property(SOURCE "${CMAKE_CURRENT_BINARY_DIR}/film_sequential.c" TARGET_DIRECTORY blampc
    APPEND PROPERTY INCLUDE_DIRECTORIES "${H1_SOURCE}/host")
target_sources(blampc PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../../beta3/export.c")
set_property(SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/../../beta3/export.c" TARGET_DIRECTORY blampc
    APPEND PROPERTY INCLUDE_DIRECTORIES "${H1_SOURCE}/host")
set_property(SOURCE "${H1_SOURCE}/host/main.c" TARGET_DIRECTORY blampc
    APPEND PROPERTY COMPILE_DEFINITIONS blampc_state_dump=hs_export_tick)
set_property(SOURCE "${H1_SOURCE}/engine/blam/object_cause_damage.c" TARGET_DIRECTORY blampc
    APPEND PROPERTY COMPILE_DEFINITIONS blampc_pgcr_stats_note_damage=hs_note_damage)
set_target_properties(blampc PROPERTIES OUTPUT_NAME "h1-film-export")
