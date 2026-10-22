#include <assert.h>
#define H1_EXPORT_MAX_PLAYERS 16
#include "../engines/beta3/export.c"

static player_datum test_players[16];
static data_array test_array;
static int counters[16][5];
data_array *player_data = &test_array;

int blampc_pgcr_stats_shots_fired(int slot) { return counters[slot][0]; }
int blampc_pgcr_stats_shots_hit(int slot) { return counters[slot][1]; }
int blampc_pgcr_stats_damage_given_points(int slot) { return counters[slot][2]; }
int blampc_pgcr_stats_camo_pickups(int slot) { return counters[slot][3]; }
int blampc_pgcr_stats_overshield_pickups(int slot) { return counters[slot][4]; }
void blampc_pgcr_stats_note_damage(int attacker, int victim, int category, int part, float damage, const char *tag_name)
{
    (void)attacker; (void)victim; (void)category; (void)part; (void)damage; (void)tag_name;
}

int main(int count, char **arguments)
{
    int physical, metric;
    (void)arguments;
    test_array.count = 16;
    test_array.size = sizeof(player_datum);
    test_array.data = test_players;
    for (physical = 0; physical < 4; ++physical) test_players[physical].identifier = 1;
    hs_register_players();
    hs_note_damage(-1, 0x10003, 0, 0, 10, NULL);
    assert(hs_participant(0x10003) == 3 && damage_received[3] == 10);
    for (metric = 0; metric < 5; ++metric) counters[3][metric] = 100 + metric;
    test_players[3].identifier = 2;
    hs_register_players();
    assert(hs_participant(0x20003) == 4 && hs_participant(0x10003) == 3);
    for (metric = 0; metric < 5; ++metric) {
        assert(hs_pgcr_value(4, metric, counters[3][metric]) == 0);
        assert(hs_pgcr_value(4, metric, counters[3][metric] + 7) == 7);
    }
    hs_note_damage(-1, 0x20003, 0, 0, 2, NULL);
    assert(damage_received[3] == 10 && damage_received[4] == 2);
    test_players[15].identifier = 1;
    hs_register_players();
    assert(hs_participant(0x1000f) == 5);
    for (physical = 4; physical < 14; ++physical) test_players[physical].identifier = 1;
    hs_register_players();
    assert(hs_roster_count == 16 && hs_participant(0x1000d) == 15);
    if (count > 1) {
        test_players[14].identifier = 1;
        hs_register_players();
        return 99;
    }
    puts("sixteen-player roster, slot reuse and independent counter baselines passed");
    return 0;
}
