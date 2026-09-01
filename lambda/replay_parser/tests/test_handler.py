from __future__ import annotations

import gzip
import hashlib
import io
import json
import math
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")

REPLAY_PARSER_DIR = Path(__file__).resolve().parents[1]
if str(REPLAY_PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(REPLAY_PARSER_DIR))

import handler  # noqa: E402
import viewer_delta  # noqa: E402


class SigningCredentialTests(unittest.TestCase):
    def setUp(self) -> None:
        handler.PARAMETER_CACHE.clear()

    def test_parameter_store_value_is_cached(self) -> None:
        settings = {"trusted_client_parameter_name": "/test/hmac"}
        with patch.object(
            handler.SSM,
            "get_parameter",
            return_value={"Parameter": {"Value": "parameter-value"}},
        ) as get_parameter:
            self.assertEqual(handler._signing_secret(settings), "parameter-value")
            self.assertEqual(handler._signing_secret(settings), "parameter-value")

        get_parameter.assert_called_once_with(Name="/test/hmac", WithDecryption=True)

    def test_configured_empty_parameter_fails_closed(self) -> None:
        settings = {"trusted_client_parameter_name": "/test/hmac"}
        with patch.object(
            handler.SSM,
            "get_parameter",
            return_value={"Parameter": {"Value": ""}},
        ):
            with self.assertRaises(handler.ReplayProcessingError) as raised:
                handler._signing_secret(settings)

        self.assertNotIn("/test/hmac", str(raised.exception))

    def test_settings_require_parameter_store_contract(self) -> None:
        with patch.dict(
            os.environ,
            {
                "APP_API_BASE_URL": "https://api.example",
                "APP_API_TRUSTED_CLIENT_NAME": "replay-processing",
                "APP_API_TRUSTED_CLIENT_HMAC_PARAMETER_NAME": "/test/hmac",
            },
            clear=True,
        ):
            settings = handler._settings()

        self.assertEqual(settings["trusted_client_parameter_name"], "/test/hmac")

    def test_settings_reject_missing_parameter_name(self) -> None:
        with patch.dict(
            os.environ,
            {
                "APP_API_BASE_URL": "https://api.example",
                "APP_API_TRUSTED_CLIENT_NAME": "replay-processing",
            },
            clear=True,
        ):
            with self.assertRaises(handler.ReplayProcessingError):
                handler._settings()


