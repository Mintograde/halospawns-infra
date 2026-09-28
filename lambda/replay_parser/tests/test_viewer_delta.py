from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
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
        self.assertEqual(contract.revision, 2)
        self.assertEqual(
            contract.source_contract["projection_sha256"],
            viewer_delta.VIEWER_PROJECTION_SHA256,
        )
        self.assertEqual(
            contract.manifest_sha256, viewer_delta.VIEWER_MANIFEST_SCHEMA_SHA256
        )

    def test_both_revisions_are_pinned_and_unknown_tuples_are_rejected(self) -> None:
        for revision in (1, 2):
            contract = viewer_delta.load_pinned_contract(revision)
            self.assertEqual(
                viewer_delta.resolve_source_contract(contract.source_contract), contract
            )
            with self.assertRaises(viewer_delta.ViewerDeltaError):
                viewer_delta.resolve_source_contract(
                    {**contract.source_contract, "projection_sha256": "0" * 64}
                )
        for revision in (0, 3, True, "2", None, [], {}):
            with (
                self.subTest(revision=revision),
                self.assertRaises(viewer_delta.ViewerDeltaError),
            ):
                viewer_delta.load_pinned_contract(revision)

    def test_revision_two_golden_preserves_field_order_nulls_and_exact_values(
        self,
    ) -> None:
        contract = viewer_delta.load_pinned_contract(2)
        source = json.loads(
            (FIXTURE_DIR / "viewer_v2_first_person_canonical.json").read_text()
        )
        expected = json.loads(
            (FIXTURE_DIR / "viewer_v2_first_person_projected.json").read_text()
        )
        golden = json.loads(
            (FIXTURE_DIR / "viewer_v2_first_person_delta.json").read_text()
        )
        context = viewer_delta._ProjectionContext(
            contract.projection["definitions"], contract.projection["limits"]
        )
        projected = [
            viewer_delta.project_value(
                context.definitions["tick"], tick, context=context
            )
            for tick in source["ticks"]
        ]
        self.assertEqual(json.dumps(projected), json.dumps(expected["ticks"]))
        with tempfile.TemporaryDirectory() as temporary_directory:
            parts = viewer_delta.build_python_viewer_parts(
                FIXTURE_DIR / "viewer_v2_first_person_canonical.json",
                Path(temporary_directory),
            )
            self.assertEqual(parts.profile_revision, 2)
            raw = parts.chunks[0].raw_path.read_bytes()
        self.assertEqual(raw, base64.b64decode(golden["base64"]))
        self.assertEqual(hashlib.sha256(raw).hexdigest(), golden["sha256"])
        self.assertEqual(viewer_delta.decode_replay_delta_chunk(raw)[1], projected)

    def test_revision_two_closed_schema_rejects_invalid_retained_fields(self) -> None:
        invalid_players = [
            {"first_person_weapon": {"animation_tick": 32768}},
            {"first_person_weapon": {"state": -32769}},
            {"first_person_weapon": {"weapon_object": 4294967296}},
            {"first_person_weapon": {"animation_id": True}},
            {"first_person_weapon": {"firing_push_back": float("inf")}},
            {"time_of_last_shot": -1},
            {"time_of_last_shot": 4294967296},
            {"player_speed": 3.5e38},
            {"player_object_data": {"airborne": 256}},
            {"player_object_data": {"airborne_ticks": -1}},
            {"player_object_data": {"zoom_level": 128}},
            {"player_object_data": {"melee_animation_remaining": 256}},
            {"player_object_data": {"weapons": [{"reload_time": -32769}]}},
            {"player_object_data": {"move_left": "0"}},
            {"player_object_data": {"unknown": 1}},
            {"first_person_weapon": {"node_matrices": []}},
        ]
        for player in invalid_players:
            with (
                self.subTest(player=player),
                self.assertRaises(viewer_delta.ViewerDeltaError),
            ):
                viewer_delta.validate_projected({"players": [player]}, 2, "tick")

    def test_nullable_fields_do_not_change_revision_one_or_sparse_maps(self) -> None:
        source = {
            "players": [
                {
                    "first_person_weapon": None,
                    "shots_fired": None,
                    "player_object_data": {"weapons": None, "move_forward": 0},
                }
            ]
        }
        for revision in (1, 2):
            contract = viewer_delta.load_pinned_contract(revision)
            context = viewer_delta._ProjectionContext(
                contract.projection["definitions"], contract.projection["limits"]
            )
            tick = viewer_delta.project_value(
                context.definitions["tick"], source, context=context
            )
            player = tick["players"][0]
            if revision == 1:
                self.assertNotIn("first_person_weapon", player)
                self.assertNotIn("shots_fired", player)
                self.assertEqual(player["player_object_data"], {})
            else:
                self.assertIsNone(player["first_person_weapon"])
                self.assertIsNone(player["shots_fired"])
                self.assertEqual(
                    player["player_object_data"], {"weapons": None, "move_forward": 0}
                )
            node = {"kind": "map", "limit": 2, "values": "nullable_scalar"}
            self.assertEqual(
                viewer_delta.project_value(node, {"0": None, "1": 0}, context=context),
                {"1": 0},
            )

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
    def test_native_default_and_revision_one_override_match_python(self) -> None:
        binary_value = os.getenv("REPLAY_EXTRACTOR_TEST_BINARY")
        if not binary_value:
            self.skipTest("REPLAY_EXTRACTOR_TEST_BINARY is not configured")
        binary = Path(binary_value)
        source = FIXTURE_DIR / "viewer_v2_first_person_canonical.json"
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for revision, flags in ((2, []), (1, ["--viewer-profile-revision", "1"])):
                with self.subTest(revision=revision):
                    directory = root / f"native-{revision}"
                    completed = subprocess.run(
                        [
                            str(binary),
                            "--input",
                            str(source),
                            "--output",
                            str(root / "facts.json"),
                            "--viewer-parts",
                            str(directory),
                            *flags,
                        ],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    self.assertEqual(completed.returncode, 0, completed.stderr)
                    native = viewer_delta.load_native_viewer_parts(
                        directory, native_binary_path=binary, revision=revision
                    )
                    python = viewer_delta.build_python_viewer_parts(
                        source, root / f"python-{revision}", revision=revision
                    )
                    raw = viewer_delta.zstandard.ZstdDecompressor().decompress(
                        native.chunks[0].compressed_path.read_bytes()
                    )
                    self.assertEqual(raw, python.chunks[0].raw_path.read_bytes())
                    self.assertEqual(native.profile_revision, revision)

    def test_revision_two_full_containers_and_reverse_cold_chunks_match(self) -> None:
        binary_value = os.getenv("REPLAY_EXTRACTOR_TEST_BINARY")
        if not binary_value:
            self.skipTest("REPLAY_EXTRACTOR_TEST_BINARY is not configured")
        binary = Path(binary_value)
        source = json.loads(
            (FIXTURE_DIR / "viewer_v2_first_person_canonical.json").read_text()
        )
        expected = json.loads(
            (FIXTURE_DIR / "viewer_v2_first_person_projected.json").read_text()
        )
        source["ticks"] = (source["ticks"] * 316)[:4099]
        expected_ticks = (expected["ticks"] * 316)[:4099]
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_path = root / "source.json"
            source_path.write_text(json.dumps(source), encoding="utf-8")
            python_parts = viewer_delta.build_python_viewer_parts(
                source_path, root / "python", revision=2
            )
            completed = subprocess.run(
                [
                    str(binary),
                    "--input",
                    str(source_path),
                    "--output",
                    str(root / "facts.json"),
                    "--viewer-parts",
                    str(root / "native"),
                    "--viewer-profile-revision",
                    "2",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            native_parts = viewer_delta.load_native_viewer_parts(
                root / "native", native_binary_path=binary, revision=2
            )
            containers = [
                viewer_delta.assemble_viewer_container(
                    parts,
                    root / f"{name}.hsrv",
                    replay_id="fixture",
                    recorded_at="2026-09-27T00:00:00Z",
                )
                for name, parts in (("python", python_parts), ("native", native_parts))
            ]
            self.assertEqual(
                containers[0].path.read_bytes(), containers[1].path.read_bytes()
            )
            for container in containers:
                manifest = viewer_delta.validate_viewer_container(container.path)
                self.assertEqual(manifest["sourceContract"]["profile_revision"], 2)
            for chunk in reversed(native_parts.chunks):
                raw = viewer_delta.zstandard.ZstdDecompressor().decompress(
                    chunk.compressed_path.read_bytes()
                )
                first, ticks = viewer_delta.decode_replay_delta_chunk(raw)
                self.assertEqual(
                    ticks, expected_ticks[first : first + chunk.tick_count]
                )

    def test_native_finalizer_matches_python_container_bytes(self) -> None:
        binary_value = os.getenv("REPLAY_EXTRACTOR_TEST_BINARY")
        if not binary_value:
            self.skipTest("REPLAY_EXTRACTOR_TEST_BINARY is not configured")
        binary_path = Path(binary_value)
        if not binary_path.is_file():
            self.fail(f"Native replay extractor does not exist: {binary_path}")

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            python_parts = viewer_delta.build_python_viewer_parts(
                FIXTURE_DIR / "viewer_v1_canonical.json",
                root / "python-parts",
            )
            python_container = viewer_delta.assemble_viewer_container(
                python_parts,
                root / "python.hsrv",
                replay_id="fixture-replay",
                recorded_at="2026-08-31T12:00:00Z",
            )

            native_parts_directory = root / "native-parts"
            native_parts_directory.mkdir()
            native_extract_output = root / "native-extract.json"
            completed = subprocess.run(
                [
                    str(binary_path),
                    "--input",
                    str(FIXTURE_DIR / "viewer_v1_canonical.json"),
                    "--output",
                    str(native_extract_output),
                    "--cell-size",
                    "0.5",
                    "--viewer-parts",
                    str(native_parts_directory),
                ],
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
            native_parts = viewer_delta.load_native_viewer_parts(
                native_parts_directory,
                native_binary_path=binary_path,
            )
            native_container = viewer_delta.assemble_viewer_container(
                native_parts,
                root / "native.hsrv",
                replay_id="fixture-replay",
                recorded_at="2026-08-31T12:00:00Z",
            )

            validated = viewer_delta.validate_viewer_container(native_container.path)

            self.assertEqual(native_container.path.read_bytes(), python_container.path.read_bytes())
            self.assertEqual(native_container.sha256, python_container.sha256)
            self.assertEqual(validated, native_container.manifest)
            self.assertTrue(all(chunk.raw_path is None for chunk in native_parts.chunks))
            self.assertTrue(
                all(chunk.compressed_path is not None for chunk in native_parts.chunks)
            )

            compressed_path = native_parts.chunks[0].compressed_path
            self.assertIsNotNone(compressed_path)
            compressed = bytearray(compressed_path.read_bytes())
            compressed[-1] ^= 0x01
            compressed_path.write_bytes(compressed)
            with self.assertRaisesRegex(
                viewer_delta.ViewerDeltaError,
                "Native viewer finalizer exited",
            ):
                viewer_delta.assemble_viewer_container(
                    native_parts,
                    root / "corrupt.hsrv",
                    replay_id="fixture-replay",
                    recorded_at="2026-08-31T12:00:00Z",
                )

    def test_api_golden_fixture_matches_projection_and_frontend_bytes(self) -> None:
        contract = viewer_delta.load_pinned_contract(1)
        expected = json.loads(
            (FIXTURE_DIR / "viewer_v1_projected.json").read_text(encoding="utf-8")
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            parts = viewer_delta.build_python_viewer_parts(
                FIXTURE_DIR / "viewer_v1_canonical.json",
                root / "parts",
                revision=1,
            )
            raw = parts.chunks[0].raw_path.read_bytes()
            _, ticks = viewer_delta.decode_replay_delta_chunk(raw)

        projected = {
            "artifact": {
                **contract.source_contract,
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
