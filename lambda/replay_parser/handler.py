from __future__ import annotations

import gzip
import hashlib
import hmac
import json
import logging
import math
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
MAX_SPAWN_POINTS = 512
MAX_GAMETYPE_SETTINGS_ITEMS = 128
MAX_GAMETYPE_SETTINGS_ARRAY_ITEMS = 32
MAX_GAMETYPE_SETTINGS_DEPTH = 4
MAX_GAMETYPE_SETTINGS_STRING_LENGTH = 256
PROCESSOR_NAME = "halospawns-replay-parser"
REPLAY_REPROCESS_JOB_SCHEMA = "halospawns.replay_reprocess_job.v1"
COMPOSITE_JSON_EVENTS = {"start_map", "end_map", "start_array", "end_array", "map_key"}
KNOWN_GAMETYPE_MODES = {"ctf", "slayer", "oddball", "king", "race"}
SAFE_GAMETYPE_KEY_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
GAME_RELEASE_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_]*$")
UNKNOWN_PLACEHOLDER_PATTERN = re.compile(
    r"^(?:unknown|unknown\s*<[^>]+>|unknown\s+[-+]?(?:0x[0-9a-f]+|\d+))$",
    re.IGNORECASE,
)
LOCAL_PATH_PATTERN = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\|/(?:tmp|var|home|users|mnt)/)", re.IGNORECASE)
HOST_ADDRESS_PATTERN = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$")
HEX_DUMP_PATTERN = re.compile(r"^(?:0x)?[0-9a-f]{32,}$", re.IGNORECASE)
UNSAFE_GAMETYPE_KEY_FRAGMENTS = (
    "address",
    "addr",
    "bytes",
    "credential",
    "dump",
    "host",
    "password",
    "path",
    "presigned",
    "private",
    "raw",
    "secret",
    "signature",
    "token",
    "uri",
    "url",
)
OMIT = object()
TICK_FIELDS = {
    "multiplayer_map_name",
    "game_type",
    "variant",
    "current_time",
    "start_time",
    "game_id",
    "game_ended_this_tick",
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
class ReplayOutputFile:
    bucket: str
    key: str
    file_role: str
    content_type: str | None
    size_bytes: int | None
    sha256: str | None


@dataclass(frozen=True)
class ReplayReprocessJob:
    sqs_message_id: str
    job_id: str
    operation_id: str
    attempt_id: str
    mode: str
    upload_id: str
    replay_id: str
    source_object: S3ReplayObject
    current_replay_file: ReplayOutputFile


ReplayWorkItem = S3ReplayObject | ReplayReprocessJob


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
    spawn_points: list[dict[str, float]]
    spawn_source: dict[str, Any] | None
    metadata: dict[str, Any]
    game_meta: dict[str, Any] | None = None


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    failures: list[dict[str, str]] = []

    for work_item in _iter_replay_work_items(event):
        try:
            if isinstance(work_item, ReplayReprocessJob):
                _process_reprocess_job(work_item)
            else:
                _process_replay_object(work_item)
        except Exception:
            LOGGER.exception(
                "Replay processing failed for %s",
                _work_item_description(work_item),
            )
            failures.append({"itemIdentifier": work_item.sqs_message_id})

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


def _process_reprocess_job(job: ReplayReprocessJob) -> None:
    if job.mode != "full_reparse":
        raise NonRetryableReplayError(f"Unsupported replay reprocess mode: {job.mode}")

    work_stem = _safe_tmp_stem(job.attempt_id)
    source_object = job.source_object
    compressed_path = Path("/tmp") / f"{work_stem}-{posixpath.basename(source_object.key)}"
    json_path = Path("/tmp") / f"{work_stem}.json"

    try:
        downloaded = _download_replay(source_object, compressed_path)
        _decompress_replay(downloaded.path, json_path)
        parsed = _parse_replay(json_path)
        _finalize_replay_upload(
            upload_id=job.upload_id,
            source_external_id=job.upload_id,
            original_object=source_object,
            processed_key=job.current_replay_file.key,
            downloaded=downloaded,
            parsed=parsed,
            replay_file=job.current_replay_file,
            reprocess_attempt_id=job.attempt_id,
        )
        LOGGER.info(
            "Reprocessed replay upload %s from s3://%s/%s for attempt %s",
            job.upload_id,
            source_object.bucket,
            source_object.key,
            job.attempt_id,
        )
    finally:
        _unlink_if_exists(compressed_path)
        _unlink_if_exists(json_path)


def _iter_replay_work_items(event: dict[str, Any]) -> list[ReplayWorkItem]:
    work_items: list[ReplayWorkItem] = []

    for record in event.get("Records", []):
        sqs_message_id = str(record.get("messageId") or record.get("messageID") or "")
        payload = _record_payload(record)
        item_identifier = sqs_message_id or str(len(work_items))

        if payload.get("schema") == REPLAY_REPROCESS_JOB_SCHEMA:
            work_items.append(_reprocess_job_from_payload(payload, item_identifier))
            continue

        if "schema" in payload:
            raise NonRetryableReplayError(f"Unsupported replay job schema: {payload['schema']}")

        work_items.extend(_s3_replay_objects_from_payload(payload, item_identifier))

    return work_items


def _iter_s3_replay_objects(event: dict[str, Any]) -> list[S3ReplayObject]:
    return [
        work_item
        for work_item in _iter_replay_work_items(event)
        if isinstance(work_item, S3ReplayObject)
    ]


def _s3_replay_objects_from_payload(
    payload: dict[str, Any],
    sqs_message_id: str,
) -> list[S3ReplayObject]:
    replay_objects: list[S3ReplayObject] = []

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
                sqs_message_id=sqs_message_id,
            )
        )

    return replay_objects


