from __future__ import annotations

import gzip
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


WORKER_PATH = Path(__file__).resolve().parents[1]
MODULE_PATH = WORKER_PATH / "handler.py"
sys.path.insert(0, str(WORKER_PATH))
SPEC = importlib.util.spec_from_file_location("heatmap_rollup_handler", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
handler = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = handler
SPEC.loader.exec_module(handler)


def _claim(**overrides: object) -> dict[str, object]:
    claim = {
        "scope_id": "11111111-1111-4111-8111-111111111111",
        "scope_type": "map",
        "map_id": "22222222-2222-4222-8222-222222222222",
        "player_id": None,
        "eligibility": "public_stats",
        "source_revision": 7,
        "built_revision": 6,
        "next_generation": 3,
    }
    claim.update(overrides)
    return claim


def _occupancy_document() -> dict[str, object]:
    return {
        "schema": handler.INPUT_SCHEMA,
        "coordinate_space": handler.SOURCE_COORDINATE_SPACE,
        "ticks_per_second": 30,
        "cell_size": 0.5,
        "coverage": {},
        "occupancy": [
            {"slot_index": 0, "cell": [-1, 2, 9], "observed_ticks": 3},
            {"slot_index": 1, "cell": [4, -2, 1], "observed_ticks": 5},
            {"slot_index": 9, "cell": [99, 99, 99], "observed_ticks": 100},
        ],
    }


def _region_claim(**overrides: object) -> dict[str, object]:
    claim = _claim(
        region_configuration_revision=2,
        region_configuration_hash="b" * 64,
        region_stats_requested=True,
    )
    claim.update(overrides)
    return claim


def _region_configuration() -> dict[str, object]:
    region_ids = [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
        "10000000-0000-4000-8000-000000000003",
    ]

    def region(
        index: int,
        key: str,
        minimum_x: float,
        maximum_x: float,
        color: str | None,
    ) -> dict[str, object]:
        return {
            "id": region_ids[index],
            "key": key,
            "display_name": key.title(),
            "display_color": color,
            "geometry": {
                "type": "axis_aligned_box",
                "coordinate_space": handler.SOURCE_COORDINATE_SPACE,
                "boundary": "min_inclusive_max_exclusive",
                "snap_size": 0.5,
                "min": {"x": minimum_x, "y": -1.0, "z": 0.0},
                "max": {"x": maximum_x, "y": 1.0, "z": 1.0},
            },
        }

    return {
        "revision": 2,
        "hash": "b" * 64,
        "coordinate_space": handler.SOURCE_COORDINATE_SPACE,
        "sets": [
            {
                "id": "20000000-0000-4000-8000-000000000001",
                "key": "competitive",
                "display_name": "Competitive",
                "version": 3,
                "is_default": True,
                "regions": [
                    region(0, "negative", -2.0, 0.0, "#3366ff"),
                    region(1, "positive", 0.0, 2.0, "#ff6633"),
                    region(2, "center", -0.5, 0.5, None),
                ],
                "collections": [
                    {
                        "id": "30000000-0000-4000-8000-000000000001",
                        "key": "sides",
                        "display_name": "Sides",
                        "analysis_mode": "partition",
                        "region_ids": region_ids[:2],
                    },
                    {
                        "id": "30000000-0000-4000-8000-000000000002",
                        "key": "overlay",
                        "display_name": "Overlay",
                        "analysis_mode": "overlay",
                        "region_ids": region_ids,
                    },
                ],
            }
        ],
    }


def _region_game(*, document: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "game_id": "33333333-3333-4333-8333-333333333333",
        "participants": [
            {
                "participant_id": "40000000-0000-4000-8000-000000000001",
                "slot_index": 0,
                "team_index": 0,
                "events": [],
            },
            {
                "participant_id": "40000000-0000-4000-8000-000000000002",
                "slot_index": 1,
                "team_index": 1,
                "events": [],
            },
        ],
        "occupancy_artifact": None if document is None else {"placeholder": True},
    }


def _region_occupancy_document(*, cell_size: float = 0.5) -> dict[str, object]:
    return {
        "schema": handler.INPUT_SCHEMA,
        "coordinate_space": handler.SOURCE_COORDINATE_SPACE,
        "ticks_per_second": 30,
        "cell_size": cell_size,
        "coverage": {"status": "available", "discarded_samples": 2},
        "occupancy": [
            {"slot_index": 0, "cell": [-1, 0, 0], "observed_ticks": 30},
            {"slot_index": 0, "cell": [-3, 0, 0], "observed_ticks": 15},
            {"slot_index": 1, "cell": [0, 0, 0], "observed_ticks": 30},
            {"slot_index": 1, "cell": [2, 0, 0], "observed_ticks": 25},
            {"slot_index": 1, "cell": [8, 0, 0], "observed_ticks": 5},
            {"slot_index": 9, "cell": [0, 0, 0], "observed_ticks": 7},
        ],
    }


def _settings() -> handler.Settings:
    return handler.Settings(
        app_api_base_url="https://api.example",
        trusted_client_name="heatmap-processing",
        trusted_client_secret_id="secret-id",
        uploads_bucket="uploads",
        input_prefix="replays/derived/spatial/",
        output_prefix="replays/derived/heatmap-rollups/",
        region_output_prefix="replays/derived/region-stat-rollups/",
        region_schema=handler.REGION_ROLLUP_SCHEMA,
        region_capability=handler.REGION_STATS_CAPABILITY,
        region_stats_enabled=True,
        region_max_membership_checks=5_000_000,
        claim_path="/claim",
        input_path_template="/{scope_id}/inputs",
        complete_path_template="/{scope_id}/complete",
        failed_path_template="/{scope_id}/failed",
        input_page_limit=100,
        max_scopes_per_invocation=1,
        retry_after_seconds=300,
        request_timeout_seconds=30,
    )


class RollupAggregationTests(unittest.TestCase):
    def test_aggregates_all_metrics_team_none_negative_cells_and_selected_slots(self) -> None:
        accumulator = handler.RollupAccumulator(_claim())
        game = {
            "game_id": "33333333-3333-4333-8333-333333333333",
            "participants": [
                {
                    "participant_id": "44444444-4444-4444-8444-444444444444",
                    "player_id": None,
                    "slot_index": 0,
                    "team_index": 0,
                    "team_name": "Red",
                    "events": [
                        {
                            "event_type": "killer_position",
                            "event_tick": 10,
                            "event_ordinal": 0,
                            "replay_x": -0.1,
                            "replay_y": 0.1,
                            "replay_z": 3.0,
                        }
                    ],
                },
                {
                    "participant_id": "55555555-5555-4555-8555-555555555555",
                    "player_id": None,
                    "slot_index": 1,
                    "team_index": None,
                    "team_name": None,
                    "events": [
                        {
                            "event_type": "victim_position",
                            "event_tick": 11,
                            "event_ordinal": 0,
                            "replay_x": 1.0,
                            "replay_y": -1.0,
                            "replay_z": 2.0,
                        }
                    ],
                },
            ],
            "occupancy_artifact": {"placeholder": True},
        }

        accumulator.add_game(game, occupancy_loader=lambda manifest: (_occupancy_document(), 123))
        document = accumulator.document()

        self.assertEqual(document["scope"]["source_revision"], 7)
        occupancy = document["metrics"]["occupancy"]
        self.assertEqual(
            occupancy["groups"],
            [
                {
                    "key": "team:0",
                    "label": "Team 0",
                    "team_index": 0,
                    "cells": [{"cell": [-1, -3], "value": 3}],
                },
                {
                    "key": "team:none",
                    "label": "No team",
                    "team_index": None,
                    "cells": [{"cell": [4, 1], "value": 5}],
                },
            ],
        )
        self.assertEqual(
            occupancy["summary"],
            {
                "games_selected": 1,
                "games_contributing": 1,
                "participants_selected": 2,
                "participants_contributing": 2,
            },
        )
        self.assertEqual(
            document["metrics"]["killer_position"]["groups"][0]["cells"],
            [{"cell": [-1, -1], "value": 1}],
        )
        self.assertEqual(
            document["metrics"]["victim_position"]["groups"][0]["cells"],
            [{"cell": [2, 2], "value": 1}],
        )
        self.assertEqual(accumulator.input_bytes, 123)
        self.assertEqual(accumulator.cell_count(), 4)

    def test_player_scope_ignores_occupancy_for_unselected_slots(self) -> None:
        accumulator = handler.RollupAccumulator(
            _claim(
                scope_type="player_map",
                player_id="66666666-6666-4666-8666-666666666666",
            )
        )
        accumulator.add_game(
            {
                "game_id": "33333333-3333-4333-8333-333333333333",
                "participants": [
                    {
                        "participant_id": "44444444-4444-4444-8444-444444444444",
                        "slot_index": 0,
                        "team_index": 0,
                        "events": [],
                    }
                ],
                "occupancy_artifact": {},
            },
            occupancy_loader=lambda manifest: (_occupancy_document(), 10),
        )
        groups = accumulator.document()["metrics"]["occupancy"]["groups"]
        self.assertEqual(groups[0]["cells"], [{"cell": [-1, -3], "value": 3}])

    def test_empty_scope_has_complete_zero_summaries(self) -> None:
        document = handler.RollupAccumulator(_claim()).document()
        for metric in handler.METRICS:
            self.assertEqual(document["metrics"][metric]["groups"], [])
            self.assertEqual(
                document["metrics"][metric]["summary"],
                {
                    "games_selected": 0,
                    "games_contributing": 0,
                    "participants_selected": 0,
                    "participants_contributing": 0,
                },
            )


class RegionRollupTests(unittest.TestCase):
    def _accumulator(
        self,
        *,
        claim: dict[str, object] | None = None,
        max_membership_checks: int = 5_000_000,
    ) -> handler.RollupAccumulator:
        selected_claim = claim or _region_claim()
        configuration = handler.parse_region_configuration(
            _region_configuration(),
            expected_revision=2,
            expected_hash="b" * 64,
        )
        region_accumulator = handler.RegionAccumulator(
            claim=selected_claim,
            configuration=configuration,
            max_membership_checks=max_membership_checks,
        )
        return handler.RollupAccumulator(
            selected_claim,
            region_accumulator=region_accumulator,
        )

    def test_one_pass_preserves_heatmap_and_builds_exact_region_totals(self) -> None:
        document = _region_occupancy_document()
        accumulator = self._accumulator()
        accumulator.add_game(
            _region_game(document=document),
            occupancy_loader=lambda manifest: (document, 321),
        )

        heatmap = accumulator.document()
        occupancy_groups = heatmap["metrics"]["occupancy"]["groups"]
        self.assertEqual(
            sum(cell["value"] for group in occupancy_groups for cell in group["cells"]),
            105,
        )
        assert accumulator.region_accumulator is not None
        region_document = accumulator.region_accumulator.document(
            generated_at="2026-07-14T12:00:00Z"
        )
        all_group, team_zero, team_one = region_document["groups"]
        self.assertEqual(all_group["key"], "all")
        self.assertEqual(all_group["observed_player_ticks_total"], 105)
        self.assertEqual(
            [item["observed_player_ticks"] for item in all_group["regions"]],
            [45, 55, 60],
        )
        partition, overlay = all_group["collections"]
        self.assertEqual(
            (partition["member_ticks"], partition["union_ticks"], partition["outside_ticks"], partition["overlap_ticks"]),
            (100, 100, 5, 0),
        )
        self.assertEqual(
            (overlay["member_ticks"], overlay["union_ticks"], overlay["outside_ticks"], overlay["overlap_ticks"]),
            (160, 100, 5, 60),
        )
        self.assertEqual(
            (team_zero["key"], team_zero["observed_player_ticks_total"]),
            ("team:0", 45),
        )
        self.assertEqual(
            (team_one["key"], team_one["observed_player_ticks_total"]),
            ("team:1", 60),
        )
        summary = region_document["summary"]
        self.assertEqual(summary["discarded_player_ticks"], 7)
        self.assertEqual(summary["discarded_samples"], 2)
        self.assertEqual(summary["membership_precision"], "grid_exact")
        self.assertEqual(summary["region_membership_checks"], 15)
        self.assertFalse(summary["coverage_complete"])

    def test_coarser_voxels_use_center_membership_and_projection(self) -> None:
        document = _region_occupancy_document(cell_size=1.0)
        document["coverage"] = {"status": "available"}
        document["occupancy"] = [
            {"slot_index": 0, "cell": [-1, 0, 0], "observed_ticks": 3},
            {"slot_index": 0, "cell": [0, 0, 0], "observed_ticks": 4},
        ]
        accumulator = self._accumulator()
        accumulator.add_game(
            _region_game(document=document),
            occupancy_loader=lambda manifest: (document, 20),
        )

        assert accumulator.region_accumulator is not None
        region_document = accumulator.region_accumulator.document(
            generated_at="2026-07-14T12:00:00Z"
        )
        self.assertEqual(
            [item["observed_player_ticks"] for item in region_document["groups"][0]["regions"][:2]],
            [3, 4],
        )
        self.assertEqual(
            region_document["summary"]["membership_precision"],
            "voxel_center",
        )
        heatmap_cells = accumulator.document()["metrics"]["occupancy"]["groups"][0]["cells"]
        self.assertEqual(heatmap_cells, [{"cell": [-1, -1], "value": 3}, {"cell": [1, -1], "value": 4}])

    def test_missing_and_incompatible_games_are_bounded_coverage_not_failures(self) -> None:
        accumulator = self._accumulator()
        accumulator.add_game(
            _region_game(document=None),
            occupancy_loader=lambda manifest: self.fail("missing manifests are not loaded"),
        )
        incompatible = _region_occupancy_document()
        incompatible["coverage"] = {"status": "unavailable"}
        accumulator.add_game(
            _region_game(document=incompatible),
            occupancy_loader=lambda manifest: (incompatible, 40),
        )

        assert accumulator.region_accumulator is not None
        summary = accumulator.region_accumulator.summary()
        self.assertEqual(summary["games_selected"], 2)
        self.assertEqual(summary["games_contributing"], 0)
        self.assertEqual(summary["games_missing_data"], 2)
        self.assertEqual(summary["incompatible_games"], 1)
        self.assertEqual(summary["participants_selected"], 4)
        self.assertFalse(summary["coverage_complete"])

    def test_membership_work_limit_is_enforced_without_geometry_in_error(self) -> None:
        document = _region_occupancy_document()
        accumulator = self._accumulator(max_membership_checks=1)
        with self.assertRaises(handler.RegionStatsError) as raised:
            accumulator.add_game(
                _region_game(document=document),
                occupancy_loader=lambda manifest: (document, 10),
            )
        self.assertEqual(raised.exception.error_code, "region_membership_limit_exceeded")
        self.assertNotIn("axis_aligned_box", raised.exception.safe_message)

    def test_configuration_parser_rejects_unsnapped_geometry(self) -> None:
        configuration = _region_configuration()
        configuration["sets"][0]["regions"][0]["geometry"]["min"]["x"] = -1.9
        with self.assertRaises(handler.RegionStatsError) as raised:
            handler.parse_region_configuration(
                configuration,
                expected_revision=2,
                expected_hash="b" * 64,
            )
        self.assertEqual(raised.exception.error_code, "invalid_region_configuration")


class DeterminismAndIntegrityTests(unittest.TestCase):
    def test_bounded_writer_produces_deterministic_gzip(self) -> None:
        document = handler.RollupAccumulator(_claim()).document()

        def write_once(path: Path) -> bytes:
            with path.open("wb") as target:
                with gzip.GzipFile(
                    filename="",
                    fileobj=target,
                    mode="wb",
                    compresslevel=6,
                    mtime=0,
                ) as compressed:
                    writer = handler._BoundedJsonWriter(compressed, 1024 * 1024)
                    json.dump(document, writer, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
            return path.read_bytes()

        with tempfile.TemporaryDirectory() as directory:
            first = write_once(Path(directory) / "first.gz")
            second = write_once(Path(directory) / "second.gz")

        self.assertEqual(first, second)
        self.assertEqual(json.loads(gzip.decompress(first)), document)

    def test_hmac_signature_matches_replay_processor_contract(self) -> None:
        signature = handler._hmac_signature(
            client="heatmap-processing",
            timestamp="123",
            method="GET",
            raw_path="/v1/ingest/heatmap-rollups/scope/inputs",
            raw_query_string="source_revision=7&limit=100",
            body=b"",
            secret="secret",
        )
        canonical = "\n".join(
            (
                "HALOSPAWNS-HMAC-SHA256",
                "heatmap-processing",
                "123",
                "GET",
                "/v1/ingest/heatmap-rollups/scope/inputs",
                "source_revision=7&limit=100",
                hashlib.sha256(b"").hexdigest(),
            )
        )
        expected = __import__("hmac").new(b"secret", canonical.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(signature, expected)

    def test_immutable_existing_generation_requires_same_hash_and_size(self) -> None:
        settings = _settings()
        with patch.object(
            handler.S3,
            "head_object",
            return_value={"ContentLength": 20, "Metadata": {"sha256": "b" * 64}},
        ):
            with self.assertRaises(handler.RollupError) as raised:
                handler._require_matching_existing_output(settings, "key", 10, "a" * 64)
        self.assertEqual(raised.exception.error_code, "immutable_generation_conflict")
        self.assertFalse(raised.exception.retryable)

    def test_runtime_metrics_record_api_and_decoded_s3_input(self) -> None:
        raw = json.dumps(_occupancy_document(), separators=(",", ":")).encode()
        compressed = gzip.compress(raw, mtime=0)
        manifest = {
            "schema": handler.INPUT_SCHEMA,
            "coordinate_space": handler.SOURCE_COORDINATE_SPACE,
            "cell_size": handler.SOURCE_CELL_SIZE,
            "s3_bucket": "uploads",
            "s3_key": "replays/derived/spatial/input.json.gz",
            "encoding": "gzip",
            "size_bytes": len(compressed),
            "sha256": hashlib.sha256(compressed).hexdigest(),
        }
        metrics = handler.RuntimeMetrics()
        with patch.object(
            handler.S3,
            "get_object",
            return_value={"Body": io.BytesIO(compressed)},
        ):
            document, downloaded = handler._load_occupancy_artifact(
                _settings(),
                manifest,
                metrics,
            )

        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true,"data":{"value":1}}'
        with (
            patch.object(handler, "_secret_value", return_value="secret"),
            patch.object(handler.urllib.request, "urlopen", return_value=response),
        ):
            api_data = handler._api_request(
                _settings(),
                "GET",
                "/test",
                runtime_metrics=metrics,
            )

        self.assertEqual(document, _occupancy_document())
        self.assertEqual(downloaded, len(compressed))
        self.assertEqual(metrics.s3_gets, 1)
        self.assertEqual(metrics.input_decoded_bytes, len(raw))
        self.assertEqual(api_data, {"value": 1})
        self.assertEqual(metrics.api_requests, 1)
        self.assertGreaterEqual(metrics.api_duration_ms, 0)

    def test_region_artifact_gzip_is_deterministic_and_bounded(self) -> None:
        accumulator = RegionRollupTests()._accumulator()
        assert accumulator.region_accumulator is not None
        document = accumulator.region_accumulator.document(
            generated_at="2026-07-14T12:00:00Z"
        )
        bodies: list[bytes] = []

        def capture_put(**kwargs: object) -> dict[str, object]:
            bodies.append(kwargs["Body"].read())
            return {}

        artifacts: list[handler.GeneratedArtifact] = []
        with patch.object(handler.S3, "put_object", side_effect=capture_put):
            for _ in range(2):
                artifact = handler._write_region_rollup_artifact(
                    settings=_settings(),
                    claim=_region_claim(),
                    document=document,
                    output_key="replays/derived/region-stat-rollups/scopes/scope/generation-3.json.gz",
                    summary=accumulator.region_accumulator.summary(),
                    source_cells=0,
                    generated_at="2026-07-14T12:00:00Z",
                )
                artifacts.append(artifact)

        try:
            self.assertEqual(bodies[0], bodies[1])
            self.assertEqual(artifacts[0].sha256, artifacts[1].sha256)
            self.assertEqual(json.loads(gzip.decompress(bodies[0])), document)
        finally:
            for artifact in artifacts:
                artifact.path.unlink(missing_ok=True)

    def test_existing_region_generation_reuses_persisted_timestamp(self) -> None:
        metadata = {
            "schema": handler.REGION_ROLLUP_SCHEMA,
            "scope-id": str(_region_claim()["scope_id"]),
            "source-revision": "7",
            "generation": "3",
            "region-configuration-revision": "2",
            "region-configuration-hash": "b" * 64,
            "generated-at": "2026-07-14T12:00:00Z",
        }
        with patch.object(handler.S3, "head_object", return_value={"Metadata": metadata}):
            generated_at = handler._region_generated_at(
                _settings(),
                _region_claim(),
                "region-key",
            )
        self.assertEqual(generated_at, "2026-07-14T12:00:00Z")


class ScopeExecutionTests(unittest.TestCase):
    def test_claim_advertises_region_capability(self) -> None:
        with patch.object(
            handler,
            "_api_request",
            return_value={"processed_result": {"claims": []}},
        ) as request:
            claims = handler._claim_scopes(_settings())

        self.assertEqual(claims, [])
        self.assertEqual(
            request.call_args.kwargs["payload"],
            {"limit": 1, "capabilities": ["region_stats_v1"]},
        )

    def test_paired_completion_uses_existing_route_and_atomic_manifest(self) -> None:
        with tempfile.NamedTemporaryFile(delete=False) as heatmap_target:
            heatmap_path = Path(heatmap_target.name)
        with tempfile.NamedTemporaryFile(delete=False) as region_target:
            region_path = Path(region_target.name)
        heatmap = handler.GeneratedArtifact(
            path=heatmap_path,
            bucket="uploads",
            key="heatmap-key",
            size_bytes=20,
            sha256="a" * 64,
            cell_count=1,
            summary={"games_selected": 1},
        )
        region = handler.GeneratedArtifact(
            path=region_path,
            bucket="uploads",
            key="region-key",
            size_bytes=10,
            sha256="c" * 64,
            cell_count=1,
            summary={"games_selected": 1},
        )
        with patch.object(
            handler,
            "_api_request",
            return_value={"processed_result": {"activated": True, "stale": False}},
        ) as request:
            completed = handler._complete_scope(
                _settings(),
                _region_claim(),
                heatmap,
                region,
            )

        try:
            payload = request.call_args.kwargs["payload"]
            self.assertTrue(completed["activated"])
            self.assertEqual(payload["artifact"]["s3_key"], "heatmap-key")
            self.assertEqual(payload["region_artifact"]["s3_key"], "region-key")
            self.assertEqual(
                payload["region_artifact"]["region_configuration"],
                {
                    "revision": 2,
                    "hash": "b" * 64,
                    "coordinate_space": handler.SOURCE_COORDINATE_SPACE,
                },
            )
            self.assertEqual(request.call_args.args[2], "/11111111-1111-4111-8111-111111111111/complete")
        finally:
            heatmap_path.unlink(missing_ok=True)
            region_path.unlink(missing_ok=True)

    def test_paginates_revision_pinned_inputs_and_deletes_stale_output(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".json.gz", delete=False) as target:
            generated_path = Path(target.name)
        generated = handler.GeneratedArtifact(
            path=generated_path,
            bucket="uploads",
            key="replays/derived/heatmap-rollups/scopes/scope/generation-3.json.gz",
            size_bytes=20,
            sha256="a" * 64,
            cell_count=0,
            summary={"games_selected": 1},
        )
        game = {
            "game_id": "33333333-3333-4333-8333-333333333333",
            "participants": [],
            "occupancy_artifact": None,
        }
        with (
            patch.object(
                handler,
                "_list_inputs",
                side_effect=[
                    {"games": [game], "next_cursor": game["game_id"]},
                    {"games": [], "next_cursor": None},
                ],
            ) as list_inputs,
            patch.object(handler, "_write_rollup_artifact", return_value=generated),
            patch.object(handler, "_complete_scope", return_value={"activated": False, "stale": True}),
            patch.object(handler, "_delete_generated_artifact") as delete_artifact,
        ):
            result = handler._process_claim(_settings(), _claim())

        self.assertEqual(result.status, "stale")
        self.assertEqual(list_inputs.call_args_list[0].kwargs["cursor"], None)
        self.assertEqual(list_inputs.call_args_list[1].kwargs["cursor"], game["game_id"])
        delete_artifact.assert_called_once_with(generated)
        self.assertFalse(generated_path.exists())

    def test_stale_paired_completion_discards_both_generations(self) -> None:
        paths: list[Path] = []
        for _ in range(2):
            with tempfile.NamedTemporaryFile(suffix=".json.gz", delete=False) as target:
                paths.append(Path(target.name))
        heatmap = handler.GeneratedArtifact(
            path=paths[0],
            bucket="uploads",
            key="heatmap-key",
            size_bytes=20,
            sha256="a" * 64,
            cell_count=0,
            summary={"games_selected": 1},
        )
        region = handler.GeneratedArtifact(
            path=paths[1],
            bucket="uploads",
            key="region-key",
            size_bytes=10,
            sha256="c" * 64,
            cell_count=0,
            summary={"games_selected": 1},
        )
        page = {
            "games": [_region_game(document=None)],
            "next_cursor": None,
            "region_configuration": _region_configuration(),
        }
        with (
            patch.object(handler, "_list_inputs", return_value=page),
            patch.object(handler, "_write_rollup_artifact", return_value=heatmap),
            patch.object(handler, "_region_generated_at", return_value="2026-07-14T12:00:00Z"),
            patch.object(handler, "_write_region_rollup_artifact", return_value=region),
            patch.object(handler, "_complete_scope", return_value={"activated": False, "stale": True}),
            patch.object(handler, "_delete_generated_artifact") as delete_artifact,
        ):
            result = handler._process_claim(_settings(), _region_claim())

        self.assertEqual(result.status, "stale")
        self.assertEqual(delete_artifact.call_args_list[0].args[0], heatmap)
        self.assertEqual(delete_artifact.call_args_list[1].args[0], region)
        self.assertEqual(result.region_output_bytes, 10)
        self.assertTrue(all(not path.exists() for path in paths))

    def test_reports_safe_nonretryable_input_failure(self) -> None:
        bad_game = {
            "game_id": "33333333-3333-4333-8333-333333333333",
            "participants": [{"participant_id": "p", "slot_index": 0, "team_index": 0, "events": None}],
            "occupancy_artifact": None,
        }
        with (
            patch.object(handler, "_list_inputs", return_value={"games": [bad_game], "next_cursor": None}),
            patch.object(handler, "_fail_scope") as fail_scope,
        ):
            result = handler._process_claim(_settings(), _claim())

        self.assertEqual(result.status, "failed")
        reported = fail_scope.call_args.args[2]
        self.assertEqual(reported.error_code, "invalid_api_contract")
        self.assertFalse(reported.retryable)


if __name__ == "__main__":
    unittest.main()
