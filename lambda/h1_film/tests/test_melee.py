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

    def test_remote_timing_requires_new_definition_and_strict_original_clocks(self):
        metric = self.native["gameplay"]["metrics"][2]
        metric["definition_version"] = 2
        example = metric["players"][0]["examples"][0]
        example.pop("melee_timing")
        example["start_source_tick"] = 1
        remote = {
            "method": "host_accepted_reports_v1", "first_damage_source_tick": 1,
            "first_report_client_tick": 7145, "second_report_client_tick": 7177,
            "minimum_recovery_ticks": 56, "machine_slot": 3, "epoch": 43123,
            "first_sequence": 9, "second_sequence": 10,
            "first_verdict_index": 48, "second_verdict_index": 50,
            "host_first_action_source_tick": 0, "host_grenade_source_tick": 2,
            "host_second_action_source_tick": 3,
        }
        example["remote_melee_timing"] = remote
        self.validate(melee_required=True, double_melee_definition=2)
        with self.assertRaises(ValueError):
            self.validate(melee_required=True, double_melee_definition=1)
        for field, value in (("second_report_client_tick", 7201),
                             ("second_report_client_tick", 7145),
                             ("first_sequence", 10), ("first_verdict_index", 50),
                             ("host_grenade_source_tick", 0)):
            with self.subTest(field=field, value=value):
                old = remote[field]
                remote[field] = value
                with self.assertRaises(ValueError):
                    self.validate(melee_required=True, double_melee_definition=2)
                remote[field] = old
