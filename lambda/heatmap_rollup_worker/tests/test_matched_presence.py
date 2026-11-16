from copy import deepcopy
import unittest
from test_handler import handler, _claim, _occupancy_document
from test_team_outcomes import game, cells


class MatchedTests(unittest.TestCase):
    def test_only_games_with_complete_matched_presence_supply_rate_inputs(self):
        accumulator = handler.RollupAccumulator(_claim())
        document = _occupancy_document()
        document['coverage']['status'] = 'available'
        eligible = game(1, 0)
        eligible['analytics_availability'] = {'metrics': dict.fromkeys(
            ('kill_positions', 'death_positions', 'occupancy'), 'available')}
        # Valid zero-event participants must retain their exposure.
        eligible['participants'][1]['events'] = []
        accumulator.add_game(eligible, occupancy_loader=lambda _: (document, 123))
        for variant in ('missing', 'partial', 'slot', 'metric'):
            bad, occupancy = deepcopy(eligible), deepcopy(document)
            bad['game_id'] = variant
            if variant == 'missing': bad['occupancy_artifact'] = None
            if variant == 'partial': occupancy['coverage']['status'] = 'partial'
            if variant == 'slot': occupancy['occupancy'] = occupancy['occupancy'][:1]
            if variant == 'metric': bad['analytics_availability']['metrics']['kill_positions'] = 'partial'
            accumulator.add_game(bad, occupancy_loader=lambda _: (occupancy, 123))
        result = accumulator.document()
        matched = result['matched']
        self.assertEqual(matched['metrics']['occupancy']['summary'], {
            'games_selected': 1, 'games_contributing': 1,
            'participants_selected': 2, 'participants_contributing': 2})
        self.assertEqual(sum(cells(matched, 'killer_position').values()), 1)
        self.assertEqual(sum(cells(matched, 'occupancy').values()), 8)
        self.assertEqual(sum(cells(result, 'killer_position').values()), 5)
