#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "blampc_bots.h"
#include "blampc_bot_names.h"
#include "blampc_film.h"
#include "blampc_net.h"
#include "headers/blam_data_globals.h"
#include "headers/data_iterator.h"
#include "headers/machine_player_limit.h"
#include "headers/network_constants.h"
#include "headers/player_datum.h"

extern int player_new(int machine_index, int player_index, uint16_t local_player_index,
                      network_player *network_player_data);

static int requested_bots;
static int created_bots;
static int configured_limit;
static int limit_raised;
static int bot_handles[BLAMPC_BOTS_MAXIMUM];
static unsigned char bot_teams[BLAMPC_BOTS_MAXIMUM];
static const int16_t bot_colors[BLAMPC_BOTS_MAXIMUM] = { 7, 11, 8, 9, 10, 14, 12, 13, 17, 15, 16 };

int blampc_bots_configure(int count, int skill, const unsigned char *teams)
{
    (void)skill;
    if (count < 0 || count > BLAMPC_BOTS_MAXIMUM) abort();
    if (count && (!blampc_film_playing() || blampc_net_boot_role() != BLAMPC_NET_ROLE_LOCAL)) abort();
    requested_bots = count;
    configured_limit = machine_player_limit;
    for (int number = 0; number < BLAMPC_BOTS_MAXIMUM; ++number)
        bot_teams[number] = teams && teams[number] <= BLAMPC_BOTS_TEAM_BLUE
            ? teams[number] : BLAMPC_BOTS_TEAM_AUTO;
    return count;
}

void blampc_bots_create_players(void)
{
    data_iterator iterator;
    int players = 0;
    created_bots = 0;
    if (limit_raised) {
        machine_player_limit = configured_limit;
        limit_raised = 0;
    }
    if (!requested_bots) return;
    if (!blampc_film_playing() || blampc_net_boot_role() != BLAMPC_NET_ROLE_LOCAL
        || blampc_net_client_boot_pending()) abort();
    data_iterator_new(&iterator, player_data);
    while (data_iterator_next(&iterator)) ++players;
    if (players + requested_bots > BLAMPC_BOTS_MAXIMUM_PLAYERS) abort();
    if (requested_bots > machine_player_limit) {
        machine_player_limit = requested_bots;
        limit_raised = 1;
    }
    blampc_bot_names_begin_map();
    for (int number = 0; number < requested_bots; ++number) {
        network_player network;
        char name[12];
        memset(&network, 0, sizeof network);
        if (!blampc_bot_name_for(name, sizeof name))
            snprintf(name, sizeof name, "Bot %d", number + 1);
        for (int character = 0; name[character] && character < 11; ++character)
            network.name[character] = (wchar_t)name[character];
        network.primary_color_index = bot_colors[number];
        network.machine_index = (char)(MAXIMUM_NETWORK_MACHINE_COUNT - 1);
        network.controller_index = (char)number;
        network.player_list_index = (char)(MAXIMUM_NUMBER_OF_LOCAL_PLAYERS + number);
        int handle = player_new(MAXIMUM_NETWORK_MACHINE_COUNT - 1, -1, 0xFFFF, &network);
        if (handle == -1) abort();
        bot_handles[created_bots++] = handle;
    }
}

int blampc_bots_team_for(int red, int blue, unsigned char chosen)
{
    if (chosen == BLAMPC_BOTS_TEAM_RED) return 0;
    if (chosen == BLAMPC_BOTS_TEAM_BLUE) return 1;
    return blue < red ? 1 : 0;
}

int blampc_bots_creation_team(int player_index)
{
    int number;
    for (number = 0; number < created_bots; ++number)
        if ((uint16_t)bot_handles[number] == (uint16_t)player_index) break;
    if (number == created_bots) return -1;
    data_iterator iterator;
    player_datum *player;
    int counts[2] = { 0, 0 };
    data_iterator_new(&iterator, player_data);
    while ((player = data_iterator_next(&iterator)) != NULL) {
        if ((uint16_t)iterator.index >= (uint16_t)player_index) continue;
        if (player->team_index == 0 || player->team_index == 1)
            ++counts[player->team_index];
    }
    return blampc_bots_team_for(counts[0], counts[1], bot_teams[number]);
}

int blampc_bots_requested(void) { return requested_bots; }
int blampc_bots_created(void) { return created_bots; }
int blampc_bots_player(int number) { return number >= 0 && number < created_bots ? bot_handles[number] : -1; }
int blampc_bots_is_bot(int player_index) { for (int n=0; n<created_bots; ++n) if (bot_handles[n] == player_index) return 1; return 0; }
