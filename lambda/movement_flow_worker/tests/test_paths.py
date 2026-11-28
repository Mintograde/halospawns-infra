import json
import math
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import movement_paths as paths
import worker
from test_movement import tick


def extract(ticks, rate):
    with tempfile.TemporaryDirectory() as directory:
        raw = Path(directory, 'recording.json')
        raw.write_text(json.dumps({'ticks': ticks}))
        return json.loads(subprocess.check_output([
            str(Path(worker.__file__).parent / 'movement_field'), 'recording',
            str(raw), str(rate), '0', '432001', '0', '--paths'
        ])).get('0', [])


def positions(route):
    geometry = route['geometry']
    pos = geometry[:3]
    yield 0, [v/512 for v in pos]
    elapsed = 0
    for i in range(3, len(geometry), 4):
        elapsed += geometry[i]
        pos = [a+b for a,b in zip(pos, geometry[i+1:i+4], strict=True)]
        yield elapsed, [v/512 for v in pos]


class PathTests(unittest.TestCase):
    def test_corner_and_overlapping_tails_match_every_source_frame(self):
        for rate in (30, 120):
            # Two halls and a climbing ramp. The first four-unit boundary splits the turn.
            source = [(min(t/rate, 1.87)*2, max(0, t/rate-3), -max(0, t/rate-1.87)*2)
                      for t in range(rate*5+1)]
            ticks = [tick(i, x, z=y) for i, (x,y,_) in enumerate(source)]
            for t, (_,_,z) in zip(ticks, source):
                t['players'][0]['player_object_data']['y'] = -z
            routes = extract(ticks, rate)
            self.assertEqual(sum(r['ticks'] for r in routes), 600)
            self.assertTrue(any(r['lead'] for r in routes))
            self.assertTrue(any(r['key'][3] != r['key'][4] for r in routes))
            for r in routes:
                vertices = list(positions(r))
                self.assertEqual(vertices[-1][0], r['lead']+r['ticks'])
                for (a,p), (b,q) in zip(vertices,vertices[1:]):
                    for t in range(a,b+1,120//rate):
                        original = source[r['start_frame']+t*rate//120]
                        actual = [v+(w-v)*(t-a)/(b-a) for v,w in zip(p,q)]
                        self.assertLess(math.dist(actual,original), .00951)

    def test_deaths_clock_gaps_and_teleports_split_tails(self):
        ticks = [tick(0,0),tick(1,.1),tick(2,.2),tick(3,25),tick(4,25.1),
                 tick(6,25.2),tick(7,25.3),tick(8,25.4,health=0),tick(9,1),tick(10,1.1)]
        routes = extract(ticks,30)
        self.assertEqual([(r['start_frame'],r['ticks'],r['lead']) for r in routes],
                         [(0,8,0),(3,4,0),(5,4,0),(8,4,0)])

    def test_reciprocal_traffic_and_floors_keep_independent_evidence(self):
        raw = []
        for y,direction in [(0,1),(0,1),(0,1),(0,-1),(3,-1)]:
            data = [tick(i, (i if direction==1 else 30-i)/30, z=y) for i in range(31)]
            raw.extend(extract(data,30))
        rows = paths.slot_rows(raw,'source/0')
        self.assertEqual(sorted((r[1],r[3],r[6],r[7]) for r in rows),
                         [(0,0,3,360),(0,8,1,120),(12,8,1,120)])
        combined = {}
        for r in reversed(rows):
            paths.merge(combined,[r])
        self.assertEqual(paths.compact(combined),rows)

    def test_bounded_pooling_retains_support_and_a_witness(self):
        rows = [[x,0,0,d,d,2,1,120,4096,x*11+d,0,str(x)] for x in range(56) for d in (0,8)]
        def result(ordered):
            groups = {}
            paths.merge(groups, ordered)
            return paths.compact(groups,14)
        kept = result(rows)
        self.assertEqual(kept,result(reversed(rows)))
        self.assertEqual(len(kept),14)
        for d in (0,8):
            self.assertEqual(sum(r[6] for r in kept if r[3]==d),56)
        for r in kept:
            self.assertEqual(r[7:9],[r[6]*120,r[6]*4096])
            self.assertTrue(any(original[:6]==r[:6] and original[9:]==r[9:] for original in rows))

    def test_path_scopes_count_only_selected_slots(self):
        row = [0,0,0,0,0,2,1,120,4096,10,0,'witness']
        page={'next':None,'games':[{'winner':0,'slots':[[1,'b'],[0,'a']]},
                                   {'winner':None,'slots':[[0,None]]}]}
        with patch.object(worker,'command',return_value=page) as cmd, patch.object(
            worker,'read_field',return_value=[row]), patch.object(
            worker,'publish',side_effect=lambda rows,schema: rows[0][6]):
            product=worker.scope_product('lease','paths')
        cmd.assert_called_once_with('inputs',lease='lease',after=None,representation='paths')
        self.assertEqual(product,{'games':2,'observed':1,'groups':
            {'all':2,'team:0':1,'team:1':1,'winning':1,'losing':1}})

    def test_spilled_scopes_keep_exact_selection_rows_across_pages(self):
        for representation in ('paths', 'field'):
            games = [{'winner': n % 2, 'slots': [(0, n), (1, n + 1)]}
                     for n in range(1, 8)]
            def read(n, *args):
                if representation == 'paths':
                    return [[k, 0, 0, 0, 8, 2, 1, n, 16, 10 - n, 0, str(n)] for k in (0, n)]
                return [[k, 0, 0, 0, 1, n, 0, 0, 0, 0, 0, 0] for k in (0, n)]

            def render(limit):
                pages = [{'next': 'page', 'games': games[:3]}, {'next': None, 'games': games[3:]}]
                with patch.object(worker, 'command', side_effect=pages), \
                     patch.object(worker, 'MAX_RESIDENT_GROUP_ENTRIES', limit), \
                     patch.object(worker, 'read_field', side_effect=read), \
                     patch.object(worker, 'publish', side_effect=lambda rows, *args: rows):
                    return worker.scope_product('lease', representation)

            self.assertEqual(render(5), render(650000))
