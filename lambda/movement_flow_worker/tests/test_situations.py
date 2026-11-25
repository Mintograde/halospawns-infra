import struct
import unittest
from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import patch

import situation_windows as windows


class SituationTests(unittest.TestCase):
    def test_rocket_pad_requires_an_authored_supply_of_ammunition(self):
        data = bytearray(1600)
        manager = SimpleNamespace(pointer_to_offset=int, data=data)
        item = SimpleNamespace(primary_class=0x77656170, path="weapons/rocket launcher", tag_data_pointer=0)
        struct.pack_into("<II", data, 0x4F0, 2, 1300)
        self.assertEqual(windows.power_item_code(manager, item), 0)
        struct.pack_into("<h", data, 1300 + 112 + 6, 4)
        self.assertEqual(windows.power_item_code(manager, item), 4)

    def test_override_uses_the_recording_and_preserves_cached_map_timers(self):
        pads = [{"period": 60}, {"period": 120}]
        job = {"map_source": {"sha256": "example"}, "births": [[220, 0, 8]]}
        with patch.dict(windows._map_pads, {"example": pads}, clear=True):
            config = windows.map_config({**job, "item_period": 90}, 1)
            self.assertEqual(config["pads"], [{"period": 90}, {"period": 90}])
            self.assertEqual(windows.map_config(job, 1)["pads"], pads)
            self.assertEqual(windows.map_config({}, 1), {"pads": None, "births": None, "stride": 1})

    def test_counts_distinct_windows_games_and_player_time_for_each_audience(self):
        game = {"winner": 1, "slots": [[0, 1], [1, 1], [2, 0], [3, 0]]}
        rows = [{"events": [[600, "teammate", 1], [840, "teammate", 2],
                            [1200, "only-overshield-rockets", 15]]},
                ["teammate", 0, [[1, 0, 0, 600]], []],
                ["teammate", 1, [[1, 0, 0, 480]], []],
                ["only-overshield-rockets", 2, [[2, 0, 0, 360]], []]]
        groups = defaultdict(windows.Selection)
        windows.merge_game(groups, game, rows)
        team = groups["teammate", "winning"]
        self.assertEqual((team.windows, team.games, sum(team.cells.values())), (2, 1, 1080))
        self.assertEqual(team.cells, groups["teammate", "all"].cells)
        self.assertNotIn(("teammate", "losing"), groups)
        combo = groups["only-overshield-rockets", "all"]
        self.assertEqual((combo.windows, combo.games), (1, 1))
        self.assertEqual(combo.cells, groups["only-overshield-rockets", "losing"].cells)
        self.assertFalse(groups["only-overshield-rockets", "winning"].cells)