class ReplayStorageAndCallbackTests(unittest.TestCase):
    def test_canonical_source_key_matches_api_content_addressed_layout(self) -> None:
        upload_id = "66666666-6666-4666-8666-666666666666"
        source_sha256 = "a" * 64
        with patch.object(
            handler,
            "_settings",
            return_value={"processed_prefix": "replays/processed/"},
        ):
            key = handler._canonical_source_key(
                upload_id,
                source_sha256,
                "My Replay+.JSON.ZST",
            )

        self.assertEqual(
            key,
            f"replays/processed/{upload_id}/sources/{source_sha256}/"
            "My_Replay_.JSON.ZST",
        )

    def test_download_uses_the_queued_s3_version_and_verifies_source_facts(self) -> None:
        body = b"version-pinned-replay"
        replay_object = handler.S3ReplayObject(
            bucket="uploads-bucket",
            key="replays/processed/upload/source.json.zst",
            event_name="manual_reprocess",
            sqs_message_id="message-1",
            version_id="source-version-1",
            expected_size_bytes=len(body),
            expected_sha256=hashlib.sha256(body).hexdigest(),
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            destination = Path(temporary_directory) / "source.json.zst"
            with patch.object(
                handler.S3,
                "get_object",
                return_value={
                    "Body": io.BytesIO(body),
                    "ContentType": "application/zstd",
                    "Metadata": {},
                    "VersionId": "source-version-1",
                },
            ) as get_object:
                downloaded = handler._download_replay(replay_object, destination)

        get_object.assert_called_once_with(
            Bucket="uploads-bucket",
            Key="replays/processed/upload/source.json.zst",
            VersionId="source-version-1",
        )
        self.assertEqual(downloaded.sha256, hashlib.sha256(body).hexdigest())
        self.assertEqual(downloaded.version_id, "source-version-1")

    def test_download_rejects_source_hash_and_version_mismatches(self) -> None:
        body = b"version-pinned-replay"
        cases = (
            ("0" * 64, "source-version-1", "source-version-1", "hash"),
            (hashlib.sha256(body).hexdigest(), "source-version-1", "wrong-version", "version"),
        )
        for expected_hash, requested_version, response_version, label in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temporary_directory:
                replay_object = handler.S3ReplayObject(
                    bucket="uploads-bucket",
                    key="replays/processed/upload/source.json.zst",
                    event_name="manual_reprocess",
                    sqs_message_id="message-1",
                    version_id=requested_version,
                    expected_size_bytes=len(body),
                    expected_sha256=expected_hash,
                )
                with patch.object(
                    handler.S3,
                    "get_object",
                    return_value={
                        "Body": io.BytesIO(body),
                        "ContentType": "application/zstd",
                        "Metadata": {},
                        "VersionId": response_version,
                    },
                ):
                    with self.assertRaises(handler.NonRetryableReplayError):
                        handler._download_replay(
                            replay_object,
                            Path(temporary_directory) / "source.json.zst",
                        )

    def test_download_verifies_initial_upload_integrity_metadata(self) -> None:
        body = b"initial-upload"
        replay_object = handler.S3ReplayObject(
            bucket="uploads-bucket",
            key="replays/unprocessed/upload-source.json.zst",
            event_name="ObjectCreated:Put",
            sqs_message_id="message-1",
        )
        with tempfile.TemporaryDirectory() as temporary_directory, patch.object(
            handler.S3,
            "get_object",
            return_value={
                "Body": io.BytesIO(body),
                "ContentType": "application/zstd",
                "Metadata": {
                    "expected-size-bytes": str(len(body)),
                    "expected-sha256": "0" * 64,
                },
            },
        ):
            with self.assertRaises(handler.NonRetryableReplayError):
                handler._download_replay(
                    replay_object,
                    Path(temporary_directory) / "source.json.zst",
                )

    def test_decompresses_every_supported_replay_wrapper(self) -> None:
        body = b'{"ticks":[{"current_tick":1}]}'
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            sources = {
                "raw.json": body,
                "replay.json.gz": gzip.compress(body, mtime=0),
                "replay.json.zst": handler.zstandard.ZstdCompressor().compress(body),
            }
            for filename, encoded in sources.items():
                (directory / filename).write_bytes(encoded)
            zip_path = directory / "replay.zip"
            with zipfile.ZipFile(zip_path, "w") as archive:
                archive.writestr("replay.json", body)

            for index, source in enumerate((*sources, "replay.zip")):
                with self.subTest(source=source):
                    destination = directory / f"decoded-{index}.json"
                    handler._decompress_replay(directory / source, destination)
                    self.assertEqual(destination.read_bytes(), body)

    def test_rejects_replay_json_over_the_decompressed_size_limit(self) -> None:
        source = io.BytesIO(b"four")
        destination = io.BytesIO()

        with self.assertRaisesRegex(
            handler.NonRetryableReplayError,
            "pinned decompressed size limit",
        ):
            handler._copy_bounded_replay_json(source, destination, max_bytes=3)

        self.assertEqual(destination.getvalue(), b"")

    def test_rejects_malformed_deep_and_oversized_projection_input(self) -> None:
        cases = {
            "malformed": b'{"ticks":[',
            "deep": (
                '{"unknown":'
                + "[" * viewer_delta.VIEWER_MAX_JSON_DEPTH
                + "0"
                + "]" * viewer_delta.VIEWER_MAX_JSON_DEPTH
                + ',"ticks":[{}]}'
            ).encode("utf-8"),
            "oversized": json.dumps(
                {"ticks": [{"players": [{} for _ in range(65)]}]},
                separators=(",", ":"),
            ).encode("utf-8"),
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            for name, body in cases.items():
                with self.subTest(case=name):
                    source = directory / f"{name}.json"
                    source.write_bytes(body)
                    with self.assertRaises(viewer_delta.ViewerDeltaError):
                        viewer_delta.build_python_viewer_parts(
                            source,
                            directory / f"{name}-parts",
                        )

    def test_rejects_projection_strings_over_the_global_safety_ceiling(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            source = directory / "string.json"
            source.write_text(
                '{"ticks":[{"game_id":"four"}]}',
                encoding="utf-8",
            )
            with (
                patch.object(viewer_delta, "VIEWER_MAX_STRING_CHARACTERS", 3),
                self.assertRaises(viewer_delta.ViewerDeltaError),
            ):
                viewer_delta.build_python_viewer_parts(source, directory / "parts")

    def test_canonical_source_manifest_rejects_oversized_input(self) -> None:
        with self.assertRaises(handler.NonRetryableReplayError):
            handler._write_canonical_replay_source(
                bucket="uploads-bucket",
                upload_id="66666666-6666-4666-8666-666666666666",
                original_key="replay.json.zst",
                downloaded=handler.DownloadedReplay(
                    path=Path("not-opened.json.zst"),
                    content_type="application/zstd",
                    size_bytes=(512 * 1024 * 1024) + 1,
                    sha256="a" * 64,
                    metadata={},
                ),
            )

    def test_immutable_write_reuses_exact_object_and_rejects_collision(self) -> None:
        body = b"immutable"
        sha256 = hashlib.sha256(body).hexdigest()
        precondition = handler.ClientError(
            {
                "Error": {"Code": "PreconditionFailed", "Message": "exists"},
                "ResponseMetadata": {"HTTPStatusCode": 412},
            },
            "PutObject",
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "artifact.bin"
            source.write_bytes(body)
            with (
                patch.object(handler.S3, "put_object", side_effect=precondition),
                patch.object(
                    handler.S3,
                    "head_object",
                    return_value={
                        "ContentLength": len(body),
                        "ContentType": "application/octet-stream",
                        "Metadata": {"sha256": sha256},
                        "VersionId": "existing-version",
                    },
                ),
            ):
                self.assertEqual(
                    handler._put_immutable_file(
                        bucket="uploads-bucket",
                        key="immutable.bin",
                        path=source,
                        content_type="application/octet-stream",
                        sha256=sha256,
                        metadata={"artifact-kind": "test"},
                    ),
                    "existing-version",
                )

            with (
                patch.object(handler.S3, "put_object", side_effect=precondition),
                patch.object(
                    handler.S3,
                    "head_object",
                    return_value={
                        "ContentLength": len(body),
                        "ContentType": "text/plain",
                        "Metadata": {"sha256": sha256},
                        "VersionId": "existing-version",
                    },
                ),
                self.assertRaises(handler.ReplayProcessingError),
            ):
                handler._put_immutable_file(
                    bucket="uploads-bucket",
                    key="immutable.bin",
                    path=source,
                    content_type="application/octet-stream",
                    sha256=sha256,
                    metadata={"artifact-kind": "test"},
                )

    def test_persisted_completion_replays_callback_before_parse_and_then_cleans_up(self) -> None:
        upload_id = "66666666-6666-4666-8666-666666666666"
        manifest = handler._completion_manifest(
            upload_id=upload_id,
            generation_token=upload_id,
            mode="initial",
            source_replay_sha256="a" * 64,
            callback_path="/v1/ingest/replay-uploads",
            callback_payload={
                "upload_id": upload_id,
                "viewer_artifact": {
                    "generation_token": upload_id,
                    "source_replay_sha256": "a" * 64,
                    "format": handler.VIEWER_DELTA_FORMAT,
                    "encoding_sha256": handler.VIEWER_ENCODING_SHA256,
                    "projection_sha256": handler.VIEWER_PROJECTION_SHA256,
                },
            },
            cleanup_object={
                "bucket": "uploads-bucket",
                "key": f"replays/unprocessed/{upload_id}/source.json.zst",
            },
        )
        callbacks: list[tuple[str, str, dict[str, object]]] = []
        manifest_key = (
            f"replays/derived/viewer/{upload_id}/generations/{upload_id}/manifest.json"
        )
        with (
            patch.object(
                handler,
                "_settings",
                return_value={"viewer_artifact_prefix": "replays/derived/viewer/"},
            ),
            patch.object(
                handler.S3,
                "list_objects_v2",
                return_value={"Contents": [{"Key": manifest_key}]},
            ),
            patch.object(
                handler.S3,
                "get_object",
                return_value={"Body": io.BytesIO(json.dumps(manifest).encode("utf-8"))},
            ),
            patch.object(
                handler,
                "_call_app_api",
                side_effect=lambda method, path, payload: callbacks.append(
                    (method, path, payload)
                ),
            ),
            patch.object(handler, "_delete_object") as delete_object,
        ):
            replayed = handler._replay_persisted_completion(
                bucket="uploads-bucket",
                upload_id=upload_id,
                generation_token=upload_id,
                expected_mode="initial",
            )

        self.assertTrue(replayed)
        self.assertEqual(
            callbacks,
            [
                (
                    "POST",
                    "/v1/ingest/replay-uploads",
                    manifest["callback"]["payload"],
                )
            ],
        )
        delete_object.assert_called_once_with(
            "uploads-bucket",
            f"replays/unprocessed/{upload_id}/source.json.zst",
        )

    def test_persisted_completion_skips_missing_exact_manifest(self) -> None:
        upload_id = "77777777-7777-4777-8777-777777777777"
        manifest_key = (
            f"replays/derived/viewer/{upload_id}/generations/{upload_id}/manifest.json"
        )
        with (
            patch.object(
                handler,
                "_settings",
                return_value={"viewer_artifact_prefix": "replays/derived/viewer/"},
            ),
            patch.object(
                handler.S3,
                "list_objects_v2",
                return_value={"Contents": [{"Key": f"{manifest_key}.partial"}]},
            ) as list_objects,
            patch.object(
                handler.S3,
                "get_object",
                side_effect=AssertionError("missing manifest must not be read"),
            ),
        ):
            replayed = handler._replay_persisted_completion(
                bucket="uploads-bucket",
                upload_id=upload_id,
                generation_token=upload_id,
                expected_mode="initial",
            )

        self.assertFalse(replayed)
        list_objects.assert_called_once_with(
            Bucket="uploads-bucket",
            Prefix=manifest_key,
            MaxKeys=1,
        )

    def test_app_api_callback_retries_transient_transport_failure(self) -> None:
        class Response:
            def __enter__(self) -> Response:
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def read(self) -> bytes:
                return b'{"ok":true}'

        settings = {
            "app_api_base_url": "https://api.example",
            "trusted_client_name": "replay-processing",
            "trusted_client_parameter_name": "/test/hmac",
        }
        with (
            patch.object(handler, "_settings", return_value=settings),
            patch.object(handler, "_signing_secret", return_value="secret"),
            patch.object(
                handler.urllib.request,
                "urlopen",
                side_effect=[handler.urllib.error.URLError("temporary"), Response()],
            ) as urlopen,
            patch.object(handler.time, "sleep") as sleep,
            patch.dict(
                os.environ,
                {
                    "APP_API_CALLBACK_MAX_ATTEMPTS": "3",
                    "APP_API_CALLBACK_RETRY_BASE_SECONDS": "0.01",
                },
            ),
        ):
            response = handler._call_app_api("POST", "/callback", {"ok": True})

        self.assertEqual(response, {"ok": True})
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(0.01)


def _write_replay_json(
    directory: Path,
    *,
    map_info: dict[str, object] | None,
    game_meta: dict[str, object] | None = None,
    include_game_meta: bool = True,
    gametype_settings: dict[str, object] | None = None,
    network_game_client: dict[str, object] | None = None,
    participant_context: dict[str, object] | None = None,
    summary_overrides: dict[str, object] | None = None,
    tick_overrides: dict[str, object] | None = None,
    ticks: list[dict[str, object]] | None = None,
) -> Path:
    tick: dict[str, object] = {
        "current_time": "2026-05-09 15:52:20.278065",
        "start_time": "2026-05-09 15:51:32.887485",
        "game_id": "minimal-game",
        "multiplayer_map_name": "levels\\test\\prisoner\\prisoner",
        "game_type": 2,
        "variant": "CTF",
        "players": [],
    }
    if map_info is not None:
        tick["map_info"] = map_info
    if tick_overrides:
        tick.update(tick_overrides)

    summary: dict[str, object] = {
        "game_id": "minimal-game",
        "is_full_game": True,
        "recording_started": "2026-05-09 15:51:32.887485",
        "recording_ended": "2026-05-09 15:52:20.278065",
        "game_duration_ingame": "0:00:47",
        "ticks_elapsed": 1,
        "ticks_recorded": 1,
        "ticks_dropped": 0,
        "recording_duration": "0:00:47",
    }
    if summary_overrides:
        summary.update(summary_overrides)

    path = directory / "replay.json"
    replay: dict[str, object] = {
        "summary": summary,
        "ticks": ticks if ticks is not None else [tick],
        "events": [],
    }
    if include_game_meta:
        replay["game_meta"] = game_meta or {"players": {}}
    if gametype_settings is not None:
        replay["gametype_settings"] = gametype_settings
    if network_game_client is not None:
        replay["network_game_client"] = network_game_client
    if participant_context is not None:
        replay["participant_context"] = participant_context

    path.write_text(
        json.dumps(replay),
        encoding="utf-8",
    )
    return path


def _finalization_payload(
    parsed: handler.ParsedReplay,
    *,
    original_key: str = "replays/unprocessed/22222222-2222-4222-8222-222222222222.json.zst",
    processed_key: str = "replays/processed/22222222-2222-4222-8222-222222222222.json.zst",
    replay_file: handler.ReplayOutputFile | None = None,
    reprocess_attempt_id: str | None = None,
    spatial_artifact: dict[str, object] | None = None,
) -> dict[str, object]:
    calls: list[tuple[str, str, dict[str, object]]] = []

    def capture_call(method: str, path: str, payload: dict[str, object]) -> dict[str, object]:
        calls.append((method, path, payload))
        return {}

    with (
        patch.object(
            handler,
            "_settings",
            return_value={"replay_finalization_path": "/v1/ingest/replay-uploads"},
        ),
        patch.object(handler, "_call_app_api", side_effect=capture_call),
    ):
        handler._finalize_replay_upload(
            upload_id="22222222-2222-4222-8222-222222222222",
            source_external_id="22222222-2222-4222-8222-222222222222",
            original_object=handler.S3ReplayObject(
                bucket="uploads-bucket",
                key=original_key,
                event_name="ObjectCreated:Put",
                sqs_message_id="message-1",
            ),
            processed_key=processed_key,
            downloaded=handler.DownloadedReplay(
                path=Path("replay.json.zst"),
                content_type="application/zstd",
                size_bytes=123,
                sha256="a" * 64,
                metadata={},
            ),
            parsed=parsed,
            replay_file=replay_file,
            reprocess_attempt_id=reprocess_attempt_id,
            spatial_artifact=spatial_artifact,
        )

    return calls[0][2]


def _reprocess_job_payload(
    *,
    mode: str = "full_reparse",
    include_viewer: bool = True,
) -> dict[str, object]:
    upload_id = "66666666-6666-4666-8666-666666666666"
    replay_id = "44444444-4444-4444-8444-444444444444"
    attempt_id = "77777777-7777-4777-8777-777777777777"
    operation_id = "99999999-9999-4999-8999-999999999999"
    payload: dict[str, object] = {
        "schema": "halospawns.replay_reprocess_job.v1",
        "job_id": f"replay:{replay_id}:attempt:{attempt_id}",
        "trigger": "manual_reprocess",
        "environment": "dev",
        "operation_id": operation_id,
        "attempt_id": attempt_id,
        "mode": mode,
        "replay": {
            "id": replay_id,
            "game_id": "33333333-3333-4333-8333-333333333333",
            "upload_id": upload_id,
        },
        "source_replay": {
            "s3_bucket": "uploads-bucket",
            "s3_key": f"replays/processed/{upload_id}/original+replay.json.zst",
            "filename": "original+replay.json.zst",
            "content_type": "application/octet-stream",
            "size_bytes": 123,
            "sha256": "a" * 64,
            "s3_version_id": "source-version-1",
        },
        "current_replay_file": {
            "file_role": "processed",
            "s3_bucket": "uploads-bucket",
            "s3_key": f"replays/processed/{upload_id}/original+replay.json.zst",
            "content_type": "application/octet-stream",
            "size_bytes": 123,
            "sha256": "a" * 64,
            "s3_version_id": "source-version-1",
        },
        "requested_outputs": (
            ["viewer_artifact"]
            if mode == "viewer_rebuild"
            else [
                "game",
                "participants",
                "stats",
                "spawn_points",
                "game_meta",
                "graph_context",
                "viewer_artifact",
            ]
        ),
        "viewer_artifact_target": {
            "artifact_kind": handler.VIEWER_ARTIFACT_KIND,
            "format": handler.VIEWER_DELTA_FORMAT,
            "container_version": handler.VIEWER_CONTAINER_VERSION,
            "manifest_schema_sha256": handler.VIEWER_MANIFEST_SCHEMA_SHA256,
            "encoding_sha256": handler.VIEWER_ENCODING_SHA256,
            "schema_name": handler.VIEWER_SCHEMA,
            "profile": handler.VIEWER_PROFILE,
            "profile_revision": handler.VIEWER_PROFILE_REVISION,
            "projection_sha256": handler.VIEWER_PROJECTION_SHA256,
            "generation_token": attempt_id,
            "request_epoch": 3,
            "request_sequence": 7,
        },
        "created_at": "2026-07-02T00:00:00Z",
    }
    if mode == "full_reparse" and not include_viewer:
        payload["requested_outputs"] = list(handler.FULL_REPARSE_OUTPUTS)
        payload.pop("viewer_artifact_target")
        source_replay = payload["source_replay"]
        current_replay_file = payload["current_replay_file"]
        assert isinstance(source_replay, dict)
        assert isinstance(current_replay_file, dict)
        source_replay.pop("s3_version_id")
        current_replay_file.pop("s3_version_id")
    return payload


def _minimal_parsed_replay() -> handler.ParsedReplay:
    return handler.ParsedReplay(
        game={
            "status": "completed",
            "metadata": {
                "game_id": "minimal-game",
                "map_engine_name": "levels\\test\\prisoner\\prisoner",
            },
        },
        participants=[],
        team_stats=[],
        spawn_points=[],
        spawn_source=None,
        metadata={
            "summary": {"game_id": "minimal-game"},
            "parser": {"name": "halospawns-replay-parser"},
        },
        game_meta={"players": {}},
    )


class ReplayParserStatusTests(unittest.TestCase):
    def test_parse_replay_marks_partial_game_completed_when_last_tick_ended(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                summary_overrides={"is_full_game": False},
                tick_overrides={"game_ended_this_tick": True},
            )

            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.game["status"], "completed")
        self.assertIs(parsed.game["metadata"]["game_ended_this_tick"], True)

    def test_parse_replay_keeps_partial_game_imported_without_last_tick_end(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                summary_overrides={"is_full_game": False},
                tick_overrides={"game_ended_this_tick": False},
            )

            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.game["status"], "imported")
        self.assertIs(parsed.game["metadata"]["game_ended_this_tick"], False)


class ReplayParserGraphContextTests(unittest.TestCase):
    def test_full_game_graph_context_has_zero_start_coverage(self) -> None:
        ticks = [
            {
                "current_time": "2026-05-09 15:51:32.887485",
                "start_time": "2026-05-09 15:51:32.887485",
                "game_id": "full-game",
                "multiplayer_map_name": "levels\\test\\prisoner\\prisoner",
                "game_type": 2,
                "variant": "CTF",
                "game_time_info": {"game_time": 0},
                "players": [
                    {
                        "player_index": 0,
                        "name": "Player 0",
                        "team": 0,
                        "kills": 0,
                        "deaths": 0,
                        "assists": 0,
                        "score": 0,
                    },
                ],
            },
            {
                "current_time": "2026-05-09 15:51:34.887485",
                "start_time": "2026-05-09 15:51:32.887485",
                "game_id": "full-game",
                "multiplayer_map_name": "levels\\test\\prisoner\\prisoner",
                "game_type": 2,
                "variant": "CTF",
                "game_time_info": {"game_time": 60},
                "players": [
                    {
                        "player_index": 0,
                        "name": "Player 0",
                        "team": 0,
                        "kills": 1,
                        "deaths": 0,
                        "assists": 0,
                        "score": 1,
                    },
                ],
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                summary_overrides={
                    "game_id": "full-game",
                    "is_full_game": True,
                    "ticks_elapsed": 61,
                    "ticks_recorded": 2,
                    "ticks_dropped": 59,
                },
                ticks=ticks,
            )
            parsed = handler._parse_replay(path)

        payload = _finalization_payload(parsed)
        graph_context = payload["metadata"]["graph_context"]
        self.assertEqual(graph_context["schema"], "halospawns.graphContext.v1")
        self.assertEqual(
            graph_context["coverage"],
            {
                "first_recorded_tick": 0,
                "starts_after_game_start": False,
                "incomplete_before_first_tick": False,
                "first_recorded_time_seconds": 0,
                "last_recorded_tick": 60,
                "last_recorded_time_seconds": 2,
            },
        )
        self.assertEqual(
            graph_context["players"]["0"]["baselines"],
            {"kills": 0, "deaths": 0, "assists": 0},
        )
        self.assertEqual(graph_context["players"]["0"]["tick"], 0)
        self.assertEqual(graph_context["players"]["0"]["time_seconds"], 0)

    def test_late_start_graph_context_sends_first_recorded_kda_and_omits_hostman(self) -> None:
        game_meta = {
            "players": {
                "0": {
                    "shots_by_tick": {"9001": 3},
                    "damage_dealt": 125.5,
                    "camo_count": 1,
                    "streak_by_tick": {"9001": 5},
                    "multikill_counts_by_amount": {"2": 1},
                },
            },
        }
        first_players = [
            {
                "player_index": 0,
                "name": "Player 0",
                "team": 0,
                "kills": 10,
                "deaths": 10,
                "assists": 2,
                "score": 10,
            },
            {
                "player_index": 1,
                "name": "Hostman",
                "team": 1,
                "kills": 99,
                "deaths": 0,
                "assists": 0,
                "score": 99,
                "derived_stats": {"is_host": True, "is_hostman": True},
            },
        ]
        last_players = [
            {
                "player_index": 0,
                "name": "Player 0",
                "team": 0,
                "kills": 14,
                "deaths": 11,
                "assists": 3,
                "score": 14,
            },
            {
                "player_index": 1,
                "name": "Hostman",
                "team": 1,
                "kills": 100,
                "deaths": 1,
                "assists": 0,
                "score": 100,
                "derived_stats": {"is_host": True, "is_hostman": True},
            },
        ]
        ticks = [
            {
                "current_time": "2026-05-09 15:56:32.887485",
                "start_time": "2026-05-09 15:51:32.887485",
                "game_id": "late-game",
                "multiplayer_map_name": "levels\\test\\prisoner\\prisoner",
                "game_type": 2,
                "variant": "CTF",
                "game_time_info": {"game_time": 9000},
                "players": first_players,
            },
            {
                "current_time": "2026-05-09 16:01:32.887485",
                "start_time": "2026-05-09 15:51:32.887485",
                "game_id": "late-game",
                "multiplayer_map_name": "levels\\test\\prisoner\\prisoner",
                "game_type": 2,
                "variant": "CTF",
                "game_time_info": {"game_time": 18000},
                "players": last_players,
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                game_meta=game_meta,
                summary_overrides={"game_id": "late-game", "is_full_game": False},
                ticks=ticks,
            )
            parsed = handler._parse_replay(path)

        graph_context = _finalization_payload(parsed)["metadata"]["graph_context"]

        self.assertEqual(
            graph_context["coverage"],
            {
                "first_recorded_tick": 9000,
                "starts_after_game_start": True,
                "incomplete_before_first_tick": True,
                "first_recorded_time_seconds": 300,
                "last_recorded_tick": 18000,
                "last_recorded_time_seconds": 600,
            },
        )
        self.assertEqual(set(graph_context["players"]), {"0"})
        player_context = graph_context["players"]["0"]
        self.assertEqual(player_context["player_index"], 0)
        self.assertEqual(
            player_context["baselines"],
            {"kills": 10, "deaths": 10, "assists": 2},
        )
        self.assertNotIn("damage_dealt", player_context["baselines"])
        self.assertNotIn("shots", player_context["baselines"])
        self.assertNotIn("camo_count", player_context["baselines"])
        self.assertNotIn("max_kill_streak", player_context["baselines"])
        self.assertNotIn("double_kills", player_context["baselines"])
        self.assertEqual(player_context["tick"], 9000)
        self.assertEqual(player_context["time_seconds"], 300)
        self.assertEqual(player_context["source"], "first_recorded_tick_player_counter")

    def test_graph_context_omits_time_fields_when_game_time_info_is_missing(self) -> None:
        ticks = [
            {
                "current_time": "2026-05-09 15:56:32.887485",
                "start_time": "2026-05-09 15:51:32.887485",
                "game_id": "legacy-game",
                "multiplayer_map_name": "levels\\test\\prisoner\\prisoner",
                "game_type": 2,
                "variant": "CTF",
                "players": [
                    {
                        "player_index": 0,
                        "name": "Player 0",
                        "team": 0,
                        "kills": 2,
                        "deaths": 1,
                        "assists": 3,
                        "score": 2,
                    },
                ],
            }
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(Path(tmp), map_info=None, ticks=ticks)
            parsed = handler._parse_replay(path)

        graph_context = _finalization_payload(parsed)["metadata"]["graph_context"]

        self.assertNotIn("coverage", graph_context)
        self.assertEqual(
            graph_context["players"]["0"]["baselines"],
            {"kills": 2, "deaths": 1, "assists": 3},
        )
        self.assertNotIn("tick", graph_context["players"]["0"])
        self.assertNotIn("time_seconds", graph_context["players"]["0"])

    def test_finalization_payload_omits_graph_context_when_context_is_absent(self) -> None:
        ticks = [
            {
                "current_time": "2026-05-09 15:56:32.887485",
                "start_time": "2026-05-09 15:51:32.887485",
                "game_id": "legacy-game",
                "multiplayer_map_name": "levels\\test\\prisoner\\prisoner",
                "game_type": 2,
                "variant": "CTF",
                "players": [
                    {
                        "player_index": 0,
                        "name": "Player 0",
                        "team": 0,
                        "score": 0,
                    },
                ],
            }
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(Path(tmp), map_info=None, ticks=ticks)
            parsed = handler._parse_replay(path)

        payload = _finalization_payload(parsed)

        self.assertNotIn("graph_context", parsed.metadata)
        self.assertNotIn("graph_context", payload["metadata"])


class ReplayParserGametypeSettingsTests(unittest.TestCase):
    def test_finalization_payload_prefers_sanitized_gametype_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                gametype_settings={
                    "name": "Team Slayer",
                    "game_type": 2,
                    "mode": "slayer",
                    "teamplay": 1,
                    "teams_enabled": True,
                    "player_settings": {
                        "value": 0,
                        "radar_enabled": False,
                        "host_address": "192.0.2.1",
                    },
                    "raw_byte_dump": "deadbeef" * 16,
                    "presigned_url": "https://example.test/replay?X-Amz-Signature=abc",
                },
                tick_overrides={"game_type": 1, "variant": "Classic Slayer"},
            )
            parsed = handler._parse_replay(path)

        payload = _finalization_payload(parsed)
        game = payload["game"]
        self.assertIsInstance(game, dict)
        self.assertEqual(game["game_type"], "slayer")
        self.assertEqual(game["variant_name"], "Team Slayer")

        metadata = game["metadata"]
        self.assertIsInstance(metadata, dict)
        settings = metadata["gametype_settings"]
        self.assertEqual(
            settings,
            {
                "name": "Team Slayer",
                "game_type": 2,
                "mode": "slayer",
                "teamplay": 1,
                "teams_enabled": True,
                "player_settings": {
                    "value": 0,
                    "radar_enabled": False,
                },
            },
        )

    def test_parse_replay_preserves_tick_fields_when_gametype_settings_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(Path(tmp), map_info=None)

            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.game["game_type"], "2")
        self.assertEqual(parsed.game["variant_name"], "CTF")
        self.assertNotIn("gametype_settings", parsed.game["metadata"])

    def test_parse_replay_does_not_use_blank_or_unknown_gametype_name(self) -> None:
        for name in ("   ", "unknown <7>"):
            with self.subTest(name=name):
                with tempfile.TemporaryDirectory() as tmp:
                    path = _write_replay_json(
                        Path(tmp),
                        map_info=None,
                        gametype_settings={
                            "name": name,
                            "mode": "ctf",
                        },
                        tick_overrides={"variant": "Classic CTF"},
                    )

                    parsed = handler._parse_replay(path)

                self.assertEqual(parsed.game["game_type"], "ctf")
                self.assertEqual(parsed.game["variant_name"], "Classic CTF")
                self.assertNotEqual(parsed.game["variant_name"], name.strip())


class ReplayParserFactFinalizationTests(unittest.TestCase):
    def test_finalization_payload_includes_normalized_gametype_facts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                gametype_settings={
                    "name": "Team Slayer",
                    "mode": "slayer",
                    "score_limit": "50",
                    "time_limit": 12,
                    "teamplay": 1,
                    "teams_enabled": True,
                    "mode_settings": {
                        "kill_in_order": False,
                    },
                },
            )
            parsed = handler._parse_replay(path)

        payload = _finalization_payload(parsed)

        self.assertEqual(payload["facts"]["schema"], "halospawns.replayFacts.v1")
        game_facts = payload["facts"]["game"]
        self.assertEqual(game_facts["gametype.name"], "Team Slayer")
        self.assertEqual(game_facts["gametype.mode"], "slayer")
        self.assertEqual(game_facts["gametype.score_limit"], 50)
        self.assertEqual(game_facts["gametype.time_limit"], 12)
        self.assertIs(game_facts["gametype.teamplay"], True)
        self.assertIs(game_facts["gametype.teams_enabled"], True)
        self.assertIs(game_facts["gametype.mode_settings.kill_in_order"], False)

    def test_parse_replay_sets_neutral_host_style_without_host_participants(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                tick_overrides={
                    "players": [
                        {
                            "player_index": 0,
                            "name": "Player 0",
                            "team": 0,
                            "kills": 1,
                            "deaths": 0,
                            "assists": 0,
                            "score": 1,
                            "derived_stats": {"is_host": False},
                        },
                    ],
                },
            )
            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.facts["game"]["game.host_style"], "neutral")

    def test_parse_replay_sets_neutral_host_style_for_single_hostman(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                tick_overrides={
                    "players": [
                        {
                            "player_index": 0,
                            "name": "Hostman",
                            "team": 0,
                            "kills": 1,
                            "deaths": 0,
                            "assists": 0,
                            "score": 1,
                            "derived_stats": {
                                "is_host": True,
                                "is_hostman": True,
                            },
                        },
                    ],
                },
            )
            parsed = handler._parse_replay(path)

        self.assertIs(parsed.participants[0]["metadata"]["is_hostman"], True)
        self.assertEqual(parsed.facts["game"]["game.host_style"], "neutral")
        participant_facts = parsed.facts["participants"][0]["facts"]
        self.assertIs(participant_facts["participant.is_host"], True)
        self.assertIs(participant_facts["participant.is_hostman"], True)

    def test_parse_replay_sets_on_off_host_style_for_single_non_hostman_host(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                tick_overrides={
                    "players": [
                        {
                            "player_index": 0,
                            "name": "Host",
                            "team": 0,
                            "kills": 1,
                            "deaths": 0,
                            "assists": 0,
                            "score": 1,
                            "derived_stats": {"is_host": True},
                        },
                    ],
                },
            )
            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.facts["game"]["game.host_style"], "on_off")
        participant_facts = parsed.facts["participants"][0]["facts"]
        self.assertIs(participant_facts["participant.is_host"], True)
        self.assertNotIn("participant.is_hostman", participant_facts)

    def test_parse_replay_sets_on_off_host_style_for_multiple_hosts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                tick_overrides={
                    "players": [
                        {
                            "player_index": 0,
                            "name": "Host 0",
                            "team": 0,
                            "kills": 1,
                            "deaths": 0,
                            "assists": 0,
                            "score": 1,
                            "derived_stats": {
                                "is_host": True,
                                "is_hostman": True,
                            },
                        },
                        {
                            "player_index": 1,
                            "name": "Host 1",
                            "team": 1,
                            "kills": 0,
                            "deaths": 1,
                            "assists": 0,
                            "score": 0,
                            "derived_stats": {"is_host": True},
                        },
                    ],
                },
            )
            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.facts["game"]["game.host_style"], "on_off")

    def test_parse_replay_derives_participant_context_from_network_game_client(self) -> None:
        players = [
            {
                "player_index": 0,
                "name": "Host Top",
                "team": 0,
                "kills": 3,
                "deaths": 1,
                "assists": 0,
                "score": 3,
            },
            {
                "player_index": 1,
                "name": "Host Bottom",
                "team": 0,
                "kills": 1,
                "deaths": 2,
                "assists": 1,
                "score": 1,
            },
            {
                "player_index": 2,
                "name": "Remote",
                "team": 1,
                "kills": 2,
                "deaths": 3,
                "assists": 0,
                "score": 2,
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                network_game_client={
                    "machine_index": 0,
                    "network_game_data": {
                        "network_players": [
                            {
                                "name": "Host Top",
                                "machine_index": 0,
                                "controller_index": 0,
                                "team": 0,
                                "player_list_index": 0,
                            },
                            {
                                "name": "Host Bottom",
                                "machine_index": 0,
                                "controller_index": 1,
                                "team": 0,
                                "player_list_index": 1,
                            },
                            {
                                "name": "Remote",
                                "machine_index": 1,
                                "controller_index": 0,
                                "team": 1,
                                "player_list_index": 2,
                            },
                        ],
                    },
                },
                tick_overrides={"players": players},
            )
            parsed = handler._parse_replay(path)

        participants = {participant["slot_index"]: participant for participant in parsed.participants}
        self.assertEqual(participants[0]["metadata"]["machine_index"], 0)
        self.assertEqual(participants[0]["metadata"]["controller_index"], 0)
        self.assertIs(participants[0]["metadata"]["is_host"], True)
        self.assertEqual(participants[0]["metadata"]["screen_slot"], "top")
        self.assertEqual(participants[0]["metadata"]["screen_layout"], "vertical_2")
        self.assertEqual(participants[1]["metadata"]["screen_slot"], "bottom")
        self.assertIs(participants[1]["metadata"]["is_host"], True)
        self.assertEqual(participants[2]["metadata"]["machine_index"], 1)
        self.assertIs(participants[2]["metadata"]["is_host"], False)
        self.assertEqual(participants[2]["metadata"]["screen_slot"], "full")
        self.assertEqual(participants[2]["metadata"]["screen_layout"], "single")

        payload = _finalization_payload(parsed)
        participant_facts = {
            item["slot_index"]: item["facts"]
            for item in payload["facts"]["participants"]
        }
        self.assertIs(participant_facts[0]["participant.is_host"], True)
        self.assertEqual(participant_facts[0]["participant.screen_slot"], "top")
        self.assertEqual(participant_facts[1]["participant.screen_slot"], "bottom")
        self.assertEqual(participant_facts[2]["participant.screen_slot"], "full")

    def test_parse_replay_uses_explicit_participant_context_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                network_game_client={
                    "network_game_data": {
                        "network_players": [
                            {
                                "machine_index": 0,
                                "controller_index": 0,
                                "player_list_index": 0,
                            },
                        ],
                    },
                },
                participant_context={
                    "schema": "halospawns.participantContext.v1",
                    "players": {
                        "0": {
                            "machine_index": 2,
                            "controller_index": 3,
                            "is_host": False,
                            "screen_slot": "bottom-right",
                            "screen_layout": "quad",
                        },
                    },
                },
                tick_overrides={
                    "players": [
                        {
                            "player_index": 0,
                            "name": "Explicit",
                            "team": 0,
                            "kills": 1,
                            "deaths": 0,
                            "assists": 0,
                            "score": 1,
                        },
                    ],
                },
            )
            parsed = handler._parse_replay(path)

        metadata = parsed.participants[0]["metadata"]
        self.assertEqual(metadata["machine_index"], 2)
        self.assertEqual(metadata["controller_index"], 3)
        self.assertIs(metadata["is_host"], False)
        self.assertEqual(metadata["screen_slot"], "bottom-right")
        self.assertEqual(metadata["screen_layout"], "quad")
        facts = parsed.facts["participants"][0]["facts"]
        self.assertEqual(facts["participant.machine_index"], 2)
        self.assertEqual(facts["participant.controller_index"], 3)
        self.assertIs(facts["participant.is_host"], False)
        self.assertEqual(facts["participant.screen_slot"], "bottom-right")

    def test_parse_replay_projects_streak_and_multikill_stats(self) -> None:
        game_meta = {
            "players": {
                "0": {
                    "kills_by_tick": {"10": 1, "20": 1},
                    "streak_by_tick": {"10": 2, "20": 3},
                    "streak_counts_by_amount": {"5": 1},
                    "multikills_by_tick": {"10": [2], "20": [3, 4]},
                    "multikill_counts_by_amount": {"2": 3, "3": 1, "4": 1, "5": 1},
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                game_meta=game_meta,
                tick_overrides={
                    "players": [
                        {
                            "player_index": 0,
                            "name": "Streaky",
                            "team": 0,
                            "kills": 2,
                            "deaths": 0,
                            "assists": 0,
                            "score": 2,
                        },
                    ],
                },
            )
            parsed = handler._parse_replay(path)

        self.assertEqual(
            parsed.game_meta["players"]["0"]["streak_by_tick"],
            {"10": 2, "20": 3},
        )
        raw_stats = parsed.participants[0]["stats"]["raw_stats"]
        self.assertEqual(raw_stats["max_kill_streak"], 5)
        self.assertEqual(raw_stats["double_kills"], 3)
        self.assertEqual(raw_stats["triple_kills"], 1)
        self.assertEqual(raw_stats["multikills_4_plus"], 2)

        payload = _finalization_payload(parsed)
        facts = payload["facts"]["participants"][0]["facts"]
        self.assertEqual(facts["participant.max_kill_streak"], 5)
        self.assertEqual(facts["participant.double_kills"], 3)
        self.assertEqual(facts["participant.triple_kills"], 1)
        self.assertEqual(facts["participant.multikills_4_plus"], 2)

    def test_parse_replay_counts_legacy_and_coordinate_tick_events(self) -> None:
        game_meta = {
            "players": {
                "0": {
                    "kills_by_tick": {"10": 1, "20": 2},
                    "deaths_by_tick": {"30": 1},
                },
                "1": {
                    "kills_by_tick": {
                        "10": [[-1.8, 1.7, 1.4]],
                        "20": [[2.0, 3.0, 4.0], [5.0, 6.0, 7.0]],
                    },
                    "deaths_by_tick": {
                        "30": [[-9.9, -0.8, 1.4]],
                        "40": [],
                    },
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                game_meta=game_meta,
                tick_overrides={
                    "players": [
                        {
                            "player_index": 0,
                            "name": "Legacy",
                            "team": 0,
                            "kills": 0,
                            "deaths": 0,
                            "assists": 0,
                        },
                        {
                            "player_index": 1,
                            "name": "Coordinates",
                            "team": 1,
                            "kills": 0,
                            "deaths": 0,
                            "assists": 0,
                        },
                    ],
                },
            )
            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.participants[0]["stats"]["kills"], 3)
        self.assertEqual(parsed.participants[0]["stats"]["deaths"], 1)
        self.assertEqual(parsed.participants[1]["stats"]["kills"], 3)
        self.assertEqual(parsed.participants[1]["stats"]["deaths"], 1)
        self.assertEqual(
            parsed.game_meta["players"]["1"]["kills_by_tick"],
            game_meta["players"]["1"]["kills_by_tick"],
        )

    def test_parse_replay_omits_missing_streak_and_context_facts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                tick_overrides={
                    "players": [
                        {
                            "player_index": 0,
                            "name": "Legacy",
                            "team": 0,
                            "kills": 1,
                            "deaths": 0,
                            "assists": 0,
                            "score": 1,
                        },
                    ],
                },
            )
            parsed = handler._parse_replay(path)

        raw_stats = parsed.participants[0]["stats"]["raw_stats"]
        self.assertNotIn("max_kill_streak", raw_stats)
        self.assertNotIn("double_kills", raw_stats)
        self.assertEqual(
            parsed.facts,
            {
                "schema": "halospawns.replayFacts.v1",
                "game": {"game.host_style": "neutral"},
                "participants": [],
            },
        )


class ReplayParserMapInfoEvidenceTests(unittest.TestCase):
    def test_parse_replay_promotes_explicit_release_and_cache_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info={
                    "game_release_key": "halo1_xbox_nhe",
                    "cache_family": "halo1_cache",
                    "cache_version": 5,
                    "cache_version_name": "xbox",
                    "build_version": "01.10.12.2300",
                },
            )

            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.game["game_release_key"], "halo1_xbox_nhe")
        self.assertEqual(parsed.game["cache_family"], "halo1_cache")
        self.assertEqual(parsed.game["cache_version"], 5)
        self.assertEqual(parsed.game["cache_version_name"], "xbox")
        self.assertEqual(parsed.game["build_version"], "01.10.12.2300")

    def test_parse_replay_omits_invalid_explicit_release_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info={
                    "game_release_key": "Halo 1 Xbox",
                    "cache_family": "halo1_cache",
                },
            )

            parsed = handler._parse_replay(path)

        self.assertNotIn("game_release_key", parsed.game)
        self.assertEqual(parsed.game["cache_family"], "halo1_cache")

    def test_parse_replay_promotes_cache_and_build_evidence_from_map_info(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info={
                    "cache_family": "halo1_cache",
                    "cache_version": 5,
                    "cache_version_name": "xbox",
                    "build_version": "01.10.12.2300",
                    "scenario_name": "prisoner",
                },
            )

            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.game["cache_version"], 5)
        self.assertEqual(parsed.game["cache_family"], "halo1_cache")
        self.assertEqual(parsed.game["cache_version_name"], "xbox")
        self.assertEqual(parsed.game["build_version"], "01.10.12.2300")
        self.assertNotIn("game_release_key", parsed.game)

    def test_parse_replay_promotes_partial_map_info_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info={"build_version": "01.10.12.2300"},
            )

            parsed = handler._parse_replay(path)

        self.assertNotIn("cache_version", parsed.game)
        self.assertEqual(parsed.game["build_version"], "01.10.12.2300")

    def test_parse_replay_omits_release_evidence_when_map_info_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(Path(tmp), map_info=None)

            parsed = handler._parse_replay(path)

        self.assertNotIn("cache_version", parsed.game)
        self.assertNotIn("build_version", parsed.game)
        self.assertNotIn("game_release_key", parsed.game)

    def test_finalization_payload_sends_evidence_inside_game(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info={
                    "cache_version": 5,
                    "build_version": "01.10.12.2300",
                },
            )
            parsed = handler._parse_replay(path)

        payload = _finalization_payload(parsed)
        game = payload["game"]
        self.assertIsInstance(game, dict)
        self.assertEqual(game["cache_version"], 5)
        self.assertEqual(game["build_version"], "01.10.12.2300")
        self.assertNotIn("game_release_key", game)


