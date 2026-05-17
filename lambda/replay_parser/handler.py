from __future__ import annotations

import gzip
import hashlib
import hmac
import json
import logging
import os
import posixpath
import re
import shutil
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import boto3
import ijson
import zstandard

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

S3 = boto3.client("s3")
SECRETS = boto3.client("secretsmanager")

UUID_PATTERN = re.compile(
    r"(?P<upload_id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})"
)
SECRET_CACHE: dict[str, str] = {}
COMPOSITE_JSON_EVENTS = {"start_map", "end_map", "start_array", "end_array", "map_key"}
TICK_FIELDS = {
    "multiplayer_map_name",
    "game_type",
    "variant",
    "current_time",
    "start_time",
    "game_id",
}
PLAYER_FIELDS = {
    "player_index",
    "local_player",
    "name",
    "player_name",
    "team",
    "score",
    "ctf_score",
    "kills",
    "deaths",
    "assists",
    "suicides",
    "team_kills",
    "player_quit",
}
META_PLAYER_SCALAR_FIELDS = {
    "damage_dealt",
    "damage_received",
    "camo_count",
    "overshield_count",
}
META_PLAYER_MAPPING_FIELDS = {
    "shots_by_weapon",
    "damage_to_player",
    "damage_from_player",
    "shots_by_tick",
    "kills_by_tick",
    "deaths_by_tick",
    "assists_by_tick",
}


class ReplayProcessingError(Exception):
    """Base class for replay processing failures."""


class NonRetryableReplayError(ReplayProcessingError):
    """A replay is malformed or unsupported and should not be retried unchanged."""


@dataclass(frozen=True)
class S3ReplayObject:
    bucket: str
    key: str
    event_name: str | None
    sqs_message_id: str


@dataclass(frozen=True)
class DownloadedReplay:
    path: Path
    content_type: str | None
    size_bytes: int
    sha256: str
    metadata: dict[str, str]


@dataclass(frozen=True)
class ParsedReplay:
    game: dict[str, Any]
    participants: list[dict[str, Any]]
    team_stats: list[dict[str, Any]]
    metadata: dict[str, Any]


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    failures: list[dict[str, str]] = []

    for replay_object in _iter_s3_replay_objects(event):
        try:
            _process_replay_object(replay_object)
        except Exception:
            LOGGER.exception(
                "Replay processing failed for s3://%s/%s",
                replay_object.bucket,
                replay_object.key,
            )
            failures.append({"itemIdentifier": replay_object.sqs_message_id})

    return {"batchItemFailures": failures}


def _process_replay_object(replay_object: S3ReplayObject) -> None:
    settings = _settings()
    if not replay_object.key.startswith(settings["unprocessed_prefix"]):
        LOGGER.info("Skipping non-replay-unprocessed object: %s", replay_object.key)
        return

    upload_id = _upload_id_from_key(replay_object.key)
    compressed_path = Path("/tmp") / f"{upload_id}-{posixpath.basename(replay_object.key)}"
    json_path = Path("/tmp") / f"{upload_id}.json"

    try:
        _send_upload_status(
            upload_id,
            "processing",
            metadata={
                "s3": {
                    "bucket": replay_object.bucket,
                    "key": replay_object.key,
                    "event_name": replay_object.event_name,
                },
            },
        )

        downloaded = _download_replay(replay_object, compressed_path)
        upload_id = downloaded.metadata.get("upload-id") or upload_id
        _decompress_replay(downloaded.path, json_path)
        parsed = _parse_replay(json_path)
        processed_key = _processed_key(
            replay_object.key,
            unprocessed_prefix=settings["unprocessed_prefix"],
            processed_prefix=settings["processed_prefix"],
        )
        _copy_object(replay_object.bucket, replay_object.key, processed_key)

        try:
            _finalize_replay_upload(
                upload_id=upload_id,
                source_external_id=upload_id,
                original_object=replay_object,
                processed_key=processed_key,
                downloaded=downloaded,
                parsed=parsed,
            )
        except Exception:
            LOGGER.exception("Replay finalization API call failed; keeping source object for retry")
            raise

        _delete_object(replay_object.bucket, replay_object.key)
        LOGGER.info(
            "Processed replay upload %s from s3://%s/%s to s3://%s/%s",
            upload_id,
            replay_object.bucket,
            replay_object.key,
            replay_object.bucket,
            processed_key,
        )
    except NonRetryableReplayError as error:
        error_details = _exception_details(error)
        LOGGER.warning(
            "Replay upload %s is not processable: %s",
            upload_id,
            error,
            exc_info=True,
        )
        _send_upload_status(
            upload_id,
            "failed",
            processing_error=str(error),
            metadata={
                "s3": {
                    "bucket": replay_object.bucket,
                    "key": replay_object.key,
                    "event_name": replay_object.event_name,
                },
                "processor_error": error_details,
            },
        )
        failed_key = _processed_key(
            replay_object.key,
            unprocessed_prefix=settings["unprocessed_prefix"],
            processed_prefix=settings["failed_prefix"],
        )
        _copy_object(replay_object.bucket, replay_object.key, failed_key)
        _delete_object(replay_object.bucket, replay_object.key)
    finally:
        _unlink_if_exists(compressed_path)
        _unlink_if_exists(json_path)


