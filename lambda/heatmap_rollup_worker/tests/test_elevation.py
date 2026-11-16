from collections import defaultdict
from copy import deepcopy

from test_handler import _claim, _occupancy_document, handler
from test_team_outcomes import game


def test_floors_are_retained_in_every_partition_without_changing_planar_counts():
    accumulator = handler.RollupAccumulator(_claim())
    occupancy = _occupancy_document()
    occupancy['coverage']['status'] = 'available'
    for index, height in enumerate((-2, 7)):
        source = game(index, index)
        source['analytics_availability'] = {'metrics': dict.fromkeys(
            ('kill_positions', 'death_positions', 'occupancy'), 'available')}
        for participant in source['participants']:
            for event in participant['events']:
                event['replay_z'] = height
        volume = deepcopy(occupancy)
        for row in volume['occupancy']:
            row['cell'][2] = height * 2
        accumulator.add_game(source, occupancy_loader=lambda _: (volume, 123))
    document = accumulator.document()
    for partition in (document, document['matched'], document['team_outcomes']['winning'],
                      document['team_outcomes']['losing']):
        for metric in partition['metrics'].values():
            for group in metric['groups']:
                projected = defaultdict(int)
                for row in group['cells_3d']:
                    projected[tuple(row['cell'][:2])] += row['value']
                assert dict(projected) == {tuple(row['cell']): row['value'] for row in group['cells']}
    cells = document['metrics']['killer_position']['groups'][0]['cells_3d']
    assert {row['cell'][2] for row in cells} == {-4, 14}


def test_missing_elevation_stays_unavailable_instead_of_inventing_a_floor():
    accumulator = handler.MetricAccumulator('events')
    for height in (None, 4):
        accumulator.add(group=(0, 0), cell=(1, 2), elevation=height, value=1,
                        game_id='g', participant_id='p')
    group = accumulator.document(games_selected=1, participants_selected=1)['groups'][0]
    assert group['cells'] == [{'cell': [1, 2], 'value': 2}]
    assert group['cells_3d'] is None
