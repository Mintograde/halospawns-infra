import copy
import unittest

from test_combat import product
from h1_film import analytics, cloud


class GameplayTests(unittest.TestCase):
    def setUp(self):
        self.encoding = {
            "analytics_revision": 5, "players": [0, 1],
            "final_counters": {str(slot): {"kills": 1-slot, "deaths": slot,
                                         "suicides": 0, "team_kills": 0} for slot in (0, 1)},
        }
        self.report = {"analytics": {"match_end_source_tick": 5}, "envelope": {"ticks": 12}}
        self.native = product()
        self.native["schema"] = "halospawns.h1NativeAnalytics.v3"
        self.native["gameplay"] = {"schema": "halospawns.h1GameplayMetrics.v1", "metrics": [{
            "id": "pistol_three_shot_kills", "definition_version": 1,
            "players": [{"slot_index": slot, "value": 1-slot, "observed_count": 1-slot,
                         "unknown_kills": 0, "evaluated_kills": 1-slot,
                         "coverage": {"status": "complete", "reason": None},
                         "examples": [{"kill_event_index": 0, "victim_slot": 1,
                                       "start_source_tick": 0, "end_source_tick": 5}] if slot == 0 else []}
                        for slot in (0, 1)],
        }]}

    def validate(self, native):
        cloud.validate_schema("native-analytics", native)
        analytics.validate_native_product(native, encoding=self.encoding, report=self.report)

    def test_gameplay_is_additive_to_native_combat(self):
        self.validate(self.native)
        self.encoding["analytics_revision"] = 4
        with self.assertRaises(ValueError):
            self.validate(self.native)

    def test_counts_coverage_and_examples_must_reconcile(self):
        for change in ("count", "unknown", "death", "slot", "window"):
            with self.subTest(change=change):
                native = copy.deepcopy(self.native)
                player = native["gameplay"]["metrics"][0]["players"][0]
                if change == "count":
                    player["observed_count"] = player["value"] = 2
                elif change == "unknown":
                    player["unknown_kills"] = 1
                elif change == "death":
                    player["examples"][0]["kill_event_index"] = 1
                elif change == "slot":
                    player["slot_index"] = 3
                else:
                    player["examples"][0]["start_source_tick"] = 6
                with self.assertRaises(ValueError):
                    self.validate(native)

    def test_partial_recording_preserves_observed_count_without_claiming_total(self):
        player = self.native["gameplay"]["metrics"][0]["players"][0]
        player.update(value=None, coverage={"status": "partial", "reason": "partial_recording"})
        self.validate(self.native)