class ReplayParserGameMetaCallbackTests(unittest.TestCase):
    def test_finalization_payload_includes_top_level_game_meta_when_available(self) -> None:
        game_meta = {
            "start_time": None,
            "players": {
                "0": {
                    "shots_by_weapon": {"weapons\\pistol\\pistol": 151},
                    "damage_to_player": {"1": 246.52589416503906},
                    "damage_from_player": {"1": 847.7787170410156},
                    "kills_by_tick": {"164": 1},
                    "deaths_by_tick": {"320": 1},
                    "assists_by_tick": {"323": 1},
                    "damage_dealt_by_tick": {"164": 25},
                    "damage_dealt": 2401.134578704834,
                    "damage_received_by_tick": {"320": 456.073760986328},
                    "damage_received": 4950.623794555664,
                    "camo_by_tick": {},
                    "camo_count": 0,
                    "overshield_by_tick": {"1348": 1},
                    "overshield_count": 1,
                    "active_projectiles": [],
                }
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                game_meta=game_meta,
            )
            parsed = handler._parse_replay(path)

        payload = _finalization_payload(parsed)

        self.assertEqual(payload["game_meta"], game_meta)

    def test_finalization_payload_omits_game_meta_when_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                include_game_meta=False,
            )
            parsed = handler._parse_replay(path)

        payload = _finalization_payload(parsed)

        self.assertNotIn("game_meta", payload)