def _iter_s3_replay_objects(event: dict[str, Any]) -> list[S3ReplayObject]:
    replay_objects: list[S3ReplayObject] = []

    for record in event.get("Records", []):
        sqs_message_id = str(record.get("messageId") or record.get("messageID") or "")
        payload = _record_payload(record)
        for s3_record in payload.get("Records", []):
            s3_data = s3_record.get("s3") or {}
            bucket = (s3_data.get("bucket") or {}).get("name")
            key = (s3_data.get("object") or {}).get("key")
            if not bucket or not key:
                continue
            replay_objects.append(
                S3ReplayObject(
                    bucket=str(bucket),
                    key=urllib.parse.unquote_plus(str(key)),
                    event_name=s3_record.get("eventName"),
                    sqs_message_id=sqs_message_id or str(len(replay_objects)),
                )
            )

    return replay_objects


def _record_payload(record: dict[str, Any]) -> dict[str, Any]:
    body = record.get("body")
    if body is None and "s3" in record:
        return {"Records": [record]}

    try:
        payload = json.loads(str(body))
    except json.JSONDecodeError as error:
        raise NonRetryableReplayError("SQS record body was not valid JSON") from error

    if isinstance(payload, dict) and isinstance(payload.get("Message"), str):
        try:
            message = json.loads(payload["Message"])
        except json.JSONDecodeError as error:
            raise NonRetryableReplayError("SNS message was not valid JSON") from error
        if isinstance(message, dict):
            return message

    if isinstance(payload, dict):
        return payload

    raise NonRetryableReplayError("SQS record body did not contain an S3 event")


def _download_replay(replay_object: S3ReplayObject, destination: Path) -> DownloadedReplay:
    response = S3.get_object(Bucket=replay_object.bucket, Key=replay_object.key)
    body = response["Body"]
    hasher = hashlib.sha256()
    size_bytes = 0

    with destination.open("wb") as output:
        for chunk in iter(lambda: body.read(1024 * 1024), b""):
            if not chunk:
                break
            hasher.update(chunk)
            size_bytes += len(chunk)
            output.write(chunk)

    metadata = {
        str(key).lower(): str(value)
        for key, value in (response.get("Metadata") or {}).items()
    }
    return DownloadedReplay(
        path=destination,
        content_type=response.get("ContentType"),
        size_bytes=size_bytes,
        sha256=hasher.hexdigest(),
        metadata=metadata,
    )


def _decompress_replay(source: Path, destination: Path) -> None:
    source_name = source.name.lower()
    try:
        if source_name.endswith(".zst"):
            with source.open("rb") as compressed, destination.open("wb") as output:
                reader = zstandard.ZstdDecompressor().stream_reader(compressed)
                with reader:
                    shutil.copyfileobj(reader, output, length=1024 * 1024)
            return

        if source_name.endswith(".gz"):
            with gzip.open(source, "rb") as compressed, destination.open("wb") as output:
                shutil.copyfileobj(compressed, output, length=1024 * 1024)
            return

        if source_name.endswith(".zip"):
            _extract_json_from_zip(source, destination)
            return

        if source_name.endswith(".json"):
            shutil.copyfile(source, destination)
            return
    except (OSError, zstandard.ZstdError, zipfile.BadZipFile) as error:
        raise NonRetryableReplayError(f"Replay decompression failed: {error}") from error

    raise NonRetryableReplayError("Unsupported replay file extension")


