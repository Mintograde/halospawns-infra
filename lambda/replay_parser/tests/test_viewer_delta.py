from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")

REPLAY_PARSER_DIR = Path(__file__).resolve().parents[1]
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "replays"
if str(REPLAY_PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(REPLAY_PARSER_DIR))

import viewer_delta  # noqa: E402


class ViewerDeltaCodecTests(unittest.TestCase):
    def test_vendored_contracts_match_the_api_owned_hashes(self) -> None:
        contract = viewer_delta.load_pinned_contract()

        self.assertEqual(contract.projection["schema"], viewer_delta.VIEWER_SCHEMA)
        self.assertEqual(contract.encoding["format"], viewer_delta.VIEWER_DELTA_FORMAT)

    def test_python_encoder_matches_the_frontend_v1_reference_bytes(self) -> None:
        ticks = [
            {
                "current_tick": 1,
                "players": [{"player_index": 0, "x": 1.5, "name": "A"}],
                "flags": [True, False, None],
            },
            {
                "current_tick": 2,
                "players": [{"player_index": 0, "x": 1.75, "name": "A"}],
                "flags": [True, False, None],
            },
            {
                "current_tick": 3,
                "players": [{"player_index": 0, "x": 2.0, "name": "B"}],
                "flags": [True, True, None],
            },
        ]
        expected_hex = (
            "4853524401070308031963757272656e745f7469636b0300010f706c6179657273"
            "0701080319706c617965725f696e6465780300000378040000c03f096e616d6506"
            "03410b666c61677307030201000200020006020207020001060580808001020003"
            "0006020207020002060d0008010603420c030301010102"
        )

        encoded = viewer_delta.encode_replay_delta_chunk(ticks, first_tick=7)
        first_tick, decoded = viewer_delta.decode_replay_delta_chunk(encoded)

        self.assertEqual(encoded.hex(), expected_hex)
        self.assertEqual(first_tick, 7)
        self.assertTrue(viewer_delta._deep_exact_equal(decoded, ticks))

    def test_tick_hash_serialization_matches_json_stringify_numbers(self) -> None:
        value = [
            -0.0,
            333333333.33333329,
            1e30,
            4.50,
            2e-3,
            1e-27,
            1e-6,
            1e-7,
            1e20,
            1e21,
        ]

        self.assertEqual(
            viewer_delta._tick_hash_json_bytes(value),
            b"[0,333333333.3333333,1e+30,4.5,0.002,1e-27,0.000001,1e-7,100000000000000000000,1e+21]",
        )


class ViewerArtifactBuilderTests(unittest.TestCase):
    def test_api_golden_fixture_matches_projection_and_frontend_bytes(self) -> None:
        expected = json.loads(
            (FIXTURE_DIR / "viewer_v1_projected.json").read_text(encoding="utf-8")
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            parts = viewer_delta.build_python_viewer_parts(
                FIXTURE_DIR / "viewer_v1_canonical.json",
                root / "parts",
            )
            raw = parts.chunks[0].raw_path.read_bytes()
            _, ticks = viewer_delta.decode_replay_delta_chunk(raw)

        projected = {
            "artifact": {
                "schema": viewer_delta.VIEWER_SCHEMA,
                "profile": viewer_delta.VIEWER_PROFILE,
                "profile_revision": viewer_delta.VIEWER_PROFILE_REVISION,
                "projection_sha256": viewer_delta.VIEWER_PROJECTION_SHA256,
                "tick_count": parts.tick_count,
            },
            **parts.replay,
            "ticks": ticks,
        }
        self.assertTrue(viewer_delta._deep_exact_equal(projected, expected))
        self.assertEqual(raw, (FIXTURE_DIR / "viewer_v1_delta_chunk.hsrd").read_bytes())

    def test_streaming_projection_is_bounded_and_container_is_deterministic(self) -> None:
        source = {
            "summary": {
                "game_id": "game-1",
                "recording_started": "2026-08-31T12:00:00Z",
                "unknown": "excluded",
            },
            "events": ["start", "end"],
            "unknown_root": {"large": [1, 2, 3]},
            "ticks": [
                {
                    "current_tick": 1,
                    "players": [
                        {
                            "player_index": 0,
                            "name": "A",
                            "unknown": "excluded",
                            "player_object_data": {"x": 1.0, "y": 2.0, "z": 3.0},
                        }
                    ],
                },
                {
                    "current_tick": 2,
                    "players": [
                        {
                            "player_index": 0,
                            "name": "A",
                            "player_object_data": {"x": 1.5, "y": 2.0, "z": 3.0},
                        }
                    ],
                },
            ],
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_path = root / "source.json"
            source_path.write_text(json.dumps(source), encoding="utf-8")
            first_parts = viewer_delta.build_python_viewer_parts(source_path, root / "first")
            second_parts = viewer_delta.build_python_viewer_parts(source_path, root / "second")
            first = viewer_delta.assemble_viewer_container(
                first_parts,
                root / "first.hsrv",
                replay_id="game-1",
                recorded_at="2026-08-31T12:00:00Z",
            )
            second = viewer_delta.assemble_viewer_container(
                second_parts,
                root / "second.hsrv",
                replay_id="game-1",
                recorded_at="2026-08-31T12:00:00Z",
            )

            manifest = viewer_delta.validate_viewer_container(first.path)

        self.assertEqual(first.sha256, second.sha256)
        self.assertEqual(first.size_bytes, second.size_bytes)
        self.assertEqual(manifest["tickCount"], 2)
        self.assertNotIn("unknown", manifest["replay"]["summary"])
        self.assertEqual(manifest["sourceContract"]["projection_sha256"], viewer_delta.VIEWER_PROJECTION_SHA256)

    def test_chunk_boundaries_never_exceed_the_pinned_keyframe_interval(self) -> None:
        source = {
            "ticks": [
                {"current_tick": index, "players": []}
                for index in range(viewer_delta.VIEWER_KEYFRAME_INTERVAL + 1)
            ]
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_path = root / "source.json"
            source_path.write_text(json.dumps(source), encoding="utf-8")
            parts = viewer_delta.build_python_viewer_parts(source_path, root / "parts")

        self.assertEqual([chunk.tick_count for chunk in parts.chunks], [2048, 1])

    def test_streaming_projection_uses_contract_field_order(self) -> None:
        source = {
            "ticks": [
                {
                    "start_time": "later-in-source",
                    "game_type": 2,
                    "game_time_info": {"ticks": 1},
                }
            ]
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_path = root / "source.json"
            source_path.write_text(json.dumps(source), encoding="utf-8")
            parts = viewer_delta.build_python_viewer_parts(source_path, root / "parts")
            _, ticks = viewer_delta.decode_replay_delta_chunk(parts.chunks[0].raw_path.read_bytes())

        self.assertEqual(list(ticks[0]), ["game_time_info", "game_type", "start_time"])


if __name__ == "__main__":
    unittest.main()
