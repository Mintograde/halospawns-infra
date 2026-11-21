"""Run in the published Python runtime with the packaged native extractor."""
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, call, patch

import worker


def tick(n, x, *, z=0., identity="0x00000001", health=1., hostman=False):
    return {"game_time_info": {"game_time": n}, "players": [{
        "player_index": 0, "object_ref": identity, "derived_stats": {"is_hostman": hostman},
        "player_object_data": {"x": x, "y": -0.25, "z": z, "health": health},
    }]}


def extract(ticks, rate=30, start=0, end=432001):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory, "raw.json")
        path.write_text(json.dumps({"ticks": ticks}))
        return json.loads(subprocess.check_output([
            str(Path(worker.__file__).parent / "movement_field"), "recording",
            str(path), str(rate), str(start), str(end), "0",
        ]))


class MovementTests(unittest.TestCase):
    def test_handler_uses_one_idle_command_and_honors_the_leased_format(self):
        context = Mock()
        context.get_remaining_time_in_millis.return_value = 350000
        job = {"kind": "scope", "lease": "example"}
        with patch.object(worker, "command", side_effect=[{"job": job}, {}, {"job": None}]) as api:
            with patch.object(worker, "scope_product", return_value={}) as product:
                self.assertEqual(worker.handler({}, context), {"processed": 1})
        product.assert_called_once_with("example", "field")
        self.assertEqual(api.call_args_list, [
            call("claim_any", representation="paths"), call("complete", lease="example", product={}),
            call("claim_any", representation="field"),
        ])

    def test_source_rate_independent_distance_and_moving_time(self):
        for rate in (30, 120):
            rows = extract([tick(i, i/rate) for i in range(rate+1)], rate)["0"]
            self.assertEqual(len(rows), 1)
            cell = rows[0]
            self.assertEqual(cell[:8], [0,0,0,0,120,4096,0,0])
            self.assertEqual(cell[11], 120 * 64)

    def test_discontinuities_and_match_bounds(self):
        ticks = [tick(0,0), tick(1,.1), tick(2,.2), tick(3,30), tick(4,30.1,health=0),
                 tick(5,4,identity=2), tick(7,4.1,identity=2), tick(8,4.2,identity=3),
                 tick(9,4.3,hostman=True), tick(10,4.4), tick(11,4.5)]
        rows = extract(ticks, start=1, end=10)["0"]
        self.assertEqual(sum(row[4] for row in rows), 4)
        self.assertEqual(rows[0][:4], [0,0,0,0])

    def test_routes_in_both_directions_and_on_other_floors(self):
        rows = extract([tick(0,.2),tick(1,.3),tick(2,.2),tick(3,.2,z=3),tick(4,.1,z=3)])["0"]
        self.assertEqual([r[:5] for r in rows], [[0,0,0,0,4],[0,0,0,4,4],[0,3,0,4,4]])

    def test_early_recording_requires_a_continuous_living_player(self):
        ticks = [tick(i, i / 30) for i in range(11)]
        for t in ticks:
            player = t["players"][0]
            del player["object_ref"]
            player.update(name="P1", deaths=0, respawn_timer=0)
        ticks[2]["players"][0]["respawn_timer"] = 4
        ticks[4]["players"][0]["name"] = "P2"
        for t in ticks[5:]:
            t["players"][0]["deaths"] = 1
        ticks[7]["players"][0]["player_object_data"]["health"] = 0
        ticks[9]["players"][0]["object_ref"] = "0xffffffff"
        rows = extract(ticks)["0"]
        self.assertEqual(sum(row[4] for row in rows), 8)

    def test_scope_merges_slot_fields_by_actual_result(self):
        row = [0,0,0,0,4,20,0,0,20,128,128,128]
        page = {"next": None, "games": [
            {"winner": 1, "slots": [[0, "a"],[1, "a"]]},
            {"winner": 0, "slots": [[0, "a"]]},
            {"winner": None, "slots": [[1, "a"]]},
            {"winner": None, "slots": [[0, None]]},
        ]}
        with patch.object(worker,"command",return_value=page), patch.object(
            worker,"read_field",return_value=[row]), patch.object(worker,"publish",side_effect=lambda r:r[0][4]):
            product=worker.scope_product("lease")
        self.assertEqual(product, {"games":4,"observed":3,"groups":
            {"all":16,"team:0":8,"team:1":8,"winning":8,"losing":4}})
        self.assertEqual(row[4],4)

    def test_s3_streaming_uses_bounded_reads(self):
        payload=b"read me"
        with patch.object(worker.S3,"get_object",return_value={
            "ContentLength":len(payload),"Body":io.BytesIO(payload)}):
            dst=io.BytesIO()
            self.assertEqual(worker.read_source({},0,len(payload),dst),worker.sha(payload))
            self.assertEqual(dst.getvalue(),payload)
