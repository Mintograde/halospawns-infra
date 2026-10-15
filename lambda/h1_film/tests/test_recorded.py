import copy
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import recorded


class RecordedTests(unittest.TestCase):
    def test_h1arena_resolved_record_retains_reviewed_offsets(self):
        words = [0] * 32
        words[:4] = (0x314D4C46, 2, 9111, 120)
        words[16], words[17], words[21], words[22] = 480, 848, 480, 368
        data = bytearray(848)
        struct.pack_into("<32I", data, 0, *words)
        for index, value in {0: 0, 1: 50, 18: 5, 19: 5, 21: 1, 30: 1, 57: 1, 58: 1, 59: 2}.items():
            struct.pack_into("<i", data, 480 + 128 + index * 4, value)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.h1film"
            path.write_bytes(data)
            result = recorded.resolved_variant(path, encoding={"game_type": 2, "has_teams": True})
            self.assertEqual(result["score_to_win"], 50)
            self.assertEqual(result["respawn_seconds"], 5)
            self.assertEqual(result["motion_tracker"], "all")
            struct.pack_into("<I", data, 2 * 4, 9112)
            path.write_bytes(data)
            with self.assertRaisesRegex(ValueError, "adapter"):
                recorded.resolved_variant(path, encoding={"game_type": 2, "has_teams": True})

    def setUp(self):
        self.report = {"envelope": {"ticks": 20, "first_update": 0}}
        self.encoding = {"source_first_clock": 0, "source_last_clock": 19, "players": [0, 1],
            "analytics": {"match_end_source_tick": 10},
            "kill_ticks": {"0": {"2": 1, "10": 1}},
            "final_counters": {"0": {"kills": 2, "deaths": 0}, "1": {"kills": 0, "deaths": 2}}}

    def parse(self, events=((2, 0, 0, 1), (10, 0, 0, 1), (11, 0, 0, 1)), *, flags=0, present=True):
        words = [0] * 32
        words[:4] = (0x314D4C46, 2, 45, 120)
        words[12] = 448
        size = 32 + len(events) * 16
        words[28:30] = (480, size) if present else (0, 0)
        data = bytearray(480)
        struct.pack_into("<32I", data, 0, *words)
        if present:
            data += struct.pack("<8I", 0x31545645, 1, 32, 16, len(events), flags, 0, 0)
            for tick, kind, killer, victim in events:
                data += struct.pack("<iBbbBB7x", tick, kind, -1, -1, killer, victim)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.h1film"
            path.write_bytes(data)
            return recorded.kill_attribution(path, report=self.report, encoding=self.encoding)

    def test_pairs_reconcile_at_original_source_ticks_and_keep_end_tick_score(self):
        result = self.parse()
        self.assertEqual(result["coverage"], "complete")
        self.assertEqual([event["source_tick"] for event in result["events"]], [2, 10])
        self.assertTrue(all(event["killer_slot"] == 0 for event in result["events"]))

    def test_missing_capped_bookmark_only_and_unverified_clock(self):
        self.assertEqual(self.parse(present=False)["reason"], "missing_section")
        self.assertEqual(self.parse(flags=2)["reason"], "missing_section")
        self.assertEqual(self.parse(flags=1)["reason"], "capped_section")
        self.assertEqual(self.parse(events=((3, 0, 0, 1),))["reason"], "unverified_clock")
        self.assertEqual(self.parse(events=((2, 0, 3, 1),))["reason"], "unverified_clock")
        self.assertEqual(self.parse(events=((2, 2, 1, 1), (3, 4, 255, 255)))["events"], [])
        self.encoding["source_first_clock"] = 1
        self.assertEqual(self.parse()["reason"], "unverified_clock")

    def test_partial_recording_does_not_claim_complete_attribution(self):
        self.encoding["final_counters"]["0"]["kills"] = 3
        self.assertEqual(self.parse()["reason"], "partial_recording")

    def test_start_requires_both_zero_clocks_and_an_active_first_snapshot(self):
        self.assertEqual(recorded.match_start(self.report, self.encoding), 0)
        for changes in ({"source_first_clock": 1}, {"analytics": {"match_end_source_tick": 0}}):
            self.assertIsNone(recorded.match_start(self.report, {**self.encoding, **changes}))
        report = copy.deepcopy(self.report)
        report["envelope"]["first_update"] = 10
        self.assertIsNone(recorded.match_start(report, self.encoding))

    def test_resolved_rules_use_raw_record_and_verified_mode_not_variant_name(self):
        words = [0] * 32
        words[:4] = (0x314D4C46, 2, 45, 120)
        words[17], words[21], words[22] = 804, 448, 356
        data = bytearray(804)
        struct.pack_into("<32I", data, 0, *words)
        for index, value in {0: 0, 1: 50, 17: 0, 18: 5, 19: 5, 21: 1, 30: 0, 31: 1}.items():
            struct.pack_into("<i", data, 448 + 128 + index * 4, value)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.h1film"
            path.write_bytes(data)
            encoding = {"game_type": 2, "has_teams": True}
            result = recorded.resolved_variant(path, encoding=encoding)
            self.assertEqual(result["score_to_win"], 50)
            self.assertEqual(result["respawn_seconds"], 5)
            self.assertEqual(result["suicide_penalty_seconds"], 5)
            self.assertEqual(result["motion_tracker"], "off")
            self.assertTrue(result["teamplay"])
            self.assertTrue(result["shields_enabled"])
            self.assertIsNone(result["starting_grenades"])
            self.assertIsNone(result["time_limit_seconds"])
            self.assertIsNone(recorded.resolved_variant(path, encoding={**encoding, "game_type": 1}))
            struct.pack_into("<I", data, 22 * 4, 0)
            path.write_bytes(data)
            self.assertIsNone(recorded.resolved_variant(path, encoding=encoding))