def _reprocess_job_from_payload(
    payload: dict[str, Any],
    sqs_message_id: str,
) -> ReplayReprocessJob:
    mode = _required_payload_text(payload, "mode")
    if mode != "full_reparse":
        raise NonRetryableReplayError(f"Unsupported replay reprocess mode: {mode}")

    replay = _required_payload_mapping(payload, "replay")
    source_replay = _required_payload_mapping(payload, "source_replay")
    current_replay_file = _required_payload_mapping(payload, "current_replay_file")
    attempt_id = _required_payload_text(payload, "attempt_id")
    source_bucket = _required_payload_text(source_replay, "s3_bucket")
    source_key = _required_payload_text(source_replay, "s3_key")

    return ReplayReprocessJob(
        sqs_message_id=sqs_message_id,
        job_id=_required_payload_text(payload, "job_id"),
        operation_id=_required_payload_text(payload, "operation_id"),
        attempt_id=attempt_id,
        mode=mode,
        upload_id=_required_payload_text(replay, "upload_id"),
        replay_id=_required_payload_text(replay, "id"),
        source_object=S3ReplayObject(
            bucket=source_bucket,
            key=source_key,
            event_name=str(payload.get("trigger") or "manual_reprocess"),
            sqs_message_id=sqs_message_id,
        ),
        current_replay_file=ReplayOutputFile(
            bucket=_required_payload_text(current_replay_file, "s3_bucket"),
            key=_required_payload_text(current_replay_file, "s3_key"),
            file_role=_optional_payload_text(current_replay_file, "file_role") or "processed",
            content_type=_optional_payload_text(current_replay_file, "content_type"),
            size_bytes=_optional_payload_int(current_replay_file, "size_bytes"),
            sha256=_optional_payload_text(current_replay_file, "sha256"),
        ),
    )