def _extract_json_from_zip(source: Path, destination: Path) -> None:
    with zipfile.ZipFile(source) as archive:
        candidates = [
            name
            for name in archive.namelist()
            if not name.endswith("/") and name.lower().endswith(".json")
        ]
        if len(candidates) != 1:
            raise NonRetryableReplayError("Replay zip must contain exactly one JSON file")
        with archive.open(candidates[0]) as compressed, destination.open("wb") as output:
            shutil.copyfileobj(compressed, output, length=1024 * 1024)


def _parse_replay(json_path: Path) -> ParsedReplay:
    try:
        replay_document = _extract_replay_document(json_path)
    except Exception as error:
        raise NonRetryableReplayError(f"Replay JSON parse failed: {error}") from error

    tick_count = replay_document["tick_count"]
    if tick_count < 1:
        raise NonRetryableReplayError("Replay JSON did not contain ticks")

    summary = _proxy_dict(replay_document["summary"])
    game_meta_players = _proxy_dict(replay_document["game_meta_players"])
    first_tick = replay_document["first_tick"]
    last_tick = replay_document["last_tick"]
    first_players = [_proxy_dict(player) for player in first_tick.get("players", [])]
    last_players = [_proxy_dict(player) for player in last_tick.get("players", [])]
    meta_players = {
        str(player_id): _proxy_dict(player)
        for player_id, player in game_meta_players.items()
    }

    participants = _participants_from_replay(first_players, last_players, meta_players)
    team_stats = _team_stats_from_participants(participants)
    game = _game_from_replay(
        summary=summary,
        first_tick=first_tick,
        last_tick=last_tick,
        team_stats=team_stats,
    )
    metadata = {
        "summary": summary,
        "tick_count": tick_count,
        "event_count": replay_document["event_count"],
        "event_sample": replay_document["event_sample"],
        "parser": {
            "name": "halospawns-replay-parser",
            "json_library": "ijson",
            "ijson_backend": getattr(ijson.backend, "__name__", str(ijson.backend)),
        },
    }

    return ParsedReplay(
        game=game,
        participants=participants,
        team_stats=team_stats,
        metadata=metadata,
    )


