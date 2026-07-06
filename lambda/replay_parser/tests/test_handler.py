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
    game_meta: dict[str, object] | None = None,
    include_game_meta: bool = True,
    gametype_settings: dict[str, object] | None = None,
    network_game_client: dict[str, object] | None = None,
    participant_context: dict[str, object] | None = None,
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
        "ticks": [tick],
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
        )

    return calls[0][2]


def _reprocess_job_payload() -> dict[str, object]:
    upload_id = "66666666-6666-4666-8666-666666666666"
    replay_id = "44444444-4444-4444-8444-444444444444"
    attempt_id = "77777777-7777-4777-8777-777777777777"
    operation_id = "99999999-9999-4999-8999-999999999999"
    return {
        "schema": "halospawns.replay_reprocess_job.v1",
        "job_id": f"replay:{replay_id}:attempt:{attempt_id}",
        "trigger": "manual_reprocess",
        "environment": "dev",
        "operation_id": operation_id,
        "attempt_id": attempt_id,
        "mode": "full_reparse",
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
        },
        "current_replay_file": {
            "file_role": "processed",
            "s3_bucket": "uploads-bucket",
            "s3_key": f"replays/processed/{upload_id}/game.json.zst",
            "content_type": "application/zstd",
            "size_bytes": 456,
            "sha256": "b" * 64,
        },
        "requested_outputs": ["game", "participants", "stats", "spawn_points", "game_meta"],
        "created_at": "2026-07-02T00:00:00Z",
    }


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


class ReplayParserReprocessJobTests(unittest.TestCase):
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
            "replays/processed/66666666-6666-4666-8666-666666666666/game.json.zst",
        )
        self.assertEqual(job.current_replay_file.sha256, "b" * 64)

    def test_process_reprocess_job_downloads_source_without_source_mutation(self) -> None:
        job = handler._reprocess_job_from_payload(_reprocess_job_payload(), "message-1")
        parsed = _minimal_parsed_replay()
        downloaded = handler.DownloadedReplay(
            path=Path("source-replay.json.zst"),
            content_type="application/octet-stream",
            size_bytes=123,
            sha256="a" * 64,
            metadata={},
        )
        download_calls: list[handler.S3ReplayObject] = []
        finalize_calls: list[dict[str, object]] = []

        def capture_download(
            replay_object: handler.S3ReplayObject,
            destination: Path,
        ) -> handler.DownloadedReplay:
            download_calls.append(replay_object)
            return downloaded

        def capture_finalize(**kwargs: object) -> None:
            finalize_calls.append(kwargs)

        with (
            patch.object(handler, "_download_replay", side_effect=capture_download),
            patch.object(handler, "_decompress_replay"),
            patch.object(handler, "_parse_replay", return_value=parsed),
            patch.object(handler, "_finalize_replay_upload", side_effect=capture_finalize),
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
        self.assertEqual(len(finalize_calls), 1)
        self.assertEqual(finalize_calls[0]["upload_id"], job.upload_id)
        self.assertEqual(finalize_calls[0]["source_external_id"], job.upload_id)
        self.assertEqual(finalize_calls[0]["processed_key"], job.current_replay_file.key)
        self.assertEqual(finalize_calls[0]["replay_file"], job.current_replay_file)
        self.assertEqual(finalize_calls[0]["reprocess_attempt_id"], job.attempt_id)

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
