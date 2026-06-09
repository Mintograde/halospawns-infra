from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")

REPLAY_PARSER_DIR = Path(__file__).resolve().parents[1]
if str(REPLAY_PARSER_DIR) not in sys.path:
    sys.path.insert(0, str(REPLAY_PARSER_DIR))

import handler  # noqa: E402


def _write_replay_json(
    directory: Path,
    *,
    map_info: dict[str, object] | None,
    gametype_settings: dict[str, object] | None = None,
    summary_overrides: dict[str, object] | None = None,
    tick_overrides: dict[str, object] | None = None,
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
        "game_meta": {"players": {}},
        "ticks": [tick],
        "events": [],
    }
    if gametype_settings is not None:
        replay["gametype_settings"] = gametype_settings

    path.write_text(
        json.dumps(replay),
        encoding="utf-8",
    )
    return path


def _finalization_payload(parsed: handler.ParsedReplay) -> dict[str, object]:
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
                key="replays/unprocessed/22222222-2222-4222-8222-222222222222.json.zst",
                event_name="ObjectCreated:Put",
                sqs_message_id="message-1",
            ),
            processed_key="replays/processed/22222222-2222-4222-8222-222222222222.json.zst",
            downloaded=handler.DownloadedReplay(
                path=Path("replay.json.zst"),
                content_type="application/zstd",
                size_bytes=123,
                sha256="a" * 64,
                metadata={},
            ),
            parsed=parsed,
        )

    return calls[0][2]


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


class ReplayParserMapInfoEvidenceTests(unittest.TestCase):
    def test_parse_replay_promotes_cache_and_build_evidence_from_map_info(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_replay_json(
                Path(tmp),
                map_info={
                    "cache_version": 5,
                    "build_version": "01.10.12.2300",
                    "scenario_name": "prisoner",
                },
            )

            parsed = handler._parse_replay(path)

        self.assertEqual(parsed.game["cache_version"], 5)
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


if __name__ == "__main__":
    unittest.main()