class ReplayParserSpatialFactsTests(unittest.TestCase):
    @staticmethod
    def _player(
        slot_index: int,
        position: tuple[object, object, object] | None,
        *,
        is_hostman: bool = False,
    ) -> dict[str, object]:
        player: dict[str, object] = {
            "player_index": slot_index,
            "name": f"Player {slot_index}",
            "team": slot_index % 2,
            "derived_stats": {"is_hostman": is_hostman},
        }
        if position is not None:
            player["player_object_data"] = dict(zip(("x", "y", "z"), position))
        return player

    def test_streams_positions_into_stable_slot_cells_without_filling_tick_gaps(self) -> None:
        ticks = [
            {
                "players": [
                    self._player(0, (-0.1, -1.0, 1.49)),
                    self._player(1, (2.0, 3.0, 4.0)),
                ],
            },
            {"players": [self._player(0, (-0.1, -1.0, 1.49))]},
            {"players": []},
            {"players": [self._player(0, (1.0, 1.0, 1.0))]},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                ticks=ticks,
                summary_overrides={
                    "ticks_elapsed": 7,
                    "ticks_recorded": 4,
                    "ticks_dropped": 3,
                },
            )
            parsed = handler._parse_replay(path)

        assert parsed.spatial_facts is not None
        self.assertEqual(
            parsed.spatial_facts.cells,
            {
                (0, -1, -2, 2): 2,
                (0, 2, 2, 2): 1,
                (1, 4, 6, 8): 1,
            },
        )
        coverage = parsed.spatial_facts.coverage
        self.assertEqual(coverage["ticks_observed"], 4)
        self.assertEqual(coverage["ticks_dropped"], 3)
        self.assertEqual(coverage["position_observations"], 4)
        self.assertEqual(coverage["participant_slots_observed"], [0, 1])

    def test_discards_hostman_missing_malformed_nonfinite_and_out_of_bounds_samples(self) -> None:
        accumulator = handler.SpatialOccupancyAccumulator(0.5)
        accumulator.observe(
            {"player_index": 0},
            position_object_seen=True,
            position={"x": 1, "y": 2, "z": 3},
        )
        accumulator.observe(
            {"player_index": 1, "is_hostman": True},
            position_object_seen=True,
            position={"x": 1, "y": 2, "z": 3},
        )
        accumulator.observe(
            {"player_index": 2}, position_object_seen=False, position={}
        )
        accumulator.observe(
            {"player_index": 3},
            position_object_seen=True,
            position={"x": 1, "y": 2},
        )
        accumulator.observe(
            {"player_index": 4},
            position_object_seen=True,
            position={"x": math.nan, "y": 2, "z": 3},
        )
        accumulator.observe(
            {"player_index": 5},
            position_object_seen=True,
            position={"x": handler.MAX_SPATIAL_COORDINATE_ABS + 1, "y": 2, "z": 3},
        )
        accumulator.observe(
            {"player_index": 999},
            position_object_seen=True,
            position={"x": 1, "y": 2, "z": 3},
        )
        accumulator.exclude_slots({0})
        facts = accumulator.spatial_facts(summary={}, tick_count=1, parse_duration_ms=2)

        self.assertEqual(facts.cells, {})
        self.assertEqual(facts.coverage["status"], "unavailable")
        self.assertEqual(
            facts.coverage["discarded_by_reason"],
            {
                "hostman": 2,
                "invalid_slot": 1,
                "missing_coordinate": 1,
                "missing_player_object": 1,
                "non_finite": 1,
                "out_of_bounds": 1,
            },
        )

    def test_post_filters_hostman_identified_by_participant_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info=None,
                participant_context={
                    "schema": "halospawns.participantContext.v1",
                    "players": {"0": {"is_hostman": True}},
                },
                tick_overrides={"players": [self._player(0, (1.0, 2.0, 3.0))]},
            )
            parsed = handler._parse_replay(path)

        assert parsed.spatial_facts is not None
        self.assertEqual(parsed.spatial_facts.cells, {})
        self.assertEqual(
            parsed.spatial_facts.coverage["discarded_by_reason"]["hostman"], 1
        )

    def test_bounds_distinct_cells_but_keeps_counting_existing_cells(self) -> None:
        with (
            patch.object(handler, "MAX_SPATIAL_CELLS_PER_SLOT", 2),
            patch.object(handler, "MAX_SPATIAL_CELLS_TOTAL", 2),
        ):
            accumulator = handler.SpatialOccupancyAccumulator(1.0)
            for x in (0.1, 1.1, 2.1, 0.1):
                accumulator.observe(
                    {"player_index": 0},
                    position_object_seen=True,
                    position={"x": x, "y": 0, "z": 0},
                )

        self.assertEqual(accumulator.cells, {(0, 0, 0, 0): 2, (0, 1, 0, 0): 1})
        self.assertEqual(accumulator.discarded["slot_cell_limit"], 1)

    def test_writes_deterministic_gzip_artifact_and_sends_only_manifest(self) -> None:
        parsed = _minimal_parsed_replay()
        parsed = handler.ParsedReplay(
            **{
                **parsed.__dict__,
                "spatial_facts": handler.SpatialFacts(
                    cell_size=0.5,
                    cells={(1, 4, -2, 0): 3, (0, -1, 0, 2): 7},
                    coverage={
                        "status": "available",
                        "position_observations": 10,
                        "position_samples_discarded": 0,
                        "distinct_cells": 2,
                    },
                    runtime_metrics={"parse_duration_ms": 4},
                ),
            }
        )
        retry_parsed = handler.ParsedReplay(
            **{
                **parsed.__dict__,
                "spatial_facts": handler.SpatialFacts(
                    cell_size=parsed.spatial_facts.cell_size,
                    cells=parsed.spatial_facts.cells,
                    coverage=parsed.spatial_facts.coverage,
                    runtime_metrics={"parse_duration_ms": 9999},
                ),
            }
        )
        writes: list[dict[str, object]] = []

        with patch.object(handler.S3, "put_object", side_effect=lambda **kwargs: writes.append(kwargs)):
            first = handler._write_spatial_artifact(
                parsed=parsed,
                bucket="uploads-bucket",
                upload_id="22222222-2222-4222-8222-222222222222",
                generation=1,
                source_replay_sha256="a" * 64,
            )
            second = handler._write_spatial_artifact(
                parsed=retry_parsed,
                bucket="uploads-bucket",
                upload_id="22222222-2222-4222-8222-222222222222",
                generation=1,
                source_replay_sha256="a" * 64,
            )

        assert first is not None and second is not None
        self.assertEqual(writes[0]["Body"], writes[1]["Body"])
        body = writes[0]["Body"]
        assert isinstance(body, bytes)
        document = json.loads(gzip.decompress(body))
        self.assertEqual(
            document["occupancy"],
            [
                {"cell": [-1, 0, 2], "observed_ticks": 7, "slot_index": 0},
                {"cell": [4, -2, 0], "observed_ticks": 3, "slot_index": 1},
            ],
        )
        self.assertEqual(set(document), {
            "schema", "coordinate_space", "ticks_per_second", "cell_size", "coverage", "occupancy"
        })
        self.assertEqual(first["sha256"], hashlib.sha256(body).hexdigest())
        self.assertEqual(first["size_bytes"], len(body))
        self.assertEqual(first["encoding"], "gzip")

        payload = _finalization_payload(parsed, spatial_artifact=first)
        self.assertEqual(payload["spatial_artifact"], first)
        self.assertNotIn("occupancy", payload["spatial_artifact"])

    def test_reprocess_generation_is_stable_and_not_initial_generation(self) -> None:
        attempt_id = "77777777-7777-4777-8777-777777777777"
        generation = handler._reprocess_spatial_generation(attempt_id)
        self.assertEqual(generation, handler._reprocess_spatial_generation(attempt_id))
        self.assertGreaterEqual(generation, 2)
        self.assertLessEqual(generation, 2_147_483_647)