def _required_payload_mapping(payload: dict[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise NonRetryableReplayError(f"Replay reprocess job missing object field: {key}")
    return value


def _required_payload_text(payload: dict[str, Any], key: str) -> str:
    value = _optional_payload_text(payload, key)
    if value is None:
        raise NonRetryableReplayError(f"Replay reprocess job missing text field: {key}")
    return value


def _optional_payload_text(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_payload_int(payload: dict[str, Any], key: str) -> int | None:
    value = payload.get(key)
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise NonRetryableReplayError(f"Replay reprocess job field must be an integer: {key}") from error


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
    callback_game_meta = replay_document["callback_game_meta"]
    if not game_meta_players and callback_game_meta is not None:
        game_meta_players = _proxy_dict(_proxy_dict(callback_game_meta).get("players"))
    first_tick = replay_document["first_tick"]
    last_tick = replay_document["last_tick"]
    gametype_settings = replay_document["gametype_settings"]
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
        gametype_settings=gametype_settings,
    )
    metadata = {
        "summary": summary,
        "tick_count": tick_count,
        "event_count": replay_document["event_count"],
        "event_sample": replay_document["event_sample"],
        "parser": {
            "name": PROCESSOR_NAME,
            "json_library": "ijson",
            "ijson_backend": getattr(ijson.backend, "__name__", str(ijson.backend)),
        },
    }
    spawn_points = replay_document["spawn_points"]
    spawn_source = None
    if spawn_points:
        spawn_source = {
            "path": replay_document["spawn_source_path"],
            "extractor": PROCESSOR_NAME,
        }

    return ParsedReplay(
        game=game,
        participants=participants,
        team_stats=team_stats,
        spawn_points=spawn_points,
        spawn_source=spawn_source,
        metadata=metadata,
        game_meta=callback_game_meta,
    )


def _extract_replay_document(json_path: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    game_meta_players: dict[str, Any] = {}
    first_tick: dict[str, Any] | None = None
    last_tick: dict[str, Any] | None = None
    current_tick: dict[str, Any] | None = None
    current_player: dict[str, Any] | None = None
    gametype_settings: dict[str, Any] = {}
    callback_game_meta: dict[str, Any] | None = None
    spawn_points: list[dict[str, float]] = []
    spawn_source_path: str | None = None
    tick_count = 0
    event_count = 0
    event_sample: list[Any] = []

    active_builder: ijson.ObjectBuilder | None = None
    active_target: str | None = None
    active_end_event: str | None = None
    active_context: tuple[Any, ...] | None = None

    with json_path.open("rb") as replay_file:
        for prefix, event, value in ijson.parse(replay_file, use_float=True):
            if active_builder is not None:
                active_builder.event(event, value)
                if prefix == active_target and event == active_end_event:
                    built_value = active_builder.value
                    if active_target == "summary":
                        summary = _proxy_dict(built_value)
                    elif active_context and active_context[0] == "gametype_settings":
                        gametype_settings = _sanitize_gametype_settings(built_value)
                    elif active_context and active_context[0] == "callback_game_meta":
                        callback_game_meta = _callback_game_meta(built_value)
                    elif active_context and active_context[0] == "meta_player_field":
                        _, player_id, field = active_context
                        game_meta_players.setdefault(player_id, {})[field] = built_value
                    elif active_context and active_context[0] == "spawn_records":
                        _, source_path = active_context
                        extracted_points = _spawn_points_from_records(built_value)
                        if extracted_points and not spawn_points:
                            spawn_points = extracted_points
                            spawn_source_path = source_path
                    elif active_context and active_context[0] == "tick_map_info":
                        if current_tick is not None:
                            current_tick["map_info"] = _proxy_dict(built_value)
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
                (
                    active_builder,
                    active_target,
                    active_end_event,
                    active_context,
                ) = _start_json_builder(
                    prefix,
                    event,
                    value,
                )
                continue

            if prefix == "game_meta" and event == "start_map":
                (
                    active_builder,
                    active_target,
                    active_end_event,
                    active_context,
                ) = _start_json_builder(
                    prefix,
                    event,
                    value,
                    context=("callback_game_meta",),
                )
                continue

            if prefix == "gametype_settings" and event == "start_map":
                (
                    active_builder,
                    active_target,
                    active_end_event,
                    active_context,
                ) = _start_json_builder(
                    prefix,
                    event,
                    value,
                    context=("gametype_settings",),
                )
                continue

            if not spawn_points and prefix == "spawns" and event == "start_array":
                (
                    active_builder,
                    active_target,
                    active_end_event,
                    active_context,
                ) = _start_json_builder(
                    prefix,
                    event,
                    value,
                    context=("spawn_records", "$.spawns"),
                )
                continue

            meta_player_field = _meta_player_field(prefix)
            if meta_player_field is not None:
                player_id, field = meta_player_field
                if field in META_PLAYER_SCALAR_FIELDS and _is_scalar_json_event(event):
                    game_meta_players.setdefault(player_id, {})[field] = value
                elif field in META_PLAYER_MAPPING_FIELDS and event in ("start_map", "start_array"):
                    (
                        active_builder,
                        active_target,
                        active_end_event,
                        active_context,
                    ) = _start_json_builder(
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

                if not spawn_points and prefix == "ticks.item.spawns" and event == "start_array":
                    (
                        active_builder,
                        active_target,
                        active_end_event,
                        active_context,
                    ) = _start_json_builder(
                        prefix,
                        event,
                        value,
                        context=("spawn_records", f"$.ticks[{tick_count}].spawns"),
                    )
                    continue

                if prefix == "ticks.item.map_info" and event == "start_map":
                    (
                        active_builder,
                        active_target,
                        active_end_event,
                        active_context,
                    ) = _start_json_builder(
                        prefix,
                        event,
                        value,
                        context=("tick_map_info",),
                    )
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
                    (
                        active_builder,
                        active_target,
                        active_end_event,
                        active_context,
                    ) = _start_json_builder(
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
        "callback_game_meta": callback_game_meta,
        "gametype_settings": gametype_settings,
        "first_tick": first_tick or {},
        "last_tick": last_tick or {},
        "spawn_points": spawn_points,
        "spawn_source_path": spawn_source_path,
        "tick_count": tick_count,
        "event_count": event_count,
        "event_sample": event_sample,
    }


def _start_json_builder(
    prefix: str,
    event: str,
    value: Any,
    *,
    context: tuple[Any, ...] | None = None,
) -> tuple[ijson.ObjectBuilder, str, str, tuple[Any, ...] | None]:
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


def _spawn_points_from_records(records: Any) -> list[dict[str, float]]:
    if not isinstance(records, list):
        return []

    points: list[dict[str, float]] = []
    skipped = 0
    for record in records:
        point = _spawn_point_from_record(record)
        if point is None:
            skipped += 1
            continue
        points.append(point)
        if len(points) >= MAX_SPAWN_POINTS:
            break

    if skipped:
        LOGGER.info("Skipped %s spawn record(s) without finite x/y/z coordinates", skipped)
    if len(records) > MAX_SPAWN_POINTS:
        LOGGER.info("Truncated spawn records from %s to %s", len(records), MAX_SPAWN_POINTS)
    return points


def _spawn_point_from_record(record: Any) -> dict[str, float] | None:
    try:
        if isinstance(record, dict):
            if all(axis in record for axis in ("x", "y", "z")):
                return _finite_spawn_point(record["x"], record["y"], record["z"])
            for key in ("position", "translation", "origin", "location"):
                nested = record.get(key)
                if isinstance(nested, dict) and all(axis in nested for axis in ("x", "y", "z")):
                    return _finite_spawn_point(nested["x"], nested["y"], nested["z"])
                if isinstance(nested, (list, tuple)) and len(nested) >= 3:
                    return _finite_spawn_point(nested[0], nested[1], nested[2])
        if isinstance(record, (list, tuple)) and len(record) >= 3:
            return _finite_spawn_point(record[0], record[1], record[2])
    except (TypeError, ValueError):
        return None
    return None


def _finite_spawn_point(x: Any, y: Any, z: Any) -> dict[str, float] | None:
    point = {
        "x": float(x),
        "y": float(y),
        "z": float(z),
    }
    if not all(math.isfinite(component) for component in point.values()):
        return None
    return point


def _game_from_replay(
    *,
    summary: dict[str, Any],
    first_tick: Any,
    last_tick: Any,
    team_stats: list[dict[str, Any]],
    gametype_settings: dict[str, Any],
) -> dict[str, Any]:
    map_engine_name = _optional_text(
        last_tick.get("multiplayer_map_name") or first_tick.get("multiplayer_map_name")
    )
    game_type = _known_gametype_mode(gametype_settings.get("mode")) or _authoritative_text(
        last_tick.get("game_type") or first_tick.get("game_type")
    )
    variant = _jsonable(last_tick.get("variant") or first_tick.get("variant"))
    variant_name = _authoritative_text(gametype_settings.get("name")) or (
        _authoritative_text(variant) if isinstance(variant, str) else None
    )
    started_at = _timestamp_string(
        summary.get("recording_started") or first_tick.get("start_time")
    )
    ended_at = _timestamp_string(summary.get("recording_ended") or last_tick.get("current_time"))
    duration_seconds = _duration_seconds(summary.get("game_duration_ingame"))
    winning_team_index = _winning_team_index(team_stats)
    map_info = _map_info_from_ticks(first_tick, last_tick)
    game_release_key = _game_release_key(map_info.get("game_release_key"))
    cache_family = _authoritative_text(map_info.get("cache_family"))
    cache_version = _optional_int(map_info.get("cache_version"))
    cache_version_name = _authoritative_text(map_info.get("cache_version_name"))
    build_version = _authoritative_text(map_info.get("build_version"))
    is_completed = (
        summary.get("is_full_game") is not False
        or last_tick.get("game_ended_this_tick") is True
    )

    game = {
        "map_engine_name": map_engine_name,
        "game_type": game_type,
        "variant_name": variant_name,
        "status": "completed" if is_completed else "imported",
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
            "game_ended_this_tick": last_tick.get("game_ended_this_tick"),
        },
    }
    if gametype_settings:
        game["metadata"]["gametype_settings"] = gametype_settings
    if game_release_key is not None:
        game["game_release_key"] = game_release_key
    if cache_family is not None:
        game["cache_family"] = cache_family
    if cache_version is not None:
        game["cache_version"] = cache_version
    if cache_version_name is not None:
        game["cache_version_name"] = cache_version_name
    if build_version is not None:
        game["build_version"] = build_version
    return game


def _map_info_from_ticks(first_tick: Any, last_tick: Any) -> dict[str, Any]:
    for tick in (last_tick, first_tick):
        map_info = _proxy_dict(_proxy_dict(tick).get("map_info"))
        if map_info:
            return map_info
    return {}


def _participants_from_replay(
    first_players: list[dict[str, Any]],
    last_players: list[dict[str, Any]],
    meta_players: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    first_by_index = {
        _player_index(player, fallback=index): player
        for index, player in enumerate(first_players)
    }
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
    replay_file: ReplayOutputFile | None = None,
    reprocess_attempt_id: str | None = None,
) -> None:
    output_file = replay_file or ReplayOutputFile(
        bucket=original_object.bucket,
        key=processed_key,
        file_role="processed",
        content_type=downloaded.content_type,
        size_bytes=downloaded.size_bytes,
        sha256=downloaded.sha256,
    )
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
            "s3_bucket": output_file.bucket,
            "s3_key": output_file.key,
            "file_role": output_file.file_role,
            "content_type": output_file.content_type,
            "size_bytes": output_file.size_bytes,
            "sha256": output_file.sha256,
            "metadata": {
                "original_s3_key": original_object.key,
                "processed_s3_key": output_file.key,
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
            "processed_s3_bucket": output_file.bucket,
            "processed_s3_key": output_file.key,
        },
    }
    if reprocess_attempt_id is not None:
        payload["reprocess_attempt_id"] = reprocess_attempt_id
    if parsed.spawn_points:
        payload["spawn_points"] = parsed.spawn_points
        payload["spawn_source"] = parsed.spawn_source or {"extractor": PROCESSOR_NAME}
    if parsed.game_meta is not None:
        payload["game_meta"] = parsed.game_meta
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
                "name": PROCESSOR_NAME,
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
        raise ReplayProcessingError(
            f"App API request failed for {method} {path}: {error}"
        ) from error


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
    suffix = (
        source_key[len(unprocessed_prefix) :]
        if source_key.startswith(unprocessed_prefix)
        else posixpath.basename(source_key)
    )
    return f"{processed_prefix}{suffix.lstrip('/')}"


def _safe_tmp_stem(value: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._-")
    return stem[:120] or "replay"


def _work_item_description(work_item: ReplayWorkItem) -> str:
    if isinstance(work_item, ReplayReprocessJob):
        return (
            f"reprocess job {work_item.job_id} from "
            f"s3://{work_item.source_object.bucket}/{work_item.source_object.key}"
        )
    return f"s3://{work_item.bucket}/{work_item.key}"


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


def _callback_game_meta(value: Any) -> dict[str, Any] | None:
    jsonable = _json_compatible_value(value)
    return jsonable if isinstance(jsonable, dict) else None


def _json_compatible_value(value: Any) -> Any:
    jsonable = _jsonable(value)
    if jsonable is None:
        return None
    if isinstance(jsonable, bool):
        return jsonable
    if isinstance(jsonable, int):
        return jsonable
    if isinstance(jsonable, float):
        return jsonable if math.isfinite(jsonable) else OMIT
    if isinstance(jsonable, str):
        return jsonable
    if isinstance(jsonable, dict):
        sanitized: dict[str, Any] = {}
        for raw_key, raw_value in jsonable.items():
            sanitized_value = _json_compatible_value(raw_value)
            if sanitized_value is not OMIT:
                sanitized[str(raw_key)] = sanitized_value
        return sanitized
    if isinstance(jsonable, list):
        return [
            sanitized_item
            for item in jsonable
            if (sanitized_item := _json_compatible_value(item)) is not OMIT
        ]
    return OMIT


def _sanitize_gametype_settings(value: Any) -> dict[str, Any]:
    sanitized = _sanitize_gametype_mapping(value, depth=0)
    return sanitized if isinstance(sanitized, dict) else {}


def _sanitize_gametype_mapping(value: Any, *, depth: int) -> Any:
    if depth >= MAX_GAMETYPE_SETTINGS_DEPTH:
        return OMIT

    mapping = _proxy_dict(value)
    if not mapping:
        return OMIT

    sanitized: dict[str, Any] = {}
    for raw_key, raw_value in mapping.items():
        key = _safe_gametype_key(raw_key)
        if key is None:
            continue
        sanitized_value = _sanitize_gametype_value(raw_value, depth=depth + 1)
        if sanitized_value is OMIT:
            continue
        sanitized[key] = sanitized_value
        if len(sanitized) >= MAX_GAMETYPE_SETTINGS_ITEMS:
            LOGGER.info("Truncated gametype_settings metadata to %s items", len(sanitized))
            break
    return sanitized or OMIT


def _sanitize_gametype_sequence(value: Any, *, depth: int) -> Any:
    if depth >= MAX_GAMETYPE_SETTINGS_DEPTH or not isinstance(value, list):
        return OMIT

    sanitized: list[Any] = []
    for raw_item in value[:MAX_GAMETYPE_SETTINGS_ARRAY_ITEMS]:
        sanitized_value = _sanitize_gametype_value(raw_item, depth=depth + 1)
        if sanitized_value is not OMIT:
            sanitized.append(sanitized_value)
    if len(value) > MAX_GAMETYPE_SETTINGS_ARRAY_ITEMS:
        LOGGER.info(
            "Truncated gametype_settings array from %s to %s items",
            len(value),
            MAX_GAMETYPE_SETTINGS_ARRAY_ITEMS,
        )
    return sanitized if sanitized else OMIT


def _sanitize_gametype_value(value: Any, *, depth: int) -> Any:
    jsonable = _jsonable(value)
    if jsonable is None:
        return OMIT
    if isinstance(jsonable, bool):
        return jsonable
    if isinstance(jsonable, int):
        return jsonable
    if isinstance(jsonable, float):
        return jsonable if math.isfinite(jsonable) else OMIT
    if isinstance(jsonable, str):
        text = _safe_gametype_text(jsonable)
        return text if text is not None else OMIT
    if isinstance(jsonable, dict) or hasattr(jsonable, "as_dict"):
        return _sanitize_gametype_mapping(jsonable, depth=depth)
    if isinstance(jsonable, list):
        return _sanitize_gametype_sequence(jsonable, depth=depth)
    return OMIT


def _safe_gametype_key(value: Any) -> str | None:
    key = _optional_text(value)
    if key is None or SAFE_GAMETYPE_KEY_PATTERN.fullmatch(key) is None:
        return None

    normalized = key.lower()
    if any(fragment in normalized for fragment in UNSAFE_GAMETYPE_KEY_FRAGMENTS):
        return None
    return key


def _safe_gametype_text(value: Any) -> str | None:
    text = _optional_text(value)
    if text is None:
        return None
    if len(text) > MAX_GAMETYPE_SETTINGS_STRING_LENGTH:
        text = text[:MAX_GAMETYPE_SETTINGS_STRING_LENGTH]
    if _looks_like_unsafe_metadata_text(text):
        return None
    return text


def _game_release_key(value: Any) -> str | None:
    text = _optional_text(value)
    if text is None:
        return None
    return text if GAME_RELEASE_KEY_PATTERN.fullmatch(text) else None


def _known_gametype_mode(value: Any) -> str | None:
    mode = _optional_text(value)
    if mode is None:
        return None
    normalized = mode.lower()
    return normalized if normalized in KNOWN_GAMETYPE_MODES else None


def _authoritative_text(value: Any) -> str | None:
    text = _safe_gametype_text(value)
    if text is None or _is_unknown_placeholder(text):
        return None
    return text


def _is_unknown_placeholder(value: Any) -> bool:
    text = _optional_text(value)
    return bool(text and UNKNOWN_PLACEHOLDER_PATTERN.fullmatch(text))


def _looks_like_unsafe_metadata_text(value: str) -> bool:
    text = value.strip()
    lower = text.lower()
    return (
        "http://" in lower
        or "https://" in lower
        or "x-amz-" in lower
        or LOCAL_PATH_PATTERN.search(text) is not None
        or HOST_ADDRESS_PATTERN.fullmatch(text) is not None
        or HEX_DUMP_PATTERN.fullmatch(text) is not None
    )


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
            return int(
                timedelta(
                    hours=int(hours),
                    minutes=int(minutes),
                    seconds=float(seconds),
                ).total_seconds()
            )
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
