import copy
import unittest

import test_gameplay
from h1_film import cloud, gameplay


class MeleeTests(unittest.TestCase):
    def setUp(self):
        source = test_gameplay.GameplayTests()
        source.setUp()
        self.native = source.native
        self.combat = self.native["combat"]
        self.combat["weapons"][0]["category"] = "melee"
        self.combat["deaths"][0]["headshot"] = False
        metric = self.native["gameplay"]["metrics"][0]
        for key in ("backwhack_kills", "double_melee_kills"):
            added = copy.deepcopy(metric)
            added["id"] = key
            if key == "double_melee_kills":
                added["players"][0]["examples"][0]["melee_timing"] = {
                    "first_damage_source_tick": 1, "grenade_source_tick": 2,
                    "second_action_source_tick": 3, "cooldown_expiry_source_tick": 6,
                }
            self.native["gameplay"]["metrics"].append(added)
        metric["definition_version"] = 2
        metric["players"][0].update(value=0, observed_count=0, examples=[])

    def validate(self, **kwargs):
        cloud.validate_schema("native-analytics", self.native)
        gameplay.validate_gameplay(self.native["gameplay"], self.combat, [0, 1], 6,
                                   definition_version=2, **kwargs)

    def test_new_recipe_requires_both_metrics_and_strict_timing(self):
        self.validate(melee_required=True)
        with self.assertRaises(ValueError):
            self.validate(melee_required=False)
        timing = self.native["gameplay"]["metrics"][2]["players"][0]["examples"][0]["melee_timing"]
        timing["cooldown_expiry_source_tick"] = 5
        with self.assertRaises(ValueError):
            self.validate(melee_required=True)

    def test_partial_melee_coverage_is_distinct_from_shot_evidence(self):
        player = self.native["gameplay"]["metrics"][2]["players"][0]
        player.update(value=None, observed_count=0, unknown_kills=1, examples=[],
                      coverage={"status": "partial", "reason": "missing_melee_evidence"})
        self.validate(melee_required=True)
        player["coverage"]["reason"] = "missing_shot_evidence"
        with self.assertRaises(ValueError):
            self.validate(melee_required=True)

    def test_duplicate_metric_and_non_melee_death_are_rejected(self):
        self.combat["weapons"][0]["category"] = "weapon"
        with self.assertRaises(ValueError):
            self.validate(melee_required=True)
        self.combat["weapons"][0]["category"] = "melee"
        self.native["gameplay"]["metrics"][2]["id"] = "backwhack_kills"
        with self.assertRaises(ValueError):
            self.validate(melee_required=True)
