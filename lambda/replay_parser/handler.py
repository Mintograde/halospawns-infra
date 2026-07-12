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
import subprocess
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import boto3
import ijson
import zstandard
from botocore.exceptions import ClientError

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
FACT_SCHEMA_VERSION = "halospawns.replayFacts.v1"
GRAPH_CONTEXT_SCHEMA_VERSION = "halospawns.graphContext.v1"
SPATIAL_FACTS_SCHEMA_VERSION = "halospawns.spatialFacts.v1"
SPATIAL_COORDINATE_SPACE = "halo1.replay_world.v1"
NATIVE_EXTRACTOR_SCHEMA_VERSION = "halospawns.replayExtractor.v1"
GAME_TICKS_PER_SECOND = 30
MAX_GRAPH_CONTEXT_PLAYERS = 16
MAX_SPATIAL_PLAYER_SLOTS = 64
MAX_SPATIAL_COORDINATE_ABS = 1_000_000.0
MAX_SPATIAL_CELLS_PER_SLOT = 50_000
MAX_SPATIAL_CELLS_TOTAL = 200_000
MAX_SPATIAL_ARTIFACT_BYTES = 10 * 1024 * 1024
MAX_SPATIAL_ARTIFACT_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
MAX_NATIVE_EXTRACTOR_OUTPUT_BYTES = 64 * 1024 * 1024
MAX_SPATIAL_COUNTER = 2_147_483_647
SUPPORTED_SPATIAL_CELL_SIZES = frozenset({0.5, 1.0})
NONRETRYABLE_S3_DOWNLOAD_ERROR_CODES = {"NoSuchBucket", "NoSuchKey", "NotFound", "404"}
COMPOSITE_JSON_EVENTS = {"start_map", "end_map", "start_array", "end_array", "map_key"}
KNOWN_GAMETYPE_MODES = {"ctf", "slayer", "oddball", "king", "race"}
SAFE_GAMETYPE_KEY_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
SAFE_FACT_KEY_PART_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
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
    "streak_by_tick",
    "streak_counts_by_amount",
    "multikills_by_tick",
    "multikill_counts_by_amount",
}
SCREEN_SLOTS_BY_PLAYER_COUNT = {
    1: ("full",),
    2: ("top", "bottom"),
    3: ("top", "bottom-left", "bottom-right"),
    4: ("top-left", "top-right", "bottom-left", "bottom-right"),
}
SCREEN_LAYOUT_BY_PLAYER_COUNT = {
    1: "single",
    2: "vertical_2",
    3: "three_player",
    4: "quad",
}
VALID_SCREEN_SLOTS = frozenset(
    slot
    for slots in SCREEN_SLOTS_BY_PLAYER_COUNT.values()
    for slot in slots
)
GAMETYPE_BOOL_FACT_KEYS = {
    "gametype.teamplay",
    "gametype.teams_enabled",
}
GAMETYPE_INT_FACT_KEYS = {
    "gametype.score_limit",
    "gametype.time_limit",
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
class SpatialFacts:
    cell_size: float
    cells: dict[tuple[int, int, int, int], int]
    coverage: dict[str, Any]
    runtime_metrics: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class ParsedReplay:
    game: dict[str, Any]
    participants: list[dict[str, Any]]
    team_stats: list[dict[str, Any]]
    spawn_points: list[dict[str, float]]
    spawn_source: dict[str, Any] | None
    metadata: dict[str, Any]
    game_meta: dict[str, Any] | None = None
    facts: dict[str, Any] | None = None
    spatial_facts: SpatialFacts | None = None


class SpatialOccupancyAccumulator:
    def __init__(
        self,
        cell_size: float,
        *,
        parser_metadata: dict[str, str] | None = None,
    ) -> None:
        if cell_size not in SUPPORTED_SPATIAL_CELL_SIZES:
            raise ReplayProcessingError(
                f"Spatial cell size must be one of {sorted(SUPPORTED_SPATIAL_CELL_SIZES)}"
            )
        self.cell_size = cell_size
        self.cells: dict[tuple[int, int, int, int], int] = {}
        self.cell_counts_by_slot: Counter[int] = Counter()
        self.observations_by_slot: Counter[int] = Counter()
        self.discarded: Counter[str] = Counter()
        self.samples_seen = 0
        self.parser_metadata = parser_metadata or {"json_library": "ijson"}

    def observe(
        self,
        player: dict[str, Any],
        *,
        position_object_seen: bool,
        position: dict[str, Any],
    ) -> None:
        self.samples_seen = _bounded_add(self.samples_seen, 1)
        slot_index = _spatial_slot_index(player.get("player_index"))
        if slot_index is None:
            self._discard("invalid_slot")
            return
        if _optional_bool(player.get("is_hostman")) is True:
            self._discard("hostman")
            return
        if not position_object_seen:
            self._discard("missing_player_object")
            return
        if any(axis not in position for axis in ("x", "y", "z")):
            self._discard("missing_coordinate")
            return

        coordinates: list[float] = []
        for axis in ("x", "y", "z"):
            coordinate = _spatial_coordinate(position[axis])
            if coordinate is None:
                self._discard("non_finite")
                return
            if abs(coordinate) > MAX_SPATIAL_COORDINATE_ABS:
                self._discard("out_of_bounds")
                return
            coordinates.append(coordinate)

        key = (
            slot_index,
            math.floor(coordinates[0] / self.cell_size),
            math.floor(coordinates[1] / self.cell_size),
            math.floor(coordinates[2] / self.cell_size),
        )
        if key not in self.cells:
            if self.cell_counts_by_slot[slot_index] >= MAX_SPATIAL_CELLS_PER_SLOT:
                self._discard("slot_cell_limit")
                return
            if len(self.cells) >= MAX_SPATIAL_CELLS_TOTAL:
                self._discard("global_cell_limit")
                return
            self.cell_counts_by_slot[slot_index] += 1
            self.cells[key] = 0

        self.cells[key] = _bounded_add(self.cells[key], 1)
        self.observations_by_slot[slot_index] = _bounded_add(
            self.observations_by_slot[slot_index], 1
        )

    def exclude_slots(self, slot_indexes: set[int]) -> None:
        for key in [key for key in self.cells if key[0] in slot_indexes]:
            del self.cells[key]
        for slot_index in slot_indexes:
            excluded_observations = self.observations_by_slot.pop(slot_index, 0)
            if excluded_observations:
                self._discard("hostman", excluded_observations)
            self.cell_counts_by_slot.pop(slot_index, None)

    def spatial_facts(
        self,
        *,
        summary: dict[str, Any],
        tick_count: int,
        parse_duration_ms: int,
    ) -> SpatialFacts:
        observations = sum(self.observations_by_slot.values())
        discarded_by_reason = {
            reason: count for reason, count in sorted(self.discarded.items()) if count > 0
        }
        coverage: dict[str, Any] = {
            "status": "available" if observations else "unavailable",
            "ticks_observed": tick_count,
            "position_samples_seen": self.samples_seen,
            "position_observations": observations,
            "position_samples_discarded": sum(discarded_by_reason.values()),
            "discarded_by_reason": discarded_by_reason,
            "participant_slots_observed": sorted(self.observations_by_slot),
            "distinct_cells": len(self.cells),
            "parser": {
                "name": PROCESSOR_NAME,
                **self.parser_metadata,
            },
            "limits": {
                "coordinate_absolute_max": MAX_SPATIAL_COORDINATE_ABS,
                "cells_per_slot": MAX_SPATIAL_CELLS_PER_SLOT,
                "cells_total": MAX_SPATIAL_CELLS_TOTAL,
            },
        }
        for key in ("ticks_elapsed", "ticks_recorded", "ticks_dropped"):
            value = _nonnegative_int(summary.get(key))
            if value is not None:
                coverage[key] = value
        runtime_metrics = {"parse_duration_ms": parse_duration_ms}
        peak_rss_kib = _process_peak_rss_kib()
        if peak_rss_kib is not None:
            runtime_metrics["process_peak_rss_kib"] = peak_rss_kib
        return SpatialFacts(
            cell_size=self.cell_size,
            cells=self.cells,
            coverage=coverage,
            runtime_metrics=runtime_metrics,
        )

    def _discard(self, reason: str, count: int = 1) -> None:
        self.discarded[reason] = _bounded_add(self.discarded[reason], count)


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
        parsed = _parse_downloaded_replay(downloaded.path, json_path)
        processed_key = _processed_key(
            replay_object.key,
            unprocessed_prefix=settings["unprocessed_prefix"],
            processed_prefix=settings["processed_prefix"],
        )
        _copy_object(replay_object.bucket, replay_object.key, processed_key)
        spatial_artifact = _write_spatial_artifact(
            parsed=parsed,
            bucket=replay_object.bucket,
            upload_id=upload_id,
            generation=1,
            source_replay_sha256=downloaded.sha256,
        )

        try:
            _finalize_replay_upload(
                upload_id=upload_id,
                source_external_id=upload_id,
                original_object=replay_object,
                processed_key=processed_key,
                downloaded=downloaded,
                parsed=parsed,
                spatial_artifact=spatial_artifact,
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
        try:
            downloaded = _download_replay(source_object, compressed_path)
            parsed = _parse_downloaded_replay(downloaded.path, json_path)
        except ClientError as error:
            if not _is_nonretryable_s3_download_error(error):
                raise
            LOGGER.warning(
                "Replay reprocess attempt %s source object is unavailable: %s",
                job.attempt_id,
                error,
                exc_info=True,
            )
            _send_reprocess_attempt_status(job, "failed", error)
            return
        except NonRetryableReplayError as error:
            LOGGER.warning(
                "Replay reprocess attempt %s is not processable: %s",
                job.attempt_id,
                error,
                exc_info=True,
            )
            _send_reprocess_attempt_status(job, "failed", error)
            return

        spatial_artifact = _write_spatial_artifact(
            parsed=parsed,
            bucket=job.current_replay_file.bucket,
            upload_id=job.upload_id,
            generation=_reprocess_spatial_generation(job.attempt_id),
            source_replay_sha256=job.current_replay_file.sha256 or downloaded.sha256,
        )
        _finalize_replay_upload(
            upload_id=job.upload_id,
            source_external_id=job.upload_id,
            original_object=source_object,
            processed_key=job.current_replay_file.key,
            downloaded=downloaded,
            parsed=parsed,
            replay_file=job.current_replay_file,
            reprocess_attempt_id=job.attempt_id,
            spatial_artifact=spatial_artifact,
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


def _parse_downloaded_replay(source_path: Path, json_path: Path) -> ParsedReplay:
    mode = _native_extractor_mode()
    binary_path = _native_extractor_path()
    native_available = binary_path.is_file()
    if mode != "python" and native_available:
        try:
            return _parse_replay_native(source_path, binary_path=binary_path)
        except Exception as error:
            if mode == "native":
                raise
            LOGGER.warning(
                "Native replay extraction failed; using ijson fallback: %s",
                error,
                exc_info=True,
            )
    elif mode == "native":
        raise ReplayProcessingError(f"Native replay extractor was not found: {binary_path}")

    _decompress_replay(source_path, json_path)
    return _parse_replay(json_path)


def _parse_replay_native(
    source_path: Path,
    *,
    binary_path: Path | None = None,
) -> ParsedReplay:
    parse_started = time.perf_counter()
    extractor_path = binary_path or _native_extractor_path()
    output_path = source_path.with_name(f"{source_path.name}.extractor.json")
    try:
        result = subprocess.run(
            [
                str(extractor_path),
                "--input",
                str(source_path),
                "--output",
                str(output_path),
                "--cell-size",
                str(_spatial_cell_size()),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            diagnostic = (result.stderr or result.stdout or "unknown error").strip()[:2000]
            raise ReplayProcessingError(
                f"Native replay extractor exited with {result.returncode}: {diagnostic}"
            )
        try:
            output_size = output_path.stat().st_size
        except OSError as error:
            raise ReplayProcessingError("Native replay extractor did not write output") from error
        if not 0 < output_size <= MAX_NATIVE_EXTRACTOR_OUTPUT_BYTES:
            raise ReplayProcessingError(
                f"Native replay extractor output size is invalid: {output_size}"
            )
        with output_path.open("r", encoding="utf-8") as output_file:
            native_document = json.load(output_file)
        replay_document = _replay_document_from_native(native_document)
    except (OSError, json.JSONDecodeError) as error:
        raise ReplayProcessingError(f"Native replay extraction failed: {error}") from error
    finally:
        _unlink_if_exists(output_path)

    return _parsed_replay_from_document(replay_document, parse_started=parse_started)


def _replay_document_from_native(value: Any) -> dict[str, Any]:
    document = _proxy_dict(value)
    if document.get("schema") != NATIVE_EXTRACTOR_SCHEMA_VERSION:
        raise ReplayProcessingError("Native replay extractor returned an unsupported schema")

    raw_game_meta = document.get("game_meta")
    callback_game_meta = _callback_game_meta(raw_game_meta)
    parser = _proxy_dict(document.get("parser"))
    extractor_name = _optional_text(parser.get("name")) or "replay-extractor"
    extractor_version = _optional_text(parser.get("version"))
    parser_metadata = {
        "name": PROCESSOR_NAME,
        "json_library": _optional_text(parser.get("json_library")) or "serde_json",
        "native_extractor": extractor_name,
    }
    if extractor_version is not None:
        parser_metadata["native_extractor_version"] = extractor_version

    return {
        "summary": _native_json_mapping(document.get("summary")),
        "game_meta_players": _game_meta_players_from_native(raw_game_meta),
        "callback_game_meta": callback_game_meta,
        "gametype_settings": _sanitize_gametype_settings(document.get("gametype_settings")),
        "network_game_client": _native_json_mapping(document.get("network_game_client")),
        "participant_context": _native_json_mapping(document.get("participant_context")),
        "first_tick": _native_json_mapping(document.get("first_tick")),
        "last_tick": _native_json_mapping(document.get("last_tick")),
        "spawn_points": _spawn_points_from_records(document.get("spawn_points")),
        "spawn_source_path": _optional_text(document.get("spawn_source_path")),
        "tick_count": _native_nonnegative_int(document.get("tick_count"), "tick_count"),
        "event_count": _native_nonnegative_int(document.get("event_count"), "event_count"),
        "event_sample": _native_json_list(document.get("event_sample")),
        "spatial_occupancy": _spatial_occupancy_from_native(
            document.get("spatial_occupancy"),
            parser_metadata={
                "json_library": parser_metadata["json_library"],
                "native_extractor": extractor_name,
                **(
                    {"native_extractor_version": extractor_version}
                    if extractor_version is not None
                    else {}
                ),
            },
        ),
        "parser": parser_metadata,
    }


def _native_json_mapping(value: Any) -> dict[str, Any]:
    jsonable = _json_compatible_value(value)
    return jsonable if isinstance(jsonable, dict) else {}


def _native_json_list(value: Any) -> list[Any]:
    jsonable = _json_compatible_value(value)
    return jsonable if isinstance(jsonable, list) else []


def _game_meta_players_from_native(value: Any) -> dict[str, Any]:
    players = _proxy_dict(_proxy_dict(value).get("players"))
    selected: dict[str, Any] = {}
    for raw_player_id, raw_player in players.items():
        player = _proxy_dict(raw_player)
        fields: dict[str, Any] = {}
        for field in META_PLAYER_SCALAR_FIELDS:
            field_value = player.get(field)
            if field in player and not isinstance(field_value, (dict, list)):
                fields[field] = field_value
        for field in META_PLAYER_MAPPING_FIELDS:
            field_value = player.get(field)
            if isinstance(field_value, (dict, list)):
                fields[field] = field_value
        if fields:
            selected[str(raw_player_id)] = fields
    return selected


def _spatial_occupancy_from_native(
    value: Any,
    *,
    parser_metadata: dict[str, str],
) -> SpatialOccupancyAccumulator:
    document = _proxy_dict(value)
    cell_size = _native_number(document.get("cell_size"), "spatial_occupancy.cell_size")
    if cell_size != _spatial_cell_size():
        raise ReplayProcessingError("Native replay extractor used an unexpected cell size")

    limits = _proxy_dict(document.get("limits"))
    expected_limits = {
        "coordinate_absolute_max": MAX_SPATIAL_COORDINATE_ABS,
        "cells_per_slot": MAX_SPATIAL_CELLS_PER_SLOT,
        "cells_total": MAX_SPATIAL_CELLS_TOTAL,
        "counter": MAX_SPATIAL_COUNTER,
    }
    for key, expected in expected_limits.items():
        if _native_number(limits.get(key), f"spatial_occupancy.limits.{key}") != expected:
            raise ReplayProcessingError(f"Native replay extractor limit mismatch: {key}")

    occupancy = SpatialOccupancyAccumulator(
        cell_size,
        parser_metadata=parser_metadata,
    )
    occupancy.samples_seen = _native_bounded_counter(
        document.get("samples_seen"),
        "spatial_occupancy.samples_seen",
    )
    for raw_slot, raw_count in _proxy_dict(document.get("observations_by_slot")).items():
        slot_index = _spatial_slot_index(raw_slot)
        if slot_index is None:
            raise ReplayProcessingError("Native replay extractor returned an invalid slot")
        occupancy.observations_by_slot[slot_index] = _native_bounded_counter(
            raw_count,
            f"spatial_occupancy.observations_by_slot.{raw_slot}",
        )
    for raw_reason, raw_count in _proxy_dict(document.get("discarded")).items():
        reason = _optional_text(raw_reason)
        if reason is None:
            raise ReplayProcessingError("Native replay extractor returned an invalid discard reason")
        occupancy.discarded[reason] = _native_bounded_counter(
            raw_count,
            f"spatial_occupancy.discarded.{reason}",
        )

    cells = document.get("cells")
    if not isinstance(cells, list) or len(cells) > MAX_SPATIAL_CELLS_TOTAL:
        raise ReplayProcessingError("Native replay extractor returned an invalid cell collection")
    for raw_cell in cells:
        cell = _proxy_dict(raw_cell)
        slot_index = _spatial_slot_index(cell.get("slot_index"))
        coordinates = cell.get("cell")
        if slot_index is None or not isinstance(coordinates, list) or len(coordinates) != 3:
            raise ReplayProcessingError("Native replay extractor returned an invalid cell")
        cell_coordinates = tuple(
            _native_int(coordinate, "spatial_occupancy.cells.cell")
            for coordinate in coordinates
        )
        key = (slot_index, *cell_coordinates)
        if key in occupancy.cells:
            raise ReplayProcessingError("Native replay extractor returned a duplicate cell")
        occupancy.cells[key] = _native_bounded_counter(
            cell.get("observed_ticks"),
            "spatial_occupancy.cells.observed_ticks",
            positive=True,
        )
        occupancy.cell_counts_by_slot[slot_index] += 1
        if occupancy.cell_counts_by_slot[slot_index] > MAX_SPATIAL_CELLS_PER_SLOT:
            raise ReplayProcessingError("Native replay extractor exceeded the per-slot cell limit")
    return occupancy


def _native_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ReplayProcessingError(f"Native replay extractor returned invalid {field}")
    return float(value)


def _native_int(value: Any, field: str) -> int:
    number = _native_number(value, field)
    if not number.is_integer():
        raise ReplayProcessingError(f"Native replay extractor returned non-integer {field}")
    return int(number)


def _native_nonnegative_int(value: Any, field: str) -> int:
    number = _native_int(value, field)
    if number < 0:
        raise ReplayProcessingError(f"Native replay extractor returned negative {field}")
    return number


def _native_bounded_counter(value: Any, field: str, *, positive: bool = False) -> int:
    number = _native_nonnegative_int(value, field)
    if number > MAX_SPATIAL_COUNTER or (positive and number == 0):
        raise ReplayProcessingError(f"Native replay extractor returned out-of-range {field}")
    return number


def _native_extractor_mode() -> str:
    mode = (os.getenv("REPLAY_EXTRACTOR_MODE") or "auto").strip().lower()
    if mode not in {"auto", "native", "native_with_fallback", "python"}:
        raise ReplayProcessingError(
            "REPLAY_EXTRACTOR_MODE must be auto, native, native_with_fallback, or python"
        )
    return mode


def _native_extractor_path() -> Path:
    configured = (os.getenv("REPLAY_NATIVE_EXTRACTOR_PATH") or "").strip()
    return Path(configured) if configured else Path(__file__).with_name("replay-extractor")


def _parse_replay(json_path: Path) -> ParsedReplay:
    parse_started = time.perf_counter()
    try:
        replay_document = _extract_replay_document(
            json_path,
            spatial_cell_size=_spatial_cell_size(),
        )
    except Exception as error:
        raise NonRetryableReplayError(f"Replay JSON parse failed: {error}") from error

    return _parsed_replay_from_document(replay_document, parse_started=parse_started)


def _parsed_replay_from_document(
    replay_document: dict[str, Any],
    *,
    parse_started: float,
) -> ParsedReplay:
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
    network_game_client = replay_document["network_game_client"]
    participant_context = replay_document["participant_context"]
    first_players = _tick_players(first_tick)
    last_players = _tick_players(last_tick)
    meta_players = {
        str(player_id): _proxy_dict(player)
        for player_id, player in game_meta_players.items()
    }
    participant_contexts = _participant_contexts_from_replay(
        network_game_client=network_game_client,
        participant_context=participant_context,
        first_players=first_players,
        last_players=last_players,
    )

    participants = _participants_from_replay(
        first_players,
        last_players,
        meta_players,
        participant_contexts,
    )
    hostman_slots = {
        int(participant["slot_index"])
        for participant in participants
        if _optional_bool(_proxy_dict(participant.get("metadata")).get("is_hostman")) is True
    }
    occupancy: SpatialOccupancyAccumulator = replay_document["spatial_occupancy"]
    occupancy.exclude_slots(hostman_slots)
    parse_duration_ms = round((time.perf_counter() - parse_started) * 1000)
    spatial_facts = occupancy.spatial_facts(
        summary=summary,
        tick_count=tick_count,
        parse_duration_ms=parse_duration_ms,
    )
    team_stats = _team_stats_from_participants(participants)
    game = _game_from_replay(
        summary=summary,
        first_tick=first_tick,
        last_tick=last_tick,
        team_stats=team_stats,
        gametype_settings=gametype_settings,
    )
    facts = _facts_from_replay(
        gametype_settings=gametype_settings,
        participants=participants,
    )
    metadata = {
        "summary": summary,
        "tick_count": tick_count,
        "event_count": replay_document["event_count"],
        "event_sample": replay_document["event_sample"],
        "parser": replay_document.get("parser")
        or {
            "name": PROCESSOR_NAME,
            "json_library": "ijson",
            "ijson_backend": getattr(ijson.backend, "__name__", str(ijson.backend)),
        },
    }
    graph_context = _graph_context_from_replay(
        first_tick=first_tick,
        last_tick=last_tick,
        participant_contexts=participant_contexts,
    )
    if graph_context is not None:
        metadata["graph_context"] = graph_context
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
        facts=facts,
        spatial_facts=spatial_facts,
    )


def _extract_replay_document(
    json_path: Path,
    *,
    spatial_cell_size: float = 0.5,
) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    game_meta_players: dict[str, Any] = {}
    first_tick: dict[str, Any] | None = None
    last_tick: dict[str, Any] | None = None
    current_tick: dict[str, Any] | None = None
    current_player: dict[str, Any] | None = None
    current_player_position: dict[str, Any] = {}
    current_player_position_object_seen = False
    gametype_settings: dict[str, Any] = {}
    network_game_client: dict[str, Any] = {}
    participant_context: dict[str, Any] = {}
    callback_game_meta: dict[str, Any] | None = None
    spawn_points: list[dict[str, float]] = []
    spawn_source_path: str | None = None
    tick_count = 0
    event_count = 0
    event_sample: list[Any] = []
    spatial_occupancy = SpatialOccupancyAccumulator(spatial_cell_size)

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
                    elif active_context and active_context[0] == "network_game_client":
                        network_game_client = _proxy_dict(_json_compatible_value(built_value))
                    elif active_context and active_context[0] == "participant_context":
                        participant_context = _proxy_dict(_json_compatible_value(built_value))
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
                    elif active_context and active_context[0] == "tick_game_time_info":
                        if current_tick is not None:
                            current_tick["game_time_info"] = _proxy_dict(
                                _json_compatible_value(built_value)
                            )
                    elif active_context and active_context[0] == "tick_network_game_client":
                        if current_tick is not None:
                            current_tick["network_game_client"] = _proxy_dict(
                                _json_compatible_value(built_value)
                            )
                        if not network_game_client:
                            network_game_client = _proxy_dict(_json_compatible_value(built_value))
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

            if prefix == "network_game_client" and event == "start_map":
                (
                    active_builder,
                    active_target,
                    active_end_event,
                    active_context,
                ) = _start_json_builder(
                    prefix,
                    event,
                    value,
                    context=("network_game_client",),
                )
                continue

            if prefix == "participant_context" and event == "start_map":
                (
                    active_builder,
                    active_target,
                    active_end_event,
                    active_context,
                ) = _start_json_builder(
                    prefix,
                    event,
                    value,
                    context=("participant_context",),
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

                if prefix == "ticks.item.game_time_info" and event == "start_map":
                    (
                        active_builder,
                        active_target,
                        active_end_event,
                        active_context,
                    ) = _start_json_builder(
                        prefix,
                        event,
                        value,
                        context=("tick_game_time_info",),
                    )
                    continue

                if (
                    not network_game_client
                    and prefix == "ticks.item.network_game_client"
                    and event == "start_map"
                ):
                    (
                        active_builder,
                        active_target,
                        active_end_event,
                        active_context,
                    ) = _start_json_builder(
                        prefix,
                        event,
                        value,
                        context=("tick_network_game_client",),
                    )
                    continue

                if prefix == "ticks.item.players.item" and event == "start_map":
                    current_player = {}
                    current_player_position = {}
                    current_player_position_object_seen = False
                    continue

                if current_player is not None:
                    if prefix == "ticks.item.players.item" and event == "end_map":
                        spatial_occupancy.observe(
                            current_player,
                            position_object_seen=current_player_position_object_seen,
                            position=current_player_position,
                        )
                        current_tick["players"].append(current_player)
                        current_player = None
                        continue

                    if (
                        prefix == "ticks.item.players.item.player_object_data"
                        and event == "start_map"
                    ):
                        current_player_position_object_seen = True
                    position_field = _direct_child_field(
                        prefix,
                        "ticks.item.players.item.player_object_data",
                    )
                    if position_field in {"x", "y", "z"} and _is_scalar_json_event(event):
                        current_player_position[position_field] = value
                    player_field = _direct_child_field(prefix, "ticks.item.players.item")
                    if player_field in PLAYER_FIELDS and _is_scalar_json_event(event):
                        current_player[player_field] = value
                    if (
                        prefix == "ticks.item.players.item.derived_stats.is_host"
                        and _is_scalar_json_event(event)
                    ):
                        current_player["is_host"] = value
                    if (
                        prefix == "ticks.item.players.item.derived_stats.is_hostman"
                        and _is_scalar_json_event(event)
                    ):
                        current_player["is_hostman"] = value
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
        "network_game_client": network_game_client,
        "participant_context": participant_context,
        "first_tick": first_tick or {},
        "last_tick": last_tick or {},
        "spawn_points": spawn_points,
        "spawn_source_path": spawn_source_path,
        "tick_count": tick_count,
        "event_count": event_count,
        "event_sample": event_sample,
        "spatial_occupancy": spatial_occupancy,
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


def _tick_players(tick: Any) -> list[dict[str, Any]]:
    players = _proxy_dict(tick).get("players")
    if not isinstance(players, list):
        return []
    return [_proxy_dict(player) for player in players]


def _graph_context_from_replay(
    *,
    first_tick: Any,
    last_tick: Any,
    participant_contexts: dict[int, dict[str, Any]],
) -> dict[str, Any] | None:
    first_tick_data = _proxy_dict(first_tick)
    last_tick_data = _proxy_dict(last_tick)
    first_recorded_tick = _recorded_game_tick(first_tick_data)
    last_recorded_tick = _recorded_game_tick(last_tick_data)
    first_recorded_seconds = _recorded_time_seconds(
        first_tick_data,
        game_tick=first_recorded_tick,
    )
    last_recorded_seconds = _recorded_time_seconds(
        last_tick_data,
        game_tick=last_recorded_tick,
    )

    coverage: dict[str, Any] = {}
    if first_recorded_tick is not None:
        starts_after_game_start = first_recorded_tick > 0
        coverage["first_recorded_tick"] = first_recorded_tick
        coverage["starts_after_game_start"] = starts_after_game_start
        coverage["incomplete_before_first_tick"] = starts_after_game_start
    if first_recorded_seconds is not None:
        coverage["first_recorded_time_seconds"] = first_recorded_seconds
    if last_recorded_tick is not None:
        coverage["last_recorded_tick"] = last_recorded_tick
    if last_recorded_seconds is not None:
        coverage["last_recorded_time_seconds"] = last_recorded_seconds

    players = _graph_context_players(
        first_players=_tick_players(first_tick_data),
        participant_contexts=participant_contexts,
        first_recorded_tick=first_recorded_tick,
        first_recorded_seconds=first_recorded_seconds,
    )
    if not coverage and not players:
        return None

    graph_context: dict[str, Any] = {"schema": GRAPH_CONTEXT_SCHEMA_VERSION}
    if coverage:
        graph_context["coverage"] = coverage
    if players:
        graph_context["players"] = players
    return graph_context


def _recorded_game_tick(tick: dict[str, Any]) -> int | None:
    game_time_info = _proxy_dict(tick.get("game_time_info"))
    return _nonnegative_int(game_time_info.get("game_time"))


def _recorded_time_seconds(tick: dict[str, Any], *, game_tick: int | None) -> int | float | None:
    game_time_info = _proxy_dict(tick.get("game_time_info"))
    for key in (
        "elapsed_seconds",
        "time_seconds",
        "game_time_seconds",
        "current_game_time_seconds",
    ):
        seconds = _nonnegative_seconds(game_time_info.get(key))
        if seconds is not None:
            return seconds

    if game_tick is not None:
        return _seconds_from_game_tick(game_tick)

    real_time_elapsed = _duration_seconds(game_time_info.get("real_time_elapsed"))
    return real_time_elapsed if real_time_elapsed is not None and real_time_elapsed >= 0 else None


def _seconds_from_game_tick(game_tick: int) -> int | float:
    if game_tick % GAME_TICKS_PER_SECOND == 0:
        return game_tick // GAME_TICKS_PER_SECOND
    return round(game_tick / GAME_TICKS_PER_SECOND, 3)


def _graph_context_players(
    *,
    first_players: list[dict[str, Any]],
    participant_contexts: dict[int, dict[str, Any]],
    first_recorded_tick: int | None,
    first_recorded_seconds: int | float | None,
) -> dict[str, Any]:
    players: dict[str, Any] = {}

    for fallback_index, player in enumerate(first_players):
        slot_index = _player_index(player, fallback=fallback_index)
        if slot_index < 0 or _is_graph_context_hostman(slot_index, player, participant_contexts):
            continue

        baselines = {
            field: value
            for field in ("kills", "deaths", "assists")
            if (value := _nonnegative_int(player.get(field))) is not None
        }
        if not baselines:
            continue

        player_context: dict[str, Any] = {
            "player_index": slot_index,
            "baselines": baselines,
            "source": "first_recorded_tick_player_counter",
        }
        if first_recorded_tick is not None:
            player_context["tick"] = first_recorded_tick
        if first_recorded_seconds is not None:
            player_context["time_seconds"] = first_recorded_seconds

        players.setdefault(str(slot_index), player_context)
        if len(players) >= MAX_GRAPH_CONTEXT_PLAYERS:
            break

    return players


def _is_graph_context_hostman(
    slot_index: int,
    player: dict[str, Any],
    participant_contexts: dict[int, dict[str, Any]],
) -> bool:
    if _optional_bool(player.get("is_hostman")) is True:
        return True
    context = _proxy_dict(participant_contexts.get(slot_index))
    return _optional_bool(context.get("is_hostman")) is True


def _nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        return int(value) if math.isfinite(value) and value >= 0 and value.is_integer() else None
    text = _optional_text(value)
    if text is None or re.fullmatch(r"\d+", text) is None:
        return None
    return int(text)


def _nonnegative_seconds(value: Any) -> int | float | None:
    if isinstance(value, bool) or value is None:
        return None
    number = _optional_float(value)
    if number is None or not math.isfinite(number) or number < 0:
        return None
    if number.is_integer():
        return int(number)
    return round(number, 3)


def _participant_contexts_from_replay(
    *,
    network_game_client: dict[str, Any],
    participant_context: dict[str, Any],
    first_players: list[dict[str, Any]],
    last_players: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    derived = _participant_contexts_from_network_client(network_game_client)
    tick_contexts = _participant_contexts_from_tick_players(
        first_players=first_players,
        last_players=last_players,
        network_game_client=network_game_client,
    )
    for slot_index, context in tick_contexts.items():
        derived.setdefault(slot_index, {}).update(
            {
                key: value
                for key, value in context.items()
                if key not in derived.get(slot_index, {})
            }
        )

    explicit = _participant_contexts_from_payload(participant_context)
    for slot_index, context in explicit.items():
        derived.setdefault(slot_index, {}).update(context)

    return {
        slot_index: context
        for slot_index, context in derived.items()
        if context
    }


def _participant_contexts_from_network_client(
    network_game_client: dict[str, Any],
) -> dict[int, dict[str, Any]]:
    network_game_data = _proxy_dict(network_game_client.get("network_game_data"))
    network_players = network_game_data.get("network_players")
    if not isinstance(network_players, list):
        return {}

    contexts: dict[int, dict[str, Any]] = {}
    players_by_machine: dict[int, list[tuple[int, int]]] = {}
    fallback_order_by_machine: dict[int, int] = {}

    for fallback_order, raw_player in enumerate(network_players):
        player = _proxy_dict(raw_player)
        slot_index = _optional_int(player.get("player_list_index"))
        machine_index = _optional_int(player.get("machine_index"))
        controller_index = _optional_int(player.get("controller_index"))
        if slot_index is None:
            continue

        context: dict[str, Any] = {}
        if machine_index is not None:
            context["machine_index"] = machine_index
            context["is_host"] = machine_index == 0
            fallback_order_by_machine[machine_index] = fallback_order
        if controller_index is not None:
            context["controller_index"] = controller_index

        contexts[slot_index] = context
        if machine_index is not None:
            players_by_machine.setdefault(machine_index, []).append(
                (
                    controller_index if controller_index is not None else fallback_order,
                    slot_index,
                )
            )

    _assign_screen_contexts(contexts, players_by_machine, fallback_order_by_machine)
    return contexts


def _participant_contexts_from_tick_players(
    *,
    first_players: list[dict[str, Any]],
    last_players: list[dict[str, Any]],
    network_game_client: dict[str, Any],
) -> dict[int, dict[str, Any]]:
    local_machine_index = _optional_int(network_game_client.get("machine_index"))
    players_by_machine: dict[int, list[tuple[int, int]]] = {}
    contexts: dict[int, dict[str, Any]] = {}
    first_by_index = {
        _player_index(player, fallback=index): player
        for index, player in enumerate(first_players)
    }

    for fallback_index, last_player in enumerate(last_players):
        slot_index = _player_index(last_player, fallback=fallback_index)
        first_player = first_by_index.get(slot_index, {})
        local_player = _optional_int(last_player.get("local_player"))
        if local_player is None:
            local_player = _optional_int(first_player.get("local_player"))
        is_host = _optional_bool(last_player.get("is_host"))
        if is_host is None:
            is_host = _optional_bool(first_player.get("is_host"))
        is_hostman = _optional_bool(last_player.get("is_hostman"))
        if is_hostman is None:
            is_hostman = _optional_bool(first_player.get("is_hostman"))

        context: dict[str, Any] = {}
        if local_player is not None and local_player >= 0:
            context["controller_index"] = local_player
            if local_machine_index is not None:
                context["machine_index"] = local_machine_index
                context["is_host"] = local_machine_index == 0
                players_by_machine.setdefault(local_machine_index, []).append(
                    (local_player, slot_index)
                )
        if is_host is not None:
            context["is_host"] = is_host
        if is_hostman is not None:
            context["is_hostman"] = is_hostman
        if context:
            contexts[slot_index] = context

    _assign_screen_contexts(
        contexts,
        players_by_machine,
        {machine_index: 0 for machine_index in players_by_machine},
    )
    return contexts


def _participant_contexts_from_payload(value: Any) -> dict[int, dict[str, Any]]:
    context_payload = _proxy_dict(value)
    players = context_payload.get("players")
    if isinstance(players, dict):
        items = players.items()
    elif isinstance(players, list):
        items = enumerate(players)
    else:
        return {}

    contexts: dict[int, dict[str, Any]] = {}
    for raw_slot_index, raw_context in items:
        context_mapping = _proxy_dict(raw_context)
        slot_index = None
        for candidate in (
            context_mapping.get("slot_index"),
            context_mapping.get("player_list_index"),
            context_mapping.get("player_index"),
            raw_slot_index,
        ):
            slot_index = _optional_int(candidate)
            if slot_index is not None:
                break
        if slot_index is None:
            continue
        context = _normalized_participant_context(context_mapping)
        if context:
            contexts[slot_index] = context
    return contexts


def _normalized_participant_context(value: dict[str, Any]) -> dict[str, Any]:
    context: dict[str, Any] = {}
    for key in ("machine_index", "controller_index"):
        integer = _optional_int(value.get(key))
        if integer is not None and integer >= 0:
            context[key] = integer

    is_host = _optional_bool(value.get("is_host"))
    if is_host is not None:
        context["is_host"] = is_host

    is_hostman = _optional_bool(value.get("is_hostman"))
    if is_hostman is not None:
        context["is_hostman"] = is_hostman

    screen_slot = _screen_slot(value.get("screen_slot"))
    if screen_slot is not None:
        context["screen_slot"] = screen_slot

    screen_layout = _safe_gametype_text(value.get("screen_layout"))
    if screen_layout is not None:
        context["screen_layout"] = screen_layout

    return context


def _assign_screen_contexts(
    contexts: dict[int, dict[str, Any]],
    players_by_machine: dict[int, list[tuple[int, int]]],
    fallback_order_by_machine: dict[int, int],
) -> None:
    for machine_index, players in players_by_machine.items():
        ordered = sorted(
            players,
            key=lambda item: (
                item[0],
                fallback_order_by_machine.get(machine_index, 0),
                item[1],
            ),
        )
        player_count = len(ordered)
        slots = SCREEN_SLOTS_BY_PLAYER_COUNT.get(player_count)
        layout = SCREEN_LAYOUT_BY_PLAYER_COUNT.get(player_count)
        if not slots or layout is None:
            continue
        for order, (_, slot_index) in enumerate(ordered):
            context = contexts.setdefault(slot_index, {})
            context.setdefault("screen_slot", slots[order])
            context.setdefault("screen_layout", layout)


def _participants_from_replay(
    first_players: list[dict[str, Any]],
    last_players: list[dict[str, Any]],
    meta_players: dict[str, dict[str, Any]],
    participant_contexts: dict[int, dict[str, Any]],
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
        kills = _optional_int(last_player.get("kills")) or _sum_tick_event_counts(
            meta_player.get("kills_by_tick")
        )
        deaths = _optional_int(last_player.get("deaths")) or _sum_tick_event_counts(
            meta_player.get("deaths_by_tick")
        )
        assists = _optional_int(last_player.get("assists")) or _sum_numeric_values(
            meta_player.get("assists_by_tick")
        )
        metadata = {
            "replay_player_index": slot_index,
            "local_player": last_player.get("local_player"),
            "ctf_score": ctf_score,
            "player_quit": last_player.get("player_quit"),
        }
        for key, value in participant_contexts.get(slot_index, {}).items():
            if value is not None:
                metadata[key] = value

        raw_stats = {
            "shots_by_weapon": _small_mapping(meta_player.get("shots_by_weapon")),
            "damage_to_player": _small_mapping(meta_player.get("damage_to_player")),
            "damage_from_player": _small_mapping(meta_player.get("damage_from_player")),
            "camo_count": meta_player.get("camo_count"),
            "overshield_count": meta_player.get("overshield_count"),
        }
        raw_stats.update(_streak_multikill_stats(meta_player))

        participants.append(
            {
                "slot_index": slot_index,
                "team_index": team_index,
                "team_name": _team_name(team_index),
                "in_game_name": _player_name(last_player, first_player, slot_index),
                "metadata": metadata,
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
                    "raw_stats": raw_stats,
                },
            }
        )

    return participants


def _streak_multikill_stats(meta_player: dict[str, Any]) -> dict[str, int]:
    stats: dict[str, int] = {}
    max_streak = _max_kill_streak(meta_player)
    if max_streak is not None:
        stats["max_kill_streak"] = max_streak

    multikill_counts = _multikill_counts(meta_player)
    if multikill_counts is not None:
        stats["double_kills"] = multikill_counts.get(2, 0)
        stats["triple_kills"] = multikill_counts.get(3, 0)
        stats["multikills_4_plus"] = sum(
            count
            for amount, count in multikill_counts.items()
            if amount >= 4
        )
    return stats


def _max_kill_streak(meta_player: dict[str, Any]) -> int | None:
    values: list[int] = []
    streak_by_tick = _proxy_dict(meta_player.get("streak_by_tick"))
    values.extend(
        streak
        for raw_value in streak_by_tick.values()
        if (streak := _optional_int(raw_value)) is not None
    )

    streak_counts_by_amount = _proxy_dict(meta_player.get("streak_counts_by_amount"))
    values.extend(
        amount
        for raw_amount, raw_count in streak_counts_by_amount.items()
        if (amount := _optional_int(raw_amount)) is not None
        and (count := _optional_int(raw_count)) is not None
        and count > 0
    )
    return max(values) if values else None


def _multikill_counts(meta_player: dict[str, Any]) -> dict[int, int] | None:
    counts_by_amount = _proxy_dict(meta_player.get("multikill_counts_by_amount"))
    if counts_by_amount:
        counts: dict[int, int] = {}
        for raw_amount, raw_count in counts_by_amount.items():
            amount = _optional_int(raw_amount)
            count = _optional_int(raw_count)
            if amount is not None and amount >= 2 and count is not None:
                counts[amount] = count
        return counts

    multikills_by_tick = _proxy_dict(meta_player.get("multikills_by_tick"))
    if not multikills_by_tick:
        return None
    counts: dict[int, int] = {}
    for raw_values in multikills_by_tick.values():
        values = raw_values if isinstance(raw_values, list | tuple) else [raw_values]
        for raw_amount in values:
            amount = _optional_int(raw_amount)
            if amount is not None and amount >= 2:
                counts[amount] = counts.get(amount, 0) + 1
    return counts


def _facts_from_replay(
    *,
    gametype_settings: dict[str, Any],
    participants: list[dict[str, Any]],
) -> dict[str, Any] | None:
    game_facts = _gametype_fact_values(gametype_settings)
    game_facts["game.host_style"] = _host_style_fact_value(participants)
    participant_facts = [
        {
            "slot_index": participant["slot_index"],
            "facts": facts,
        }
        for participant in participants
        if (facts := _participant_fact_values(participant))
    ]
    if not game_facts and not participant_facts:
        return None
    return {
        "schema": FACT_SCHEMA_VERSION,
        "game": game_facts,
        "participants": participant_facts,
    }


def _gametype_fact_values(settings: dict[str, Any]) -> dict[str, Any]:
    facts: dict[str, Any] = {}
    for path, raw_value in _iter_fact_paths(settings):
        key = "gametype." + ".".join(path)
        value = _gametype_fact_value(key, raw_value)
        if value is not OMIT:
            facts[key] = value
    return facts


def _iter_fact_paths(value: Any, prefix: tuple[str, ...] = ()) -> list[tuple[tuple[str, ...], Any]]:
    mapping = _proxy_dict(value)
    if not mapping:
        return []

    paths: list[tuple[tuple[str, ...], Any]] = []
    for raw_key, raw_value in mapping.items():
        part = _fact_key_part(raw_key)
        if part is None:
            continue
        path = (*prefix, part)
        if isinstance(raw_value, dict) or hasattr(raw_value, "as_dict"):
            paths.extend(_iter_fact_paths(raw_value, path))
        else:
            paths.append((path, raw_value))
    return paths


def _gametype_fact_value(key: str, value: Any) -> Any:
    if key in GAMETYPE_BOOL_FACT_KEYS:
        boolean = _optional_bool(value)
        return boolean if boolean is not None else OMIT
    if key in GAMETYPE_INT_FACT_KEYS:
        integer = _optional_int(value)
        return integer if integer is not None else OMIT

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
    return OMIT


def _participant_fact_values(participant: dict[str, Any]) -> dict[str, Any]:
    metadata = _proxy_dict(participant.get("metadata"))
    stats = _proxy_dict(participant.get("stats"))
    raw_stats = _proxy_dict(stats.get("raw_stats"))
    facts: dict[str, Any] = {}

    for key in (
        "is_host",
        "is_hostman",
        "machine_index",
        "controller_index",
        "screen_slot",
        "screen_layout",
    ):
        if metadata.get(key) is not None:
            facts[f"participant.{key}"] = metadata[key]

    for key in (
        "max_kill_streak",
        "double_kills",
        "triple_kills",
        "multikills_4_plus",
    ):
        if raw_stats.get(key) is not None:
            facts[f"participant.{key}"] = raw_stats[key]

    return facts


def _host_style_fact_value(participants: list[dict[str, Any]]) -> str:
    host_players = [
        participant
        for participant in participants
        if _optional_bool(_proxy_dict(participant.get("metadata")).get("is_host")) is True
    ]
    if not host_players:
        return "neutral"
    if len(host_players) == 1:
        metadata = _proxy_dict(host_players[0].get("metadata"))
        if _optional_bool(metadata.get("is_hostman")) is True:
            return "neutral"
    return "on_off"


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


def _write_spatial_artifact(
    *,
    parsed: ParsedReplay,
    bucket: str,
    upload_id: str,
    generation: int,
    source_replay_sha256: str,
) -> dict[str, Any] | None:
    spatial_facts = parsed.spatial_facts
    if spatial_facts is None:
        return None

    source_hash = _sha256_text(source_replay_sha256)
    if source_hash is None:
        raise ReplayProcessingError("Spatial artifact source replay SHA-256 was invalid")
    coverage = {
        **spatial_facts.coverage,
        "source": {
            "replay_sha256": source_hash,
            "parser": PROCESSOR_NAME,
        },
    }
    occupancy = [
        {
            "slot_index": slot_index,
            "cell": [cell_x, cell_y, cell_z],
            "observed_ticks": observed_ticks,
        }
        for (slot_index, cell_x, cell_y, cell_z), observed_ticks in sorted(
            spatial_facts.cells.items()
        )
    ]
    document = {
        "schema": SPATIAL_FACTS_SCHEMA_VERSION,
        "coordinate_space": SPATIAL_COORDINATE_SPACE,
        "ticks_per_second": GAME_TICKS_PER_SECOND,
        "cell_size": spatial_facts.cell_size,
        "coverage": coverage,
        "occupancy": occupancy,
    }
    raw_bytes = json.dumps(
        document,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    if len(raw_bytes) > MAX_SPATIAL_ARTIFACT_UNCOMPRESSED_BYTES:
        raise ReplayProcessingError("Spatial artifact exceeded the uncompressed size limit")
    compressed_bytes = gzip.compress(raw_bytes, compresslevel=6, mtime=0)
    if not 0 < len(compressed_bytes) <= MAX_SPATIAL_ARTIFACT_BYTES:
        raise ReplayProcessingError("Spatial artifact exceeded the compressed size limit")

    key = _spatial_artifact_key(upload_id, generation=generation)
    artifact_sha256 = hashlib.sha256(compressed_bytes).hexdigest()
    S3.put_object(
        Bucket=bucket,
        Key=key,
        Body=compressed_bytes,
        ContentType="application/json",
        ContentEncoding="gzip",
        Metadata={
            "schema": SPATIAL_FACTS_SCHEMA_VERSION,
            "generation": str(generation),
            "source-replay-sha256": source_hash,
        },
    )
    metrics = {
        "position_observations": coverage["position_observations"],
        "distinct_cells": coverage["distinct_cells"],
        "discarded_samples": coverage["position_samples_discarded"],
        "uncompressed_size_bytes": len(raw_bytes),
        "compressed_size_bytes": len(compressed_bytes),
        "parse_duration_ms": spatial_facts.runtime_metrics.get("parse_duration_ms"),
        "process_peak_rss_kib": _process_peak_rss_kib()
        or spatial_facts.runtime_metrics.get("process_peak_rss_kib"),
    }
    LOGGER.info(
        "Spatial occupancy artifact metrics: %s",
        json.dumps(metrics, separators=(",", ":"), sort_keys=True),
    )
    return {
        "schema": SPATIAL_FACTS_SCHEMA_VERSION,
        "generation": generation,
        "s3_bucket": bucket,
        "s3_key": key,
        "content_type": "application/json",
        "encoding": "gzip",
        "size_bytes": len(compressed_bytes),
        "sha256": artifact_sha256,
        "source_replay_sha256": source_hash,
        "coordinate_space": SPATIAL_COORDINATE_SPACE,
        "cell_size": spatial_facts.cell_size,
        "ticks_per_second": GAME_TICKS_PER_SECOND,
        "metrics": ["occupancy"],
        "coverage": coverage,
        "metadata": {
            "parser": PROCESSOR_NAME,
            "uncompressed_size_bytes": len(raw_bytes),
            **spatial_facts.runtime_metrics,
        },
    }


def _spatial_artifact_key(upload_id: str, *, generation: int) -> str:
    prefix = _prefix_env("SPATIAL_ARTIFACT_PREFIX", "replays/derived/spatial/")
    return (
        f"{prefix}{upload_id}/generations/{generation}/"
        f"{SPATIAL_FACTS_SCHEMA_VERSION}.json.gz"
    )


def _reprocess_spatial_generation(attempt_id: str) -> int:
    # UUID-derived generations are stable across SQS retries and fit PostgreSQL integer.
    attempt_value = uuid.UUID(attempt_id).int
    return (attempt_value % (2_147_483_647 - 1)) + 2


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
    spatial_artifact: dict[str, Any] | None = None,
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
    if spatial_artifact is not None:
        payload["spatial_artifact"] = spatial_artifact
    if parsed.spawn_points:
        payload["spawn_points"] = parsed.spawn_points
        payload["spawn_source"] = parsed.spawn_source or {"extractor": PROCESSOR_NAME}
    if parsed.game_meta is not None:
        payload["game_meta"] = parsed.game_meta
    if parsed.facts is not None:
        payload["facts"] = parsed.facts
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


def _send_reprocess_attempt_status(
    job: ReplayReprocessJob,
    status: str,
    error: BaseException,
) -> None:
    payload: dict[str, Any] = {
        "status": status,
        "error_message": str(error)[:4096],
        "metadata": {
            "processor_runtime": {
                "name": PROCESSOR_NAME,
            },
            "job": {
                "job_id": job.job_id,
                "operation_id": job.operation_id,
                "attempt_id": job.attempt_id,
                "mode": job.mode,
                "upload_id": job.upload_id,
                "replay_id": job.replay_id,
            },
            "source_replay": {
                "s3_bucket": job.source_object.bucket,
                "s3_key": job.source_object.key,
                "event_name": job.source_object.event_name,
            },
            "current_replay_file": {
                "s3_bucket": job.current_replay_file.bucket,
                "s3_key": job.current_replay_file.key,
                "file_role": job.current_replay_file.file_role,
                "content_type": job.current_replay_file.content_type,
                "size_bytes": job.current_replay_file.size_bytes,
                "sha256": job.current_replay_file.sha256,
            },
            "processor_error": _exception_details(error),
        },
    }
    if isinstance(error, ClientError):
        payload["metadata"]["s3_error"] = _s3_client_error_details(error)

    _call_app_api(
        "PATCH",
        _settings()["reprocess_status_path_template"].format(
            attempt_id=job.attempt_id,
        ),
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


def _is_nonretryable_s3_download_error(error: ClientError) -> bool:
    details = _s3_client_error_details(error)
    code = str(details.get("code") or "")
    status_code = details.get("http_status_code")
    return code in NONRETRYABLE_S3_DOWNLOAD_ERROR_CODES or status_code == 404


def _s3_client_error_details(error: ClientError) -> dict[str, Any]:
    error_response = error.response if isinstance(error.response, dict) else {}
    error_details = error_response.get("Error") or {}
    response_metadata = error_response.get("ResponseMetadata") or {}
    return {
        "operation": error.operation_name,
        "code": str(error_details.get("Code") or ""),
        "message": str(error_details.get("Message") or ""),
        "http_status_code": response_metadata.get("HTTPStatusCode"),
        "request_id": response_metadata.get("RequestId"),
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
        "reprocess_status_path_template": os.getenv(
            "APP_API_REPLAY_REPROCESS_ATTEMPT_STATUS_PATH_TEMPLATE",
            "/v1/ingest/replay-reprocess-attempts/{attempt_id}/status",
        ),
        "unprocessed_prefix": _prefix_env("REPLAY_UNPROCESSED_PREFIX", "replays/unprocessed/"),
        "processed_prefix": _prefix_env("REPLAY_PROCESSED_PREFIX", "replays/processed/"),
        "failed_prefix": _prefix_env("REPLAY_FAILED_PREFIX", "replays/failed/"),
        "spatial_artifact_prefix": _prefix_env(
            "SPATIAL_ARTIFACT_PREFIX",
            "replays/derived/spatial/",
        ),
    }


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise ReplayProcessingError(f"Missing required environment variable: {name}")
    return value.strip()


def _prefix_env(name: str, default: str) -> str:
    value = (os.getenv(name) or default).strip().strip("/")
    return f"{value}/"


def _spatial_cell_size() -> float:
    raw_value = (os.getenv("SPATIAL_OCCUPANCY_CELL_SIZE") or "0.5").strip()
    try:
        cell_size = float(raw_value)
    except ValueError as error:
        raise ReplayProcessingError("SPATIAL_OCCUPANCY_CELL_SIZE must be numeric") from error
    if cell_size not in SUPPORTED_SPATIAL_CELL_SIZES:
        raise ReplayProcessingError(
            f"SPATIAL_OCCUPANCY_CELL_SIZE must be one of "
            f"{sorted(SUPPORTED_SPATIAL_CELL_SIZES)}"
        )
    return cell_size


def _spatial_slot_index(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(numeric) or not numeric.is_integer():
        return None
    slot_index = int(numeric)
    if not 0 <= slot_index < MAX_SPATIAL_PLAYER_SLOTS:
        return None
    return slot_index


def _spatial_coordinate(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        coordinate = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return coordinate if math.isfinite(coordinate) else None


def _bounded_add(current: int, amount: int) -> int:
    return min(MAX_SPATIAL_COUNTER, current + max(0, amount))


def _sha256_text(value: Any) -> str | None:
    text = str(value or "").strip().lower()
    return text if re.fullmatch(r"[0-9a-f]{64}", text) else None


def _process_peak_rss_kib() -> int | None:
    try:
        for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
            if line.startswith("VmHWM:"):
                return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        return None
    return None


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


def _fact_key_part(value: Any) -> str | None:
    text = _optional_text(value)
    if text is None:
        return None
    normalized = re.sub(r"[^a-z0-9_]+", "_", text.lower()).strip("_")
    return normalized if SAFE_FACT_KEY_PART_PATTERN.fullmatch(normalized) else None


def _screen_slot(value: Any) -> str | None:
    text = _optional_text(value)
    if text is None:
        return None
    normalized = text.lower()
    return normalized if normalized in VALID_SCREEN_SLOTS else None


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


def _sum_tick_event_counts(value: Any) -> int:
    mapping = _proxy_dict(value)
    total = 0
    for item in mapping.values():
        if isinstance(item, list | tuple):
            total += len(item)
            continue
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


def _optional_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    text = _optional_text(value)
    if text is None:
        return None
    normalized = text.lower()
    if normalized in {"1", "true", "yes", "on", "y", "t"}:
        return True
    if normalized in {"0", "false", "no", "off", "n", "f"}:
        return False
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
