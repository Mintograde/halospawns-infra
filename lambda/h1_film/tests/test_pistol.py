import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film.pistol import validate_pistol


class PistolTests(unittest.TestCase):
    def test_pairs_recipe_and_overall_bounds(self):
        encoding = {"players": [0], "final_counters": {"0": {"shots_fired": 30, "shots_hit": 15}}}
        report = {"exporter_revision": 28, "analytics": {"match_end_source_tick": 100}}
        for fired, hit, good in ((20, 12, True), (0, 0, True), (None, None, True),
                                 (20, 21, False), (31, 12, False), (20, 16, False),
                                 (None, 0, False), (20.0, 12, False)):
            product = {"schema": "halospawns.h1PistolAccuracy.v1", "method": "pgcr_player_latch",
                       "boundary_policy": "pre_end_snapshot", "players": [
                           {"slot_index": 0, "shots_fired": fired, "shots_hit": hit}]}
            if good:
                validate_pistol(product, encoding=encoding, report=report)
            else:
                with self.assertRaises(ValueError):
                    validate_pistol(product, encoding=encoding, report=report)
        with self.assertRaises(ValueError):
            validate_pistol(None, encoding=encoding, report=report)
        report["exporter_revision"] = 27
        validate_pistol(None, encoding=encoding, report=report)
        with self.assertRaises(ValueError):
            validate_pistol(product, encoding=encoding, report=report)