class ReplayParserNativeExtractorTests(unittest.TestCase):
    @staticmethod
    def _native_document() -> dict[str, object]:
        return {
            "schema": handler.NATIVE_EXTRACTOR_SCHEMA_VERSION,
            "parser": {
                "name": "replay-extractor",
                "json_library": "serde_json",
                "version": "0.1.0",
            },
            "summary": {"ticks_recorded": 2},
            "game_meta": {
                "players": {
                    "0": {
                        "damage_dealt": 42,
                        "shots_by_tick": {"0": 3},
                        "ignored": "value",
                    }
                }
            },
            "gametype_settings": {"mode": "slayer"},
            "network_game_client": {},
            "participant_context": {},
            "first_tick": {"players": [{"player_index": 0, "kills": 0}]},
            "last_tick": {"players": [{"player_index": 0, "kills": 1}]},
            "spawn_points": [],
            "spawn_source_path": None,
            "tick_count": 2,
            "event_count": 1,
            "event_sample": [{"type": "kill"}],
            "spatial_occupancy": {
                "cell_size": 0.5,
                "samples_seen": 2,
                "observations_by_slot": {"0": 2},
                "discarded": {},
                "cells": [
                    {"slot_index": 0, "cell": [-1, 2, 3], "observed_ticks": 2}
                ],
                "limits": {
                    "coordinate_absolute_max": handler.MAX_SPATIAL_COORDINATE_ABS,
                    "cells_per_slot": handler.MAX_SPATIAL_CELLS_PER_SLOT,
                    "cells_total": handler.MAX_SPATIAL_CELLS_TOTAL,
                    "counter": handler.MAX_SPATIAL_COUNTER,
                },
            },
        }

    def test_adapts_versioned_native_output_to_existing_python_contract(self) -> None:
        replay_document = handler._replay_document_from_native(self._native_document())

        self.assertEqual(replay_document["tick_count"], 2)
        self.assertEqual(replay_document["event_sample"], [{"type": "kill"}])
        self.assertEqual(
            replay_document["game_meta_players"],
            {"0": {"damage_dealt": 42, "shots_by_tick": {"0": 3}}},
        )
        occupancy = replay_document["spatial_occupancy"]
        self.assertEqual(occupancy.cells, {(0, -1, 2, 3): 2})
        self.assertEqual(occupancy.observations_by_slot, {0: 2})
        self.assertEqual(occupancy.parser_metadata["json_library"], "serde_json")

    def test_native_dispatch_skips_decompressed_json_file(self) -> None:
        parsed = _minimal_parsed_replay()
        with tempfile.TemporaryDirectory() as tmp:
            source_path = Path(tmp) / "replay.json.zst"
            source_path.touch()
            binary_path = Path(tmp) / "replay-extractor"
            binary_path.touch()
            json_path = Path(tmp) / "replay.json"
            with (
                patch.dict(os.environ, {"REPLAY_EXTRACTOR_MODE": "native"}),
                patch.object(handler, "_native_extractor_path", return_value=binary_path),
                patch.object(handler, "_parse_replay_native", return_value=parsed) as native,
                patch.object(
                    handler,
                    "_decompress_replay",
                    side_effect=AssertionError("native parsing must not decompress to disk"),
                ),
            ):
                result = handler._parse_downloaded_replay(source_path, json_path)

        self.assertIs(result, parsed)
        native.assert_called_once_with(source_path, binary_path=binary_path)

    def test_native_with_fallback_uses_existing_ijson_parser_after_failure(self) -> None:
        parsed = _minimal_parsed_replay()
        with tempfile.TemporaryDirectory() as tmp:
            source_path = Path(tmp) / "replay.json.zst"
            source_path.touch()
            binary_path = Path(tmp) / "replay-extractor"
            binary_path.touch()
            json_path = Path(tmp) / "replay.json"
            with (
                patch.dict(os.environ, {"REPLAY_EXTRACTOR_MODE": "native_with_fallback"}),
                patch.object(handler, "_native_extractor_path", return_value=binary_path),
                patch.object(
                    handler,
                    "_parse_replay_native",
                    side_effect=handler.ReplayProcessingError("native failure"),
                ),
                patch.object(handler, "_decompress_replay") as decompress,
                patch.object(handler, "_parse_replay", return_value=parsed) as python_parser,
            ):
                result = handler._parse_downloaded_replay(source_path, json_path)

        self.assertIs(result, parsed)
        decompress.assert_called_once_with(source_path, json_path)
        python_parser.assert_called_once_with(json_path)


