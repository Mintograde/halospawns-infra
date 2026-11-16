"""Winner/loser partitions must follow game results, not team color."""
import unittest

from test_handler import handler, _claim, _occupancy_document


def game(number, winner):
    return {
        "game_id": f"game-{number}", "winning_team_index": winner,
        "occupancy_artifact": {"placeholder": True},
        "participants": [
            {"participant_id": f"p-{number}-{team}", "slot_index": team,
             "team_index": team,
             "events": [{"event_type": metric, "replay_x": number * 10 + team,
                         "replay_y": 1, "replay_z": 0}
                        for metric in ("killer_position", "victim_position")]}
            for team in (0, 1)
        ],
    }


def cells(document, metric):
    return { (g["team_index"], tuple(c["cell"])): c["value"]
             for g in document["metrics"][metric]["groups"] for c in g["cells"] }


class OutcomeTests(unittest.TestCase):
    def test_swapped_winners_unknown_results_and_baseline_preservation(self):
        accumulator = handler.RollupAccumulator(_claim())
        baseline = handler.RollupAccumulator(_claim())
        reads = []
        def loader(manifest):
            reads.append(manifest)
            return _occupancy_document(), 123
        for number, winner in enumerate((0, 1, None), 1):
            value = game(number, winner)
            accumulator.add_game(value, occupancy_loader=loader)
            baseline.add_game({**value, "winning_team_index": None}, occupancy_loader=loader)
        result = accumulator.document()
        self.assertEqual(result["metrics"], baseline.document()["metrics"])
        self.assertEqual(len(reads), 6)  # One read per game per accumulator, not per outcome.
        winning, losing = (result["team_outcomes"][key] for key in ("winning", "losing"))
        for metric in ("killer_position", "victim_position"):
            self.assertEqual(cells(winning, metric), {(0, (20, -2)): 1, (1, (42, -2)): 1})
            self.assertEqual(cells(losing, metric), {(1, (22, -2)): 1, (0, (40, -2)): 1})
        self.assertEqual(cells(winning, "occupancy"), {(0, (-1, -3)): 3, (1, (4, 1)): 5})
        for outcome in (winning, losing):
            for metric in handler.METRICS:
                self.assertEqual(outcome["metrics"][metric]["summary"], {
                    "games_selected": 2, "games_contributing": 2,
                    "participants_selected": 2, "participants_contributing": 2,
                })
        self.assertGreater(accumulator.cell_count(), baseline.cell_count())

    def test_player_scope_counts_only_own_wins_and_losses(self):
        accumulator = handler.RollupAccumulator(_claim(scope_type="player_map", player_id="player"))
        for number, winner in enumerate((0, 1, None), 1):
            value = game(number, winner)
            value["participants"] = value["participants"][:1]
            accumulator.add_game(value, occupancy_loader=lambda _: (_occupancy_document(), 1))
        result = accumulator.document()
        for outcome in ("winning", "losing"):
            metrics = result["team_outcomes"][outcome]["metrics"]
            for metric in handler.METRICS:
                self.assertEqual(metrics[metric]["summary"]["games_selected"], 1)
                self.assertEqual(metrics[metric]["summary"]["participants_selected"], 1)
                self.assertEqual([g["team_index"] for g in metrics[metric]["groups"]], [0])
            self.assertEqual(sum(cells(result["team_outcomes"][outcome], "occupancy").values()), 3)

    def test_unassigned_is_not_a_loser_and_missing_result_contract_is_rejected(self):
        accumulator = handler.RollupAccumulator(_claim())
        for team in (None, -1):
            value = game(1, 0)
            value["participants"][1]["team_index"] = team
            accumulator.add_game(value, occupancy_loader=lambda _: (_occupancy_document(), 1))
        self.assertEqual(accumulator.document()["team_outcomes"]["losing"]["metrics"]["occupancy"]["summary"]["participants_selected"], 0)
        for winner in (True, -1, 64, "0", "missing"):
            value = game(1, winner)
            if winner == "missing":
                del value["winning_team_index"]
            with self.assertRaises(handler.RollupError):
                handler.RollupAccumulator(_claim()).add_game(value, occupancy_loader=lambda _: None)
