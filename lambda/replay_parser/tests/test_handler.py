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


def _write_replay_json(directory: Path, *, map_info: dict[str, object] | None) -> Path:
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

    path = directory / "replay.json"
    path.write_text(
        json.dumps(
            {
                "summary": {
                    "game_id": "minimal-game",
                    "is_full_game": True,
                    "recording_started": "2026-05-09 15:51:32.887485",
                    "recording_ended": "2026-05-09 15:52:20.278065",
                    "game_duration_ingame": "0:00:47",
                    "ticks_elapsed": 1,
                    "ticks_recorded": 1,
                    "ticks_dropped": 0,
                    "recording_duration": "0:00:47",
                },
                "game_meta": {"players": {}},
                "ticks": [tick],
                "events": [],
            }
        ),
        encoding="utf-8",
    )
    return path


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

        payload = calls[0][2]
        game = payload["game"]
        self.assertIsInstance(game, dict)
        self.assertEqual(game["cache_version"], 5)
        self.assertEqual(game["build_version"], "01.10.12.2300")
        self.assertNotIn("game_release_key", game)


if __name__ == "__main__":
    unittest.main()