class ReplayParserReprocessJobTests(unittest.TestCase):
    def test_rejects_reprocess_job_with_unsupported_viewer_contract(self) -> None:
        payload = _reprocess_job_payload()
        target = payload["viewer_artifact_target"]
        assert isinstance(target, dict)
        target["encoding_sha256"] = "0" * 64

        with self.assertRaises(handler.NonRetryableReplayError):
            handler._reprocess_job_from_payload(payload, "message-1")

    def test_reports_unsupported_viewer_contract_as_terminal_attempt_failure(self) -> None:
        payload = _reprocess_job_payload()
        target = payload["viewer_artifact_target"]
        assert isinstance(target, dict)
        target["projection_sha256"] = "0" * 64
        calls: list[tuple[str, str, dict[str, object]]] = []
        with (
            patch.object(
                handler,
                "_settings",
                return_value={
                    "reprocess_status_path_template": (
                        "/v1/ingest/replay-reprocess-attempts/{attempt_id}/status"
                    ),
                },
            ),
            patch.object(
                handler,
                "_call_app_api",
                side_effect=lambda method, path, body: calls.append(
                    (method, path, body)
                ),
            ),
        ):
            response = handler.handler(
                {"Records": [{"messageId": "message-1", "body": json.dumps(payload)}]},
                None,
            )

        self.assertEqual(response, {"batchItemFailures": []})
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "PATCH")
        self.assertTrue(calls[0][1].endswith(f"/{payload['attempt_id']}/status"))
        self.assertEqual(calls[0][2]["status"], "failed")

    def test_iter_replay_work_items_accepts_reprocess_job(self) -> None:
        payload = _reprocess_job_payload()

        work_items = handler._iter_replay_work_items(
            {"Records": [{"messageId": "message-1", "body": json.dumps(payload)}]}
        )

        self.assertEqual(len(work_items), 1)
        job = work_items[0]
        self.assertIsInstance(job, handler.ReplayReprocessJob)
        assert isinstance(job, handler.ReplayReprocessJob)
        self.assertEqual(job.sqs_message_id, "message-1")
        self.assertEqual(job.mode, "full_reparse")
        self.assertEqual(job.upload_id, "66666666-6666-4666-8666-666666666666")
        self.assertEqual(
            job.source_object.key,
            "replays/processed/66666666-6666-4666-8666-666666666666/original+replay.json.zst",
        )
        self.assertEqual(
            job.current_replay_file.key,
            "replays/processed/66666666-6666-4666-8666-666666666666/original+replay.json.zst",
        )
        self.assertEqual(job.current_replay_file.sha256, "a" * 64)
        self.assertEqual(job.source_object.version_id, "source-version-1")
        assert job.viewer_request is not None
        self.assertEqual(job.viewer_request.request_epoch, 3)

    def test_accepts_api_legacy_full_reparse_without_viewer_target(self) -> None:
        job = handler._reprocess_job_from_payload(
            _reprocess_job_payload(include_viewer=False),
            "message-1",
        )

        self.assertEqual(job.requested_outputs, handler.FULL_REPARSE_OUTPUTS)
        self.assertIsNone(job.source_object.version_id)
        self.assertIsNone(job.viewer_request)

    def test_legacy_full_reparse_keeps_facts_path_without_viewer_output(self) -> None:
        job = handler._reprocess_job_from_payload(
            _reprocess_job_payload(include_viewer=False),
            "message-1",
        )
        parsed = _minimal_parsed_replay()
        downloaded = handler.DownloadedReplay(
            path=Path("source-replay.json.zst"),
            content_type="application/octet-stream",
            size_bytes=123,
            sha256="a" * 64,
            metadata={},
        )
        api_calls: list[tuple[str, str, dict[str, object]]] = []

        with (
            patch.object(handler, "_download_replay", return_value=downloaded),
            patch.object(handler, "_parse_downloaded_replay", return_value=parsed),
            patch.object(
                handler,
                "_parse_downloaded_replay_with_viewer",
                side_effect=AssertionError("legacy full_reparse must not build viewer parts"),
            ),
            patch.object(handler, "assemble_viewer_container", side_effect=AssertionError()),
            patch.object(handler, "_write_viewer_artifact", side_effect=AssertionError()),
            patch.object(handler, "_write_spatial_artifact", return_value={"spatial": True}),
            patch.object(
                handler,
                "_replay_finalization_payload",
                return_value={"facts": True},
            ),
            patch.object(
                handler,
                "_persist_and_dispatch_completion",
                side_effect=AssertionError("facts-only work has no viewer generation"),
            ),
            patch.object(
                handler,
                "_settings",
                return_value={"replay_finalization_path": "/v1/ingest/replay-uploads"},
            ),
            patch.object(
                handler,
                "_call_app_api",
                side_effect=lambda method, path, payload: api_calls.append(
                    (method, path, payload)
                ),
            ),
        ):
            handler._process_reprocess_job(job)

        self.assertEqual(
            api_calls,
            [("POST", "/v1/ingest/replay-uploads", {"facts": True})],
        )

    def test_process_reprocess_job_downloads_source_without_source_mutation(self) -> None:
        job = handler._reprocess_job_from_payload(_reprocess_job_payload(), "message-1")
        parsed = _minimal_parsed_replay()
        downloaded = handler.DownloadedReplay(
            path=Path("source-replay.json.zst"),
            content_type="application/octet-stream",
            size_bytes=123,
            sha256="a" * 64,
            metadata={},
            version_id="source-version-1",
        )
        viewer_parts = handler.ViewerParts(
            directory=Path("viewer-parts"),
            tick_count=1,
            replay={},
            chunks=(),
            producer="test",
            projection_duration_ms=1,
            encode_duration_ms=1,
        )
        viewer_container = handler.ViewerContainer(
            path=Path("viewer.hsrv"),
            sha256="c" * 64,
            size_bytes=100,
            uncompressed_size_bytes=200,
            tick_count=1,
            chunk_count=1,
            manifest={},
            metrics={},
        )
        download_calls: list[handler.S3ReplayObject] = []
        completion_calls: list[dict[str, object]] = []
        spatial_manifest = {"schema": "halospawns.spatialFacts.v1", "generation": 2}
        viewer_manifest = {"sha256": "c" * 64}

        def capture_download(
            replay_object: handler.S3ReplayObject,
            destination: Path,
        ) -> handler.DownloadedReplay:
            download_calls.append(replay_object)
            return downloaded

        with (
            patch.object(handler, "_replay_persisted_completion", return_value=False),
            patch.object(handler, "_download_replay", side_effect=capture_download),
            patch.object(
                handler,
                "_parse_downloaded_replay_with_viewer",
                return_value=(parsed, viewer_parts),
            ),
            patch.object(handler, "assemble_viewer_container", return_value=viewer_container),
            patch.object(handler, "_write_viewer_artifact", return_value=viewer_manifest),
            patch.object(
                handler,
                "_write_spatial_artifact",
                return_value=spatial_manifest,
            ) as write_spatial,
            patch.object(
                handler,
                "_replay_finalization_payload",
                return_value={"callback": True},
            ) as finalization_payload,
            patch.object(
                handler,
                "_persist_and_dispatch_completion",
                side_effect=lambda **kwargs: completion_calls.append(kwargs),
            ),
            patch.object(
                handler,
                "_settings",
                return_value={"replay_finalization_path": "/v1/ingest/replay-uploads"},
            ),
            patch.object(handler, "_copy_object", side_effect=AssertionError("no copy")),
            patch.object(handler, "_delete_object", side_effect=AssertionError("no delete")),
            patch.object(
                handler,
                "_send_upload_status",
                side_effect=AssertionError("no upload status"),
            ),
        ):
            handler._process_reprocess_job(job)

        self.assertEqual(download_calls, [job.source_object])
        self.assertEqual(len(completion_calls), 1)
        self.assertEqual(completion_calls[0]["mode"], "full_reparse")
        self.assertEqual(completion_calls[0]["callback_payload"], {"callback": True})
        self.assertEqual(completion_calls[0]["generation_token"], job.attempt_id)
        self.assertEqual(finalization_payload.call_args.kwargs["viewer_artifact"], viewer_manifest)
        self.assertEqual(finalization_payload.call_args.kwargs["replay_file"], job.current_replay_file)
        write_spatial.assert_called_once_with(
            parsed=parsed,
            bucket=job.current_replay_file.bucket,
            upload_id=job.upload_id,
            generation=handler._reprocess_spatial_generation(job.attempt_id),
            source_replay_sha256=downloaded.sha256,
        )

    def test_viewer_rebuild_uses_only_the_artifact_completion_callback(self) -> None:
        job = handler._reprocess_job_from_payload(
            _reprocess_job_payload(mode="viewer_rebuild"),
            "message-1",
        )
        parsed = _minimal_parsed_replay()
        downloaded = handler.DownloadedReplay(
            path=Path("source-replay.json.zst"),
            content_type="application/octet-stream",
            size_bytes=123,
            sha256="a" * 64,
            metadata={},
            version_id="source-version-1",
        )
        viewer_parts = handler.ViewerParts(
            directory=Path("viewer-parts"),
            tick_count=1,
            replay={},
            chunks=(),
            producer="test",
            projection_duration_ms=1,
            encode_duration_ms=1,
        )
        viewer_container = handler.ViewerContainer(
            path=Path("viewer.hsrv"),
            sha256="c" * 64,
            size_bytes=100,
            uncompressed_size_bytes=200,
            tick_count=1,
            chunk_count=1,
            manifest={},
            metrics={},
        )
        viewer_manifest = {"sha256": "c" * 64}
        completion_calls: list[dict[str, object]] = []

        with (
            patch.object(handler, "_replay_persisted_completion", return_value=False),
            patch.object(handler, "_download_replay", return_value=downloaded),
            patch.object(
                handler,
                "_parse_downloaded_replay_with_viewer",
                return_value=(parsed, viewer_parts),
            ),
            patch.object(handler, "assemble_viewer_container", return_value=viewer_container),
            patch.object(handler, "_write_viewer_artifact", return_value=viewer_manifest),
            patch.object(
                handler,
                "_write_spatial_artifact",
                side_effect=AssertionError("viewer_rebuild must not write facts"),
            ),
            patch.object(
                handler,
                "_replay_finalization_payload",
                side_effect=AssertionError("viewer_rebuild must not finalize facts"),
            ),
            patch.object(
                handler,
                "_persist_and_dispatch_completion",
                side_effect=lambda **kwargs: completion_calls.append(kwargs),
            ),
            patch.object(
                handler,
                "_settings",
                return_value={
                    "viewer_artifact_completion_path": "/v1/ingest/replay-viewer-artifacts"
                },
            ),
        ):
            handler._process_reprocess_job(job)

        self.assertEqual(len(completion_calls), 1)
        completion = completion_calls[0]
        self.assertEqual(completion["mode"], "viewer_rebuild")
        self.assertEqual(
            completion["callback_path"],
            "/v1/ingest/replay-viewer-artifacts",
        )
        self.assertEqual(
            completion["callback_payload"],
            {
                "replay_file_id": job.replay_id,
                "upload_id": job.upload_id,
                "reprocess_attempt_id": job.attempt_id,
                "source_replay_sha256": downloaded.sha256,
                "viewer_artifact": viewer_manifest,
            },
        )

    def test_process_reprocess_job_marks_missing_source_failed(self) -> None:
        job = handler._reprocess_job_from_payload(_reprocess_job_payload(), "message-1")
        missing_source_error = handler.ClientError(
            {
                "Error": {
                    "Code": "NoSuchKey",
                    "Message": "The specified key does not exist.",
                },
                "ResponseMetadata": {
                    "HTTPStatusCode": 404,
                    "RequestId": "request-1",
                },
            },
            "GetObject",
        )
        api_calls: list[tuple[str, str, dict[str, object]]] = []

        def capture_call(method: str, path: str, payload: dict[str, object]) -> dict[str, object]:
            api_calls.append((method, path, payload))
            return {}

        with (
            patch.object(handler, "_replay_persisted_completion", return_value=False),
            patch.object(handler, "_download_replay", side_effect=missing_source_error),
            patch.object(
                handler,
                "_settings",
                return_value={
                    "reprocess_status_path_template": (
                        "/v1/ingest/replay-reprocess-attempts/{attempt_id}/status"
                    ),
                },
            ),
            patch.object(handler, "_call_app_api", side_effect=capture_call),
            patch.object(handler, "_decompress_replay", side_effect=AssertionError("no decompress")),
            patch.object(handler, "_parse_replay", side_effect=AssertionError("no parse")),
            patch.object(handler, "_finalize_replay_upload", side_effect=AssertionError("no finalize")),
            patch.object(handler, "_copy_object", side_effect=AssertionError("no copy")),
            patch.object(handler, "_delete_object", side_effect=AssertionError("no delete")),
        ):
            handler._process_reprocess_job(job)

        self.assertEqual(len(api_calls), 1)
        method, path, payload = api_calls[0]
        self.assertEqual(method, "PATCH")
        self.assertEqual(
            path,
            f"/v1/ingest/replay-reprocess-attempts/{job.attempt_id}/status",
        )
        self.assertEqual(payload["status"], "failed")
        self.assertIn("NoSuchKey", payload["error_message"])
        metadata = payload["metadata"]
        self.assertIsInstance(metadata, dict)
        self.assertEqual(metadata["source_replay"]["s3_key"], job.source_object.key)
        self.assertEqual(metadata["s3_error"]["code"], "NoSuchKey")
        self.assertEqual(metadata["s3_error"]["http_status_code"], 404)
        self.assertEqual(metadata["processor_error"]["type"], "ClientError")

    def test_finalization_payload_includes_reprocess_attempt_and_current_file(self) -> None:
        parsed = _minimal_parsed_replay()
        upload_id = "66666666-6666-4666-8666-666666666666"
        source_key = f"replays/processed/{upload_id}/original.json.zst"
        current_file = handler.ReplayOutputFile(
            bucket="uploads-bucket",
            key=f"replays/processed/{upload_id}/game.json.zst",
            file_role="processed",
            content_type="application/zstd",
            size_bytes=456,
            sha256="b" * 64,
        )

        payload = _finalization_payload(
            parsed,
            original_key=source_key,
            processed_key=current_file.key,
            replay_file=current_file,
            reprocess_attempt_id="77777777-7777-4777-8777-777777777777",
        )

        self.assertEqual(
            payload["reprocess_attempt_id"],
            "77777777-7777-4777-8777-777777777777",
        )
        self.assertEqual(payload["replay_file"]["s3_key"], current_file.key)
        self.assertEqual(payload["replay_file"]["size_bytes"], 456)
        self.assertEqual(payload["replay_file"]["sha256"], "b" * 64)
        self.assertEqual(payload["replay_file"]["metadata"]["original_s3_key"], source_key)
        self.assertEqual(payload["metadata"]["original_s3_key"], source_key)
        self.assertEqual(payload["metadata"]["processed_s3_key"], current_file.key)
        self.assertEqual(payload["game_meta"], {"players": {}})


if __name__ == "__main__":
    unittest.main()
