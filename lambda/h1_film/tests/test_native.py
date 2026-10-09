import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import analytics, cloud


class NativeTests(unittest.TestCase):
    def setUp(self):
        self.product = {"schema": "halospawns.h1NativeAnalytics.v1", "players": [{
            "slot_index": 0, "metrics": {
                "pgcr_damage_dealt": {"value": 50, "series": [{"source_tick": 1, "value": 50}]},
                "vitality_damage_received": {"value": 1.125, "series": None},
                "camo_pickups": {"value": 0, "series": []},
                "overshield_pickups": {"value": None, "series": None},
            }}]}
        self.encoding = {"players": [0], "final_counters": {"0": {
            "damage_dealt": 50, "damage_received": 1.125, "camo_count": 0}}}
        self.report = {"envelope": {"ticks": 12}, "analytics": {"match_end_source_tick": 5}}

    def validate(self, product):
        cloud.validate_schema("native-analytics", product)
        analytics.validate_native_product(product, encoding=self.encoding, report=self.report)

    def test_native_totals_precision_zero_missing_and_unavailable_timeline(self):
        self.validate(self.product)
        self.product["players"][0]["metrics"]["pgcr_damage_dealt"]["series"] = None
        self.validate(self.product)

    def test_native_rejects_invalid_slots_counter_precision_clock_and_reconciliation(self):
        for mutate in (
            lambda p: p["players"].append(copy.deepcopy(p["players"][0])),
            lambda p: p["players"][0].update(slot_index=1),
            lambda p: p["players"][0]["metrics"]["pgcr_damage_dealt"].update(value=50.0),
            lambda p: p["players"][0]["metrics"]["pgcr_damage_dealt"].update(value=51),
            lambda p: p["players"][0]["metrics"]["pgcr_damage_dealt"]["series"][0].update(source_tick=5),
            lambda p: p["players"][0]["metrics"]["pgcr_damage_dealt"]["series"][0].update(source_tick=True),
            lambda p: p["players"][0]["metrics"]["pgcr_damage_dealt"]["series"][0].update(value=49),
            lambda p: p["players"][0]["metrics"]["pgcr_damage_dealt"].update(series=[]),
            lambda p: p["players"][0]["metrics"]["vitality_damage_received"].update(value=float("nan")),
        ):
            product = copy.deepcopy(self.product)
            mutate(product)
            with self.assertRaises((ValueError, cloud.FilmError)):
                self.validate(product)

    def test_end_at_zero_cannot_claim_observed_zero(self):
        self.report["analytics"]["match_end_source_tick"] = 0
        with self.assertRaises(ValueError):
            self.validate(self.product)
        for metric in self.product["players"][0]["metrics"].values():
            metric.update(value=None, series=None)
        self.validate(self.product)