def _extract_replay_document(json_path: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    game_meta_players: dict[str, Any] = {}
    first_tick: dict[str, Any] | None = None
    last_tick: dict[str, Any] | None = None
    current_tick: dict[str, Any] | None = None
    current_player: dict[str, Any] | None = None
    tick_count = 0
    event_count = 0
    event_sample: list[Any] = []

    active_builder: ijson.ObjectBuilder | None = None
    active_target: str | None = None
    active_end_event: str | None = None
    active_context: tuple[str, str, str] | None = None

    with json_path.open("rb") as replay_file:
        for prefix, event, value in ijson.parse(replay_file, use_float=True):
            if active_builder is not None:
                active_builder.event(event, value)
                if prefix == active_target and event == active_end_event:
                    built_value = active_builder.value
                    if active_target == "summary":
                        summary = _proxy_dict(built_value)
                    elif active_context and active_context[0] == "meta_player_field":
                        _, player_id, field = active_context
                        game_meta_players.setdefault(player_id, {})[field] = built_value
                    elif active_target == "events.item":
                        event_count += 1
                        if len(event_sample) < 10:
                            event_sample.append(built_value)

                    active_builder = None
                    active_target = None
                    active_end_event = None
                    active_context = None
                continue

            if prefix == "summary" and event in ("start_map", "start_array"):
                active_builder, active_target, active_end_event, active_context = _start_json_builder(
                    prefix,
                    event,
                    value,
                )
                continue

            meta_player_field = _meta_player_field(prefix)
            if meta_player_field is not None:
                player_id, field = meta_player_field
                if field in META_PLAYER_SCALAR_FIELDS and _is_scalar_json_event(event):
                    game_meta_players.setdefault(player_id, {})[field] = value
                elif field in META_PLAYER_MAPPING_FIELDS and event in ("start_map", "start_array"):
                    active_builder, active_target, active_end_event, active_context = _start_json_builder(
                        prefix,
                        event,
                        value,
                        context=("meta_player_field", player_id, field),
                    )
                continue

            if prefix == "ticks.item" and event == "start_map":
                current_tick = {"players": []}
                continue

            if current_tick is not None:
                if prefix == "ticks.item" and event == "end_map":
                    tick_count += 1
                    if first_tick is None:
                        first_tick = current_tick
                    last_tick = current_tick
                    current_tick = None
                    continue

                if prefix == "ticks.item.players.item" and event == "start_map":
                    current_player = {}
                    continue

                if current_player is not None:
                    if prefix == "ticks.item.players.item" and event == "end_map":
                        current_tick["players"].append(current_player)
                        current_player = None
                        continue

                    player_field = _direct_child_field(prefix, "ticks.item.players.item")
                    if player_field in PLAYER_FIELDS and _is_scalar_json_event(event):
                        current_player[player_field] = value
                    continue

                tick_field = _direct_child_field(prefix, "ticks.item")
                if tick_field in TICK_FIELDS and _is_scalar_json_event(event):
                    current_tick[tick_field] = value
                continue

            if prefix == "events.item":
                if event in ("start_map", "start_array"):
                    active_builder, active_target, active_end_event, active_context = _start_json_builder(
                        prefix,
                        event,
                        value,
                    )
                elif _is_scalar_json_event(event):
                    event_count += 1
                    if len(event_sample) < 10:
                        event_sample.append(value)

    return {
        "summary": summary,
        "game_meta_players": game_meta_players,
        "first_tick": first_tick or {},
        "last_tick": last_tick or {},
        "tick_count": tick_count,
        "event_count": event_count,
        "event_sample": event_sample,
    }


def _start_json_builder(
    prefix: str,
    event: str,
    value: Any,
    *,
    context: tuple[str, str, str] | None = None,
) -> tuple[ijson.ObjectBuilder, str, str, tuple[str, str, str] | None]:
    builder = ijson.ObjectBuilder()
    builder.event(event, value)
    end_event = "end_map" if event == "start_map" else "end_array"
    return builder, prefix, end_event, context


def _meta_player_field(prefix: str) -> tuple[str, str] | None:
    parts = prefix.split(".")
    if len(parts) != 4 or parts[0] != "game_meta" or parts[1] != "players":
        return None
    return parts[2], parts[3]


def _direct_child_field(prefix: str, parent_prefix: str) -> str | None:
    prefix_start = f"{parent_prefix}."
    if not prefix.startswith(prefix_start):
        return None
    field = prefix[len(prefix_start) :]
    return field if "." not in field else None


def _is_scalar_json_event(event: str) -> bool:
    return event not in COMPOSITE_JSON_EVENTS


def _game_from_replay(
    *,
    summary: dict[str, Any],
    first_tick: Any,
    last_tick: Any,
    team_stats: list[dict[str, Any]],
) -> dict[str, Any]:
    map_engine_name = _optional_text(
        last_tick.get("multiplayer_map_name") or first_tick.get("multiplayer_map_name")
    )
    game_type = _optional_text(last_tick.get("game_type") or first_tick.get("game_type"))
    variant = _jsonable(last_tick.get("variant") or first_tick.get("variant"))
    started_at = _timestamp_string(
        summary.get("recording_started") or first_tick.get("start_time")
    )
    ended_at = _timestamp_string(summary.get("recording_ended") or last_tick.get("current_time"))
    duration_seconds = _duration_seconds(summary.get("game_duration_ingame"))
    winning_team_index = _winning_team_index(team_stats)

    return {
        "map_engine_name": map_engine_name,
        "game_type": game_type,
        "variant_name": variant if isinstance(variant, str) else None,
        "status": "completed" if summary.get("is_full_game") is not False else "imported",
        "started_at": started_at,
        "ended_at": ended_at,
        "duration_seconds": duration_seconds,
        "winning_team_index": winning_team_index,
        "metadata": {
            "game_id": summary.get("game_id") or last_tick.get("game_id"),
            "is_full_game": summary.get("is_full_game"),
            "map_engine_name": map_engine_name,
            "map_short_name": _map_short_name(map_engine_name),
            "variant": variant,
            "ticks_elapsed": summary.get("ticks_elapsed"),
            "ticks_recorded": summary.get("ticks_recorded"),
            "ticks_dropped": summary.get("ticks_dropped"),
            "recording_duration": summary.get("recording_duration"),
        },
    }


def _participants_from_replay(
    first_players: list[dict[str, Any]],
    last_players: list[dict[str, Any]],
    meta_players: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    first_by_index = {_player_index(player, fallback=index): player for index, player in enumerate(first_players)}
    participants: list[dict[str, Any]] = []

    for fallback_index, last_player in enumerate(last_players):
        slot_index = _player_index(last_player, fallback=fallback_index)
        first_player = first_by_index.get(slot_index, {})
        meta_player = meta_players.get(str(slot_index), {})
        team_index = _optional_int(last_player.get("team", first_player.get("team")))
        score = _optional_int(last_player.get("score"))
        ctf_score = _optional_int(last_player.get("ctf_score"))
        shots_fired = _sum_numeric_values(meta_player.get("shots_by_tick"))
        kills = _optional_int(last_player.get("kills")) or _sum_numeric_values(
            meta_player.get("kills_by_tick")
        )
        deaths = _optional_int(last_player.get("deaths")) or _sum_numeric_values(
            meta_player.get("deaths_by_tick")
        )
        assists = _optional_int(last_player.get("assists")) or _sum_numeric_values(
            meta_player.get("assists_by_tick")
        )

        participants.append(
            {
                "slot_index": slot_index,
                "team_index": team_index,
                "team_name": _team_name(team_index),
                "in_game_name": _player_name(last_player, first_player, slot_index),
                "metadata": {
                    "replay_player_index": slot_index,
                    "local_player": last_player.get("local_player"),
                    "ctf_score": ctf_score,
                    "player_quit": last_player.get("player_quit"),
                },
                "stats": {
                    "kills": kills,
                    "deaths": deaths,
                    "assists": assists,
                    "suicides": _optional_int(last_player.get("suicides")),
                    "betrayals": _optional_int(last_player.get("team_kills")),
                    "score": score if score not in (None, 0) else ctf_score,
                    "shots_fired": shots_fired,
                    "damage_dealt": _optional_float(meta_player.get("damage_dealt")),
                    "damage_taken": _optional_float(meta_player.get("damage_received")),
                    "raw_stats": {
                        "shots_by_weapon": _small_mapping(meta_player.get("shots_by_weapon")),
                        "damage_to_player": _small_mapping(meta_player.get("damage_to_player")),
                        "damage_from_player": _small_mapping(meta_player.get("damage_from_player")),
                        "camo_count": meta_player.get("camo_count"),
                        "overshield_count": meta_player.get("overshield_count"),
                    },
                },
            }
        )

    return participants


def _team_stats_from_participants(participants: list[dict[str, Any]]) -> list[dict[str, Any]]:
    teams: dict[int, dict[str, Any]] = {}

    for participant in participants:
        team_index = participant.get("team_index")
        if team_index is None:
            continue
        team = teams.setdefault(
            int(team_index),
            {
                "team_index": int(team_index),
                "team_name": _team_name(int(team_index)),
                "score": 0,
                "raw_stats": {"player_count": 0, "kills": 0, "deaths": 0},
            },
        )
        stats = participant.get("stats") or {}
        score = _optional_int(stats.get("score")) or 0
        team["score"] = int(team["score"] or 0) + score
        team["raw_stats"]["player_count"] += 1
        team["raw_stats"]["kills"] += _optional_int(stats.get("kills")) or 0
        team["raw_stats"]["deaths"] += _optional_int(stats.get("deaths")) or 0

    return [teams[team_index] for team_index in sorted(teams)]


def _finalize_replay_upload(
    *,
    upload_id: str,
    source_external_id: str,
    original_object: S3ReplayObject,
    processed_key: str,
    downloaded: DownloadedReplay,
    parsed: ParsedReplay,
) -> None:
    payload = {
        "upload_id": upload_id,
        "source_external_id": source_external_id,
        "game": {
            **parsed.game,
            "metadata": {
                **parsed.game["metadata"],
                "replay_summary": parsed.metadata["summary"],
            },
        },
        "replay_file": {
            "s3_bucket": original_object.bucket,
            "s3_key": processed_key,
            "file_role": "processed",
            "content_type": downloaded.content_type,
            "size_bytes": downloaded.size_bytes,
            "sha256": downloaded.sha256,
            "metadata": {
                "original_s3_key": original_object.key,
                "processed_s3_key": processed_key,
                "source_content_type": downloaded.content_type,
                "parser": parsed.metadata["parser"],
            },
        },
        "participants": parsed.participants,
        "team_stats": parsed.team_stats,
        "metadata": {
            **parsed.metadata,
            "original_s3_bucket": original_object.bucket,
            "original_s3_key": original_object.key,
            "processed_s3_bucket": original_object.bucket,
            "processed_s3_key": processed_key,
        },
    }
    _call_app_api("POST", _settings()["replay_finalization_path"], payload)


def _send_upload_status(
    upload_id: str,
    status: str,
    *,
    processing_error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "status": status,
        "metadata": {
            **(metadata or {}),
            "processor_runtime": {
                "name": "halospawns-replay-parser",
            },
        },
    }
    if processing_error:
        payload["processing_error"] = processing_error[:4096]
    _call_app_api(
        "PATCH",
        _settings()["processing_status_path_template"].format(upload_id=upload_id),
        payload,
    )


def _exception_details(error: BaseException) -> dict[str, str]:
    return {
        "type": type(error).__name__,
        "message": str(error),
        "traceback": "".join(
            traceback.format_exception(type(error), error, error.__traceback__)
        ),
    }


def _call_app_api(method: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    settings = _settings()
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    timestamp = str(int(time.time()))
    base_url = settings["app_api_base_url"].rstrip("/")
    url = f"{base_url}{path}"
    parsed_url = urllib.parse.urlsplit(url)
    signature = _hmac_signature(
        client=settings["trusted_client_name"],
        timestamp=timestamp,
        method=method,
        raw_path=parsed_url.path,
        raw_query_string=parsed_url.query,
        body=body,
        secret=_secret_value(settings["trusted_client_secret_id"]),
    )
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-Halospawns-Client": settings["trusted_client_name"],
            "X-Halospawns-Timestamp": timestamp,
            "X-Halospawns-Signature": f"sha256={signature}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_body = response.read()
            return json.loads(response_body.decode("utf-8")) if response_body else {}
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        raise ReplayProcessingError(
            f"App API returned HTTP {error.code} for {method} {path}: {error_body[:1000]}"
        ) from error
    except urllib.error.URLError as error:
        raise ReplayProcessingError(f"App API request failed for {method} {path}: {error}") from error


def _hmac_signature(
    *,
    client: str,
    timestamp: str,
    method: str,
    raw_path: str,
    raw_query_string: str,
    body: bytes,
    secret: str,
) -> str:
    canonical_request = "\n".join(
        (
            "HALOSPAWNS-HMAC-SHA256",
            client,
            timestamp,
            method.upper(),
            raw_path,
            raw_query_string,
            hashlib.sha256(body).hexdigest(),
        )
    )
    return hmac.new(
        secret.encode("utf-8"),
        canonical_request.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _copy_object(bucket: str, source_key: str, destination_key: str) -> None:
    if source_key == destination_key:
        return
    S3.copy_object(
        Bucket=bucket,
        Key=destination_key,
        CopySource={"Bucket": bucket, "Key": source_key},
        MetadataDirective="COPY",
    )


def _delete_object(bucket: str, key: str) -> None:
    S3.delete_object(Bucket=bucket, Key=key)


def _processed_key(source_key: str, *, unprocessed_prefix: str, processed_prefix: str) -> str:
    suffix = source_key[len(unprocessed_prefix) :] if source_key.startswith(unprocessed_prefix) else posixpath.basename(source_key)
    return f"{processed_prefix}{suffix.lstrip('/')}"


def _upload_id_from_key(key: str) -> str:
    match = UUID_PATTERN.search(key)
    if match is None:
        raise NonRetryableReplayError("Replay object key did not include an upload UUID")
    return match.group("upload_id").lower()


def _secret_value(secret_id: str) -> str:
    if secret_id not in SECRET_CACHE:
        response = SECRETS.get_secret_value(SecretId=secret_id)
        secret = response.get("SecretString")
        if not secret:
            raise ReplayProcessingError(f"Trusted client secret was empty: {secret_id}")
        SECRET_CACHE[secret_id] = secret
    return SECRET_CACHE[secret_id]


def _settings() -> dict[str, str]:
    return {
        "app_api_base_url": _required_env("APP_API_BASE_URL"),
        "trusted_client_name": _required_env("APP_API_TRUSTED_CLIENT_NAME"),
        "trusted_client_secret_id": _required_env("APP_API_TRUSTED_CLIENT_HMAC_SECRET_ID"),
        "processing_status_path_template": os.getenv(
            "APP_API_UPLOAD_PROCESSING_STATUS_PATH_TEMPLATE",
            "/v1/uploads/{upload_id}/processing-status",
        ),
        "replay_finalization_path": os.getenv(
            "APP_API_REPLAY_FINALIZATION_PATH",
            "/v1/ingest/replay-uploads",
        ),
        "unprocessed_prefix": _prefix_env("REPLAY_UNPROCESSED_PREFIX", "replays/unprocessed/"),
        "processed_prefix": _prefix_env("REPLAY_PROCESSED_PREFIX", "replays/processed/"),
        "failed_prefix": _prefix_env("REPLAY_FAILED_PREFIX", "replays/failed/"),
    }


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise ReplayProcessingError(f"Missing required environment variable: {name}")
    return value.strip()


def _prefix_env(name: str, default: str) -> str:
    value = (os.getenv(name) or default).strip().strip("/")
    return f"{value}/"


def _proxy_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if hasattr(value, "as_dict"):
        return value.as_dict()
    if isinstance(value, dict):
        return dict(value)
    return {}


def _jsonable(value: Any) -> Any:
    if hasattr(value, "as_dict"):
        return value.as_dict()
    if hasattr(value, "as_list"):
        return value.as_list()
    return value


def _small_mapping(value: Any, *, max_items: int = 64) -> dict[str, Any]:
    mapping = _proxy_dict(value)
    return dict(list(mapping.items())[:max_items])


def _player_index(player: dict[str, Any], *, fallback: int) -> int:
    value = _optional_int(player.get("player_index"))
    return value if value is not None else fallback


def _player_name(
    last_player: dict[str, Any],
    first_player: dict[str, Any],
    slot_index: int,
) -> str:
    return (
        _optional_text(last_player.get("name"))
        or _optional_text(last_player.get("player_name"))
        or _optional_text(first_player.get("name"))
        or _optional_text(first_player.get("player_name"))
        or f"Player {slot_index}"
    )


def _team_name(team_index: int | None) -> str | None:
    if team_index == 0:
        return "Red"
    if team_index == 1:
        return "Blue"
    if team_index is None:
        return None
    return f"Team {team_index}"


def _winning_team_index(team_stats: list[dict[str, Any]]) -> int | None:
    if not team_stats:
        return None
    ordered = sorted(
        (
            (team.get("team_index"), _optional_int(team.get("score")) or 0)
            for team in team_stats
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    if len(ordered) > 1 and ordered[0][1] == ordered[1][1]:
        return None
    return int(ordered[0][0]) if ordered[0][0] is not None else None


def _sum_numeric_values(value: Any) -> int:
    mapping = _proxy_dict(value)
    total = 0
    for item in mapping.values():
        number = _optional_float(item)
        if number is not None:
            total += int(number)
    return total


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _timestamp_string(value: Any) -> str | None:
    text = _optional_text(value)
    if text is None:
        return None

    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=UTC).isoformat().replace(
                "+00:00",
                "Z",
            )
        except ValueError:
            pass

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _duration_seconds(value: Any) -> int | None:
    text = _optional_text(value)
    if text is None:
        return None
    parts = text.split(":")
    try:
        if len(parts) == 3:
            hours, minutes, seconds = parts
            return int(timedelta(hours=int(hours), minutes=int(minutes), seconds=float(seconds)).total_seconds())
        if len(parts) == 2:
            minutes, seconds = parts
            return int(timedelta(minutes=int(minutes), seconds=float(seconds)).total_seconds())
    except ValueError:
        return None
    return None


def _map_short_name(map_engine_name: str | None) -> str | None:
    if not map_engine_name:
        return None
    return map_engine_name.replace("\\", "/").rstrip("/").split("/")[-1] or None


def _unlink_if_exists(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
