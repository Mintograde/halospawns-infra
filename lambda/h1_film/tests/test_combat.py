import copy
import sys
import unittest
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import analytics, cloud, combat


@dataclass
class Parsed:
    metadata: dict
    participants: list
    game: dict
    facts: dict


def product():
    return {
        "schema": "halospawns.h1NativeAnalytics.v2",
        "players": [{"slot_index": slot, "metrics": {}} for slot in range(2)],
        "combat": {
            "provenance": "simulation_hooks_v1", "coordinate_space": "halo1.replay_world.v1",
            "damage_unit": "h1_applied_vitality", "shot_unit": "discharge",
            "hit_policy": "discharge_hit_opponent_once", "position_sample": "death_callback",
            "weapons": [{"weapon_id": "w0", "tag_path": "weapons\\pistol\\pistol", "category": "weapon"}],
            **{name + "_coverage": {"status": "complete"} for name in ("shot", "damage", "death", "award")},
            "shots": [{"slot_index": 0, "weapon_id": "w0", "shots_fired": 3, "shots_hit": 1}],
            "damage": [{"attacker_slot": 0, "victim_slot": 1, "weapon_id": "w0",
                        "relationship": "opponent", "shield_damage": 0.75, "health_damage": 1.0}],
            "deaths": [{"event_index": 0, "source_tick": 5, "killer_slot": 0, "victim_slot": 1,
                        "kind": "kill", "weapon_id": "w0", "headshot": True,
                        "killer_position": [-1.0, 0.0, 0.0], "victim_position": [1.0, 0.0, 0.0]}],
            "awards": [{"slot_index": slot, "longest_kill_streak": 1 - slot,
                        "double_kills": 0, "triple_kills": 0, "overkills": 0} for slot in range(2)],
        },
    }


class CombatTests(unittest.TestCase):
    def setUp(self):
        self.encoding = {
            "analytics_revision": 4, "players": [0, 1],
            "final_counters": {str(slot): {"kills": 1 - slot, "deaths": slot, "suicides": 0, "team_kills": 0}
                               for slot in range(2)},
        }
        self.report = {"analytics": {"match_end_source_tick": 5}, "envelope": {"ticks": 12}}

    def validate(self, native):
        cloud.validate_schema("native-analytics", native)
        analytics.validate_native_product(native, encoding=self.encoding, report=self.report)

    def test_revision_four_death_on_ending_tick_and_native_v1_metrics_coexist(self):
        native = product()
        self.validate(native)
        native["players"][0]["metrics"]["vitality_damage_received"] = {"value": 0.125, "series": None}
        self.encoding["final_counters"]["0"]["damage_received"] = 0.125
        self.validate(native)

    def test_old_and_new_native_schemas_cannot_cross_revision_pins(self):
        native = product()
        native["schema"] = "halospawns.h1NativeAnalytics.v1"
        del native["combat"]
        cloud.validate_schema("native-analytics", native)
        with self.assertRaises(ValueError):
            analytics.validate_native_product(native, encoding=self.encoding, report=self.report)
        self.encoding["analytics_revision"] = 3
        with self.assertRaises(ValueError):
            analytics.validate_native_product(product(), encoding=self.encoding, report=self.report)

    def test_invalid_order_slots_counts_relationships_and_missing_evidence_fail(self):
        for mutate in (
            lambda combat: combat["shots"][0].update(shots_fired=True),
            lambda combat: combat["shots"][0].update(shots_fired=3.0),
            lambda combat: combat["shots"][0].update(shots_hit=4),
            lambda combat: combat["shots"].append(copy.deepcopy(combat["shots"][0])),
            lambda combat: combat["damage"][0].update(relationship="self"),
            lambda combat: combat["damage"][0].update(shield_damage=float("nan")),
            lambda combat: combat["damage"][0].update(attacker_slot=3),
            lambda combat: combat["deaths"][0].update(source_tick=6),
            lambda combat: combat["deaths"][0].update(killer_position=[float("inf"), 0.0, 0.0]),
            lambda combat: combat["deaths"][0].update(weapon_id=None),
            lambda combat: combat["deaths"].append(copy.deepcopy(combat["deaths"][0])),
            lambda combat: combat["death_coverage"].update(status="partial"),
            lambda combat: combat.update(awards=[]),
            lambda combat: combat["awards"][0].update(longest_kill_streak=2),
            lambda combat: combat["shot_coverage"].update(status="unavailable", reason="unsupported_exporter"),
        ):
            native = product()
            mutate(native["combat"])
            with self.subTest(native=native), self.assertRaises((ValueError, cloud.FilmError)):
                self.validate(native)

    def test_independent_unavailable_partial_and_observed_zero(self):
        native = product()
        native["combat"]["shots"] = []
        native["combat"]["shot_coverage"] = {"status": "unavailable", "reason": "unsupported_exporter"}
        native["combat"]["damage"] = []
        native["combat"]["death_coverage"] = {"status": "partial", "reason": "partial_recording"}
        self.validate(native)
        native["combat"]["deaths"] = []
        self.validate(native)
        native["combat"]["death_coverage"] = {"status": "complete"}
        with self.assertRaises(ValueError):
            self.validate(native)

    def test_recorded_evt1_must_reconcile_in_both_directions(self):
        native = product()
        native["kill_attribution"] = {
            "provenance": "recorded_evt1", "coverage": "complete", "reason": None,
            "events": [{"source_tick": 5, "killer_slot": 0, "victim_slot": 1}],
        }
        self.validate(native)
        native["kill_attribution"]["events"][0]["source_tick"] = 4
        with self.assertRaisesRegex(ValueError, "EVT1"):
            self.validate(native)

    def test_revision_four_completion_retries_keep_exact_revision(self):
        fixtures = Path(__file__).parent / "fixtures"
        pin = analytics._json(fixtures / "api-initial-job.json")["job"]["conversion"]
        proof = analytics._json(fixtures / "api-completion.json")["h1film"]
        proof.update(analytics_revision=4, recording_closed=True)
        cloud.validate_proof(pin, proof, analytics_revision=4)
        for revision in (None, 1, 2, 3):
            with self.assertRaises(cloud.FilmError):
                cloud.validate_proof(pin, proof, analytics_revision=revision)

    def test_native_self_friendly_fire_is_not_a_betrayal_and_raw_evidence_is_retained(self):
        native = product()
        event = native["combat"]["deaths"][0]
        event.update(killer_slot=1, kind="suicide", headshot=None)
        self.encoding["final_counters"]["0"]["kills"] = 0
        self.encoding["final_counters"]["1"].update(suicides=1, team_kills=1)
        native["combat"]["awards"][0]["longest_kill_streak"] = 0
        self.validate(native)
        normalized = combat.participant_counters(self.encoding, native["combat"])
        self.assertEqual(normalized["1"]["team_kills"], 0)
        self.assertEqual(self.encoding["final_counters"]["1"]["team_kills"], 1)
        native["combat"]["death_coverage"] = {"status": "partial", "reason": "capped"}
        self.assertEqual(combat.participant_counters(self.encoding, native["combat"])["1"]["team_kills"], 1)
        native["combat"]["death_coverage"] = {"status": "complete"}
        self.encoding["final_counters"]["1"]["team_kills"] = 2
        with self.assertRaisesRegex(ValueError, "friendly-fire"):
            self.validate(native)
        self.encoding["analytics_revision"] = 3
        self.assertEqual(combat.participant_counters(self.encoding)["1"]["team_kills"], 2)

    def test_normal_adaptation_normalizes_betrayals_without_mutating_parser_or_evidence(self):
        native = product()
        native["combat"]["deaths"][0].update(killer_slot=1, kind="suicide", headshot=None)
        self.encoding["native_analytics"] = native
        self.encoding["final_counters"]["0"]["kills"] = 0
        self.encoding["final_counters"]["1"].update(suicides=1, team_kills=1)
        parsed = Parsed(metadata={"tick_count": 2}, participants=[{
            "slot_index": slot, "metadata": {}, "stats": {
                **{field: counters.get(field) for field in ("kills", "deaths", "assists", "suicides")},
                "betrayals": counters["team_kills"],
            },
        } for slot in range(2) for counters in [self.encoding["final_counters"][str(slot)]]],
            game={}, facts={})
        self.report.update(engine_profile="h1-performance-beta3-p45-wasm-v1",
                           provenance={"film_sha256": "a" * 64, "map_sha256": "b" * 64})
        self.report["analytics"]["ticks"] = 2
        adapted = analytics.adapt_parsed_replay(parsed, report=self.report, encoding=self.encoding)
        self.assertEqual(adapted.participants[1]["stats"]["betrayals"], 0)
        self.assertEqual(parsed.participants[1]["stats"]["betrayals"], 1)
        self.assertEqual(self.encoding["final_counters"]["1"]["team_kills"], 1)
