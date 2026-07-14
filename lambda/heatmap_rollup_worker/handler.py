from __future__ import annotations

import gzip
import hashlib
import hmac
import json
import logging
import math
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Callable, Mapping

import boto3
from botocore.exceptions import BotoCoreError, ClientError

try:
    import resource
except ImportError:  # pragma: no cover - Lambda runs on Linux; local tests may not.
    resource = None  # type: ignore[assignment]


LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)

S3 = boto3.client("s3")
SECRETS = boto3.client("secretsmanager")

WORKER_VERSION = "heatmap-rollup-worker.v1"
ROLLUP_SCHEMA = "halospawns.heatmapRollup.v1"
INPUT_SCHEMA = "halospawns.spatialFacts.v1"
SOURCE_COORDINATE_SPACE = "halo1.replay_world.v1"
PLANE_COORDINATE_SPACE = "halospawns.map_render_world.v1"
SOURCE_CELL_SIZE = 0.5
METRICS = ("occupancy", "killer_position", "victim_position")
MAX_INPUT_ARTIFACT_BYTES = 10 * 1024 * 1024
MAX_DECOMPRESSED_INPUT_BYTES = 64 * 1024 * 1024
MAX_DECOMPRESSED_OUTPUT_BYTES = 256 * 1024 * 1024
MAX_OUTPUT_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_CELLS_PER_GROUP = 2_000_000
MAX_GROUPS_PER_METRIC = 64
MAX_CELL_VALUE = 9_007_199_254_740_991
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
MIN_REMAINING_TIME_MS = 30_000
SECRET_CACHE: dict[str, str] = {}


class RollupError(Exception):
    def __init__(
        self,
        error_code: str,
        safe_message: str,
        *,
        retryable: bool,
    ) -> None:
        super().__init__(safe_message)
        self.error_code = error_code
        self.safe_message = safe_message
        self.retryable = retryable


class StaleRevisionError(Exception):
    pass


@dataclass(frozen=True)
class Settings:
    app_api_base_url: str
    trusted_client_name: str
    trusted_client_secret_id: str
    uploads_bucket: str
    input_prefix: str
    output_prefix: str
    claim_path: str
    input_path_template: str
    complete_path_template: str
    failed_path_template: str
    input_page_limit: int
    max_scopes_per_invocation: int
    retry_after_seconds: int
    request_timeout_seconds: int


@dataclass(frozen=True)
class GeneratedArtifact:
    path: Path
    bucket: str
    key: str
    size_bytes: int
    sha256: str
    cell_count: int
    summary: dict[str, int]
    decoded_size_bytes: int = 0


@dataclass(frozen=True)
class ScopeResult:
    status: str
    input_games: int
    input_bytes: int
    output_bytes: int
    output_cells: int
    duration_ms: int
    output_decoded_bytes: int = 0


@dataclass
class RuntimeMetrics:
    api_requests: int = 0
    api_duration_ms: int = 0
    s3_gets: int = 0
    input_decoded_bytes: int = 0


class MetricAccumulator:
    def __init__(self, value_unit: str) -> None:
        self.value_unit = value_unit
        self.groups: dict[tuple[int, int], dict[tuple[int, int], int]] = defaultdict(dict)
        self.games_contributing: set[str] = set()
        self.participants_contributing: set[str] = set()

    def add(
        self,
        *,
        group: tuple[int, int],
        cell: tuple[int, int],
        value: int,
        game_id: str,
        participant_id: str,
    ) -> None:
        if value <= 0:
            raise RollupError(
                "invalid_input_contract",
                "A heatmap input contained an invalid count",
                retryable=False,
            )
        cells = self.groups[group]
        updated = cells.get(cell, 0) + value
        if updated > MAX_CELL_VALUE:
            raise RollupError(
                "rollup_counter_overflow",
                "A heatmap rollup counter exceeded its supported range",
                retryable=False,
            )
        if cell not in cells and len(cells) >= MAX_CELLS_PER_GROUP:
            raise RollupError(
                "rollup_cell_limit_exceeded",
                "A heatmap rollup exceeded its supported cell count",
                retryable=False,
            )
        cells[cell] = updated
        self.games_contributing.add(game_id)
        self.participants_contributing.add(participant_id)

    def document(self, *, games_selected: int, participants_selected: int) -> dict[str, object]:
        if len(self.groups) > MAX_GROUPS_PER_METRIC:
            raise RollupError(
                "rollup_group_limit_exceeded",
                "A heatmap rollup exceeded its supported team count",
                retryable=False,
            )
        groups = []
        for group_key in sorted(self.groups, key=_group_sort_key):
            team_index = None if group_key[0] == 1 else group_key[1]
            groups.append(
                {
                    "key": "team:none" if team_index is None else f"team:{team_index}",
                    "label": "No team" if team_index is None else f"Team {team_index}",
                    "team_index": team_index,
                    "cells": [
                        {"cell": [cell[0], cell[1]], "value": value}
                        for cell, value in sorted(self.groups[group_key].items())
                    ],
                }
            )
        return {
            "value_unit": self.value_unit,
            "summary": {
                "games_selected": games_selected,
                "games_contributing": len(self.games_contributing),
                "participants_selected": participants_selected,
                "participants_contributing": len(self.participants_contributing),
            },
            "groups": groups,
        }


class RollupAccumulator:
    def __init__(self, claim: Mapping[str, object]) -> None:
        self.claim = _validated_claim(claim)
        self.games_selected = 0
        self.participants_selected = 0
        self.input_bytes = 0
        self.metrics = {
            "occupancy": MetricAccumulator("observed_ticks"),
            "killer_position": MetricAccumulator("events"),
            "victim_position": MetricAccumulator("events"),
        }

    def add_game(
        self,
        game: Mapping[str, object],
        *,
        occupancy_loader: Callable[[Mapping[str, object]], tuple[Mapping[str, object], int]],
    ) -> None:
        game_id = _required_string(game, "game_id")
        participants_raw = game.get("participants")
        if not isinstance(participants_raw, list):
            raise _invalid_input("Heatmap participants were missing")

        participants_by_slot: dict[int, tuple[str, tuple[int, int]]] = {}
        for participant_raw in participants_raw:
            if not isinstance(participant_raw, Mapping):
                raise _invalid_input("A heatmap participant was invalid")
            participant_id = _required_string(participant_raw, "participant_id")
            slot_index = _required_int(participant_raw, "slot_index", minimum=0)
            if slot_index in participants_by_slot:
                raise _invalid_input("A heatmap participant slot was duplicated")
            team_index = participant_raw.get("team_index")
            if team_index is not None and (isinstance(team_index, bool) or not isinstance(team_index, int)):
                raise _invalid_input("A heatmap participant team was invalid")
            group = (1, 0) if team_index is None else (0, team_index)
            participants_by_slot[slot_index] = (participant_id, group)
            self.participants_selected += 1
            self._add_events(
                game_id=game_id,
                participant_id=participant_id,
                group=group,
                participant=participant_raw,
            )

        self.games_selected += 1
        manifest = game.get("occupancy_artifact")
        if manifest is None:
            return
        if not isinstance(manifest, Mapping):
            raise _invalid_input("A heatmap occupancy manifest was invalid")
        document, downloaded_bytes = occupancy_loader(manifest)
        self.input_bytes += downloaded_bytes
        self._add_occupancy(
            game_id=game_id,
            participants_by_slot=participants_by_slot,
            document=document,
        )

    def document(self) -> dict[str, object]:
        metrics = {
            name: accumulator.document(
                games_selected=self.games_selected,
                participants_selected=self.participants_selected,
            )
            for name, accumulator in self.metrics.items()
        }
        return {
            "schema": ROLLUP_SCHEMA,
            "scope": {
                "type": self.claim["scope_type"],
                "map_id": self.claim["map_id"],
                "player_id": self.claim["player_id"],
                "eligibility": self.claim["eligibility"],
                "source_revision": self.claim["source_revision"],
            },
            "source_coordinate_space": SOURCE_COORDINATE_SPACE,
            "plane_coordinate_space": PLANE_COORDINATE_SPACE,
            "source_cell_size": SOURCE_CELL_SIZE,
            "metrics": metrics,
        }

    def cell_count(self) -> int:
        return sum(
            len(cells)
            for metric in self.metrics.values()
            for cells in metric.groups.values()
        )

    def summary(self) -> dict[str, int]:
        return {
            "games_selected": self.games_selected,
            "participants_selected": self.participants_selected,
            "input_bytes": self.input_bytes,
            "cells": self.cell_count(),
        }

    def _add_events(
        self,
        *,
        game_id: str,
        participant_id: str,
        group: tuple[int, int],
        participant: Mapping[str, object],
    ) -> None:
        events = participant.get("events")
        if not isinstance(events, list):
            raise _invalid_input("Heatmap participant events were missing")
        for event in events:
            if not isinstance(event, Mapping):
                raise _invalid_input("A heatmap event was invalid")
            metric = event.get("event_type")
            if metric not in {"killer_position", "victim_position"}:
                raise _invalid_input("A heatmap event type was invalid")
            replay_x = _finite_number(event, "replay_x")
            replay_y = _finite_number(event, "replay_y")
            self.metrics[str(metric)].add(
                group=group,
                cell=_plane_cell(
                    math.floor(replay_x / SOURCE_CELL_SIZE),
                    math.floor(-replay_y / SOURCE_CELL_SIZE),
                ),
                value=1,
                game_id=game_id,
                participant_id=participant_id,
            )

    def _add_occupancy(
        self,
        *,
        game_id: str,
        participants_by_slot: Mapping[int, tuple[str, tuple[int, int]]],
        document: Mapping[str, object],
    ) -> None:
        _validate_occupancy_document(document)
        occupancy = document.get("occupancy")
        assert isinstance(occupancy, list)
        for row in occupancy:
            if not isinstance(row, Mapping):
                raise _invalid_artifact("An occupancy row was invalid")
            slot_index = _required_int(row, "slot_index", minimum=0, artifact=True)
            selected = participants_by_slot.get(slot_index)
            if selected is None:
                continue
            cell = row.get("cell")
            if (
                not isinstance(cell, list)
                or len(cell) != 3
                or any(isinstance(value, bool) or not isinstance(value, int) for value in cell)
            ):
                raise _invalid_artifact("An occupancy cell was invalid")
            observed_ticks = _required_int(row, "observed_ticks", minimum=1, artifact=True)
            participant_id, group = selected
            # Project the center of the replay-space source voxel onto render x/-y.
            plane_cell = _plane_cell(cell[0], -cell[1] - 1)
            self.metrics["occupancy"].add(
                group=group,
                cell=plane_cell,
                value=observed_ticks,
                game_id=game_id,
                participant_id=participant_id,
            )


def lambda_handler(event: object, context: object) -> dict[str, object]:
    del event
    settings = _settings()
    started = time.monotonic()
    runtime_metrics = RuntimeMetrics()
    totals = {
        "completed": 0,
        "stale": 0,
        "failed": 0,
        "input_games": 0,
        "input_bytes": 0,
        "input_decoded_bytes": 0,
        "output_bytes": 0,
        "output_decoded_bytes": 0,
        "output_cells": 0,
        "s3_gets": 0,
        "api_requests": 0,
        "api_duration_ms": 0,
    }

    for _ in range(settings.max_scopes_per_invocation):
        if _remaining_time_ms(context) < MIN_REMAINING_TIME_MS:
            break
        claims = _claim_scopes(settings, runtime_metrics)
        if not claims:
            break
        result = _process_claim(settings, claims[0], runtime_metrics)
        totals[result.status] += 1
        totals["input_games"] += result.input_games
        totals["input_bytes"] += result.input_bytes
        totals["output_bytes"] += result.output_bytes
        totals["output_decoded_bytes"] += result.output_decoded_bytes
        totals["output_cells"] += result.output_cells

    totals["input_decoded_bytes"] = runtime_metrics.input_decoded_bytes
    totals["s3_gets"] = runtime_metrics.s3_gets
    totals["api_requests"] = runtime_metrics.api_requests
    totals["api_duration_ms"] = runtime_metrics.api_duration_ms
    duration_ms = round((time.monotonic() - started) * 1000)
    _emit_metrics(totals, duration_ms=duration_ms)
    LOGGER.info(
        "Heatmap rollup invocation completed: %s",
        json.dumps({**totals, "duration_ms": duration_ms}, separators=(",", ":"), sort_keys=True),
    )
    return {**totals, "duration_ms": duration_ms}


def _process_claim(
    settings: Settings,
    claim_raw: Mapping[str, object],
    runtime_metrics: RuntimeMetrics | None = None,
) -> ScopeResult:
    started = time.monotonic()
    runtime_metrics = runtime_metrics or RuntimeMetrics()
    claim = _validated_claim(claim_raw)
    scope_id = str(claim["scope_id"])
    output_key = _rollup_key(settings.output_prefix, scope_id, int(claim["next_generation"]))
    generated: GeneratedArtifact | None = None
    completion_attempted = False

    try:
        accumulator = RollupAccumulator(claim)
        cursor: str | None = None
        while True:
            page = _list_inputs(settings, claim, cursor=cursor, runtime_metrics=runtime_metrics)
            games = page.get("games")
            if not isinstance(games, list):
                raise _invalid_input("The heatmap input page was invalid")
            for game in games:
                if not isinstance(game, Mapping):
                    raise _invalid_input("A heatmap game input was invalid")
                accumulator.add_game(
                    game,
                    occupancy_loader=lambda manifest: _load_occupancy_artifact(
                        settings,
                        manifest,
                        runtime_metrics,
                    ),
                )
            next_cursor = page.get("next_cursor")
            if next_cursor is None:
                break
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor == cursor:
                raise _invalid_input("The heatmap input cursor was invalid")
            cursor = next_cursor

        generated = _write_rollup_artifact(
            settings=settings,
            claim=claim,
            document=accumulator.document(),
            output_key=output_key,
            summary=accumulator.summary(),
            cell_count=accumulator.cell_count(),
        )
        completion_attempted = True
        completion = _complete_scope(settings, claim, generated, runtime_metrics)
        if completion.get("stale") is True:
            _delete_generated_artifact(generated)
            return _scope_result("stale", accumulator, generated, started)
        if completion.get("activated") is not True:
            raise RollupError(
                "completion_not_activated",
                "The heatmap rollup completion was not activated",
                retryable=True,
            )
        _mark_generation_active(settings, claim, generated)
        LOGGER.info(
            "Heatmap rollup scope completed: %s",
            json.dumps(
                {
                    "scope_id": scope_id,
                    "source_revision": claim["source_revision"],
                    "generation": claim["next_generation"],
                    **generated.summary,
                    "output_bytes": generated.size_bytes,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
        )
        return _scope_result("completed", accumulator, generated, started)
    except StaleRevisionError:
        if generated is not None:
            _delete_generated_artifact(generated)
        return ScopeResult("stale", 0, 0, 0, 0, round((time.monotonic() - started) * 1000))
    except Exception as error:
        if completion_attempted:
            # A timed-out completion may already have activated this exact object.
            raise
        if generated is not None:
            _delete_generated_artifact(generated)
        rollup_error = _classified_error(error)
        _fail_scope(settings, claim, rollup_error, runtime_metrics)
        LOGGER.warning(
            "Heatmap rollup scope failed: %s",
            json.dumps(
                {
                    "scope_id": scope_id,
                    "source_revision": claim["source_revision"],
                    "error_code": rollup_error.error_code,
                    "retryable": rollup_error.retryable,
                },
                separators=(",", ":"),
                sort_keys=True,
            ),
        )
        return ScopeResult("failed", 0, 0, 0, 0, round((time.monotonic() - started) * 1000))
    finally:
        if generated is not None:
            generated.path.unlink(missing_ok=True)


def _claim_scopes(
    settings: Settings,
    runtime_metrics: RuntimeMetrics | None = None,
) -> list[Mapping[str, object]]:
    data = _api_request(
        settings,
        "POST",
        settings.claim_path,
        payload={"limit": 1},
        runtime_metrics=runtime_metrics,
    )
    processed = _processed_result(data)
    claims = processed.get("claims")
    if not isinstance(claims, list) or any(not isinstance(claim, Mapping) for claim in claims):
        raise _invalid_input("The heatmap claim response was invalid")
    return claims


def _list_inputs(
    settings: Settings,
    claim: Mapping[str, object],
    *,
    cursor: str | None,
    runtime_metrics: RuntimeMetrics | None = None,
) -> Mapping[str, object]:
    path = settings.input_path_template.format(scope_id=claim["scope_id"])
    query_values = [
        ("source_revision", str(claim["source_revision"])),
        ("limit", str(settings.input_page_limit)),
    ]
    if cursor is not None:
        query_values.append(("after_game_id", cursor))
    query = urllib.parse.urlencode(query_values)
    try:
        data = _api_request(
            settings,
            "GET",
            path,
            query=query,
            runtime_metrics=runtime_metrics,
        )
    except RollupError as error:
        if error.error_code == "api_conflict":
            raise StaleRevisionError from error
        raise
    return _processed_result(data)


def _complete_scope(
    settings: Settings,
    claim: Mapping[str, object],
    artifact: GeneratedArtifact,
    runtime_metrics: RuntimeMetrics | None = None,
) -> Mapping[str, object]:
    path = settings.complete_path_template.format(scope_id=claim["scope_id"])
    data = _api_request(
        settings,
        "POST",
        path,
        payload={
            "artifact": {
                "schema": ROLLUP_SCHEMA,
                "generation": claim["next_generation"],
                "source_revision": claim["source_revision"],
                "source_coordinate_space": SOURCE_COORDINATE_SPACE,
                "plane_coordinate_space": PLANE_COORDINATE_SPACE,
                "source_cell_size": SOURCE_CELL_SIZE,
                "metrics": list(METRICS),
                "s3_bucket": artifact.bucket,
                "s3_key": artifact.key,
                "content_type": "application/json",
                "encoding": "gzip",
                "size_bytes": artifact.size_bytes,
                "sha256": artifact.sha256,
                "summary": artifact.summary,
                "metadata": {"producer": WORKER_VERSION},
            }
        },
        runtime_metrics=runtime_metrics,
    )
    return _processed_result(data)


def _fail_scope(
    settings: Settings,
    claim: Mapping[str, object],
    error: RollupError,
    runtime_metrics: RuntimeMetrics | None = None,
) -> None:
    path = settings.failed_path_template.format(scope_id=claim["scope_id"])
    data = _api_request(
        settings,
        "PATCH",
        path,
        payload={
            "source_revision": claim["source_revision"],
            "error_code": error.error_code,
            "message": error.safe_message[:1000],
            "retryable": error.retryable,
            "retry_after_seconds": settings.retry_after_seconds,
        },
        runtime_metrics=runtime_metrics,
    )
    processed = _processed_result(data)
    if processed.get("stale") is True:
        return
    if processed.get("accepted") is not True:
        raise RollupError(
            "failure_callback_rejected",
            "The heatmap rollup failure callback was rejected",
            retryable=True,
        )


def _api_request(
    settings: Settings,
    method: str,
    path: str,
    *,
    query: str = "",
    payload: Mapping[str, object] | None = None,
    runtime_metrics: RuntimeMetrics | None = None,
) -> Mapping[str, object]:
    body = b"" if payload is None else json.dumps(
        payload,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    timestamp = str(int(time.time()))
    secret = _secret_value(settings.trusted_client_secret_id)
    signature = _hmac_signature(
        client=settings.trusted_client_name,
        timestamp=timestamp,
        method=method,
        raw_path=path,
        raw_query_string=query,
        body=body,
        secret=secret,
    )
    url = f"{settings.app_api_base_url}{path}"
    if query:
        url = f"{url}?{query}"
    headers = {
        "Accept": "application/json",
        "X-Halospawns-Client": settings.trusted_client_name,
        "X-Halospawns-Timestamp": timestamp,
        "X-Halospawns-Signature": f"sha256={signature}",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body if payload is not None else None, headers=headers, method=method)
    request_started = time.monotonic()
    if runtime_metrics is not None:
        runtime_metrics.api_requests += 1
    try:
        with urllib.request.urlopen(request, timeout=settings.request_timeout_seconds) as response:
            response_body = response.read()
    except urllib.error.HTTPError as error:
        error.read()
        if error.code == 409:
            raise RollupError(
                "api_conflict",
                "The heatmap rollup source revision changed",
                retryable=False,
            ) from error
        raise RollupError(
            "api_request_failed",
            "The heatmap rollup API request failed",
            retryable=error.code == 429 or error.code >= 500,
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise RollupError(
            "api_request_failed",
            "The heatmap rollup API request failed",
            retryable=True,
        ) from error
    finally:
        if runtime_metrics is not None:
            runtime_metrics.api_duration_ms += round((time.monotonic() - request_started) * 1000)
    try:
        envelope = json.loads(response_body)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise _invalid_input("The heatmap rollup API response was invalid") from error
    if not isinstance(envelope, Mapping) or envelope.get("ok") is not True:
        raise _invalid_input("The heatmap rollup API response was invalid")
    data = envelope.get("data")
    if not isinstance(data, Mapping):
        raise _invalid_input("The heatmap rollup API response data was invalid")
    return data


def _load_occupancy_artifact(
    settings: Settings,
    manifest: Mapping[str, object],
    runtime_metrics: RuntimeMetrics | None = None,
) -> tuple[Mapping[str, object], int]:
    _validate_input_manifest(settings, manifest)
    expected_size = _required_int(manifest, "size_bytes", minimum=1)
    expected_sha = _required_sha256(manifest, "sha256")
    encoding = _required_string(manifest, "encoding")

    response = None
    try:
        if runtime_metrics is not None:
            runtime_metrics.s3_gets += 1
        response = S3.get_object(
            Bucket=settings.uploads_bucket,
            Key=str(manifest["s3_key"]),
        )
        body = response["Body"]
        digest = hashlib.sha256()
        downloaded = 0
        with tempfile.NamedTemporaryFile(prefix="heatmap-input-", suffix=".json", delete=False) as target:
            compressed_path = Path(target.name)
            while True:
                chunk = body.read(DOWNLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                downloaded += len(chunk)
                if downloaded > MAX_INPUT_ARTIFACT_BYTES or downloaded > expected_size:
                    raise _invalid_artifact("An occupancy artifact exceeded its declared size")
                digest.update(chunk)
                target.write(chunk)
        if downloaded != expected_size or digest.hexdigest() != expected_sha:
            raise _invalid_artifact("An occupancy artifact did not match its manifest")
        raw = _decode_input_file(compressed_path, encoding=encoding)
        if runtime_metrics is not None:
            runtime_metrics.input_decoded_bytes += len(raw)
        try:
            document = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise _invalid_artifact("An occupancy artifact was not valid JSON") from error
        if not isinstance(document, Mapping):
            raise _invalid_artifact("An occupancy artifact document was invalid")
        return document, downloaded
    except (BotoCoreError, ClientError) as error:
        raise RollupError(
            "input_storage_request_failed",
            "A heatmap occupancy artifact could not be read",
            retryable=True,
        ) from error
    finally:
        if response is not None:
            response["Body"].close()
        if "compressed_path" in locals():
            compressed_path.unlink(missing_ok=True)


def _decode_input_file(path: Path, *, encoding: str) -> bytes:
    try:
        if encoding == "identity":
            with path.open("rb") as source:
                raw = source.read(MAX_DECOMPRESSED_INPUT_BYTES + 1)
        elif encoding == "gzip":
            with gzip.open(path, "rb") as source:
                raw = source.read(MAX_DECOMPRESSED_INPUT_BYTES + 1)
        else:
            raise _invalid_artifact("An occupancy artifact encoding was unsupported")
    except (gzip.BadGzipFile, EOFError, OSError) as error:
        raise _invalid_artifact("An occupancy artifact could not be decoded") from error
    if len(raw) > MAX_DECOMPRESSED_INPUT_BYTES:
        raise _invalid_artifact("An occupancy artifact exceeded its decoded size limit")
    return raw


def _write_rollup_artifact(
    *,
    settings: Settings,
    claim: Mapping[str, object],
    document: Mapping[str, object],
    output_key: str,
    summary: dict[str, int],
    cell_count: int,
) -> GeneratedArtifact:
    with tempfile.NamedTemporaryFile(prefix="heatmap-rollup-", suffix=".json.gz", delete=False) as target:
        path = Path(target.name)
        try:
            with gzip.GzipFile(
                filename="",
                fileobj=target,
                mode="wb",
                compresslevel=6,
                mtime=0,
            ) as compressed:
                writer = _BoundedJsonWriter(compressed, MAX_DECOMPRESSED_OUTPUT_BYTES)
                json.dump(document, writer, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
        except Exception:
            path.unlink(missing_ok=True)
            raise
    size_bytes = path.stat().st_size
    if size_bytes <= 0 or size_bytes > MAX_OUTPUT_ARTIFACT_BYTES:
        path.unlink(missing_ok=True)
        raise RollupError(
            "output_artifact_too_large",
            "The heatmap rollup output exceeded its supported size",
            retryable=False,
        )
    digest = _file_sha256(path)
    output_summary = {**summary, "decoded_size_bytes": writer.written}
    metadata = {
        "schema": ROLLUP_SCHEMA,
        "scope-id": str(claim["scope_id"]),
        "source-revision": str(claim["source_revision"]),
        "generation": str(claim["next_generation"]),
        "sha256": digest,
    }
    try:
        with path.open("rb") as source:
            S3.put_object(
                Bucket=settings.uploads_bucket,
                Key=output_key,
                Body=source,
                ContentLength=size_bytes,
                ContentType="application/json",
                ContentEncoding="gzip",
                ServerSideEncryption="AES256",
                Metadata=metadata,
                IfNoneMatch="*",
            )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in {"PreconditionFailed", "412"}:
            path.unlink(missing_ok=True)
            raise RollupError(
                "output_storage_request_failed",
                "The heatmap rollup output could not be written",
                retryable=True,
            ) from error
        try:
            _require_matching_existing_output(settings, output_key, size_bytes, digest)
        except Exception:
            path.unlink(missing_ok=True)
            raise
    except BotoCoreError as error:
        path.unlink(missing_ok=True)
        raise RollupError(
            "output_storage_request_failed",
            "The heatmap rollup output could not be written",
            retryable=True,
        ) from error
    return GeneratedArtifact(
        path=path,
        bucket=settings.uploads_bucket,
        key=output_key,
        size_bytes=size_bytes,
        sha256=digest,
        cell_count=cell_count,
        summary=output_summary,
        decoded_size_bytes=writer.written,
    )


class _BoundedJsonWriter:
    def __init__(self, target: BinaryIO, max_bytes: int) -> None:
        self.target = target
        self.max_bytes = max_bytes
        self.written = 0

    def write(self, value: str) -> int:
        encoded = value.encode("utf-8")
        self.written += len(encoded)
        if self.written > self.max_bytes:
            raise RollupError(
                "output_artifact_too_large",
                "The heatmap rollup output exceeded its supported size",
                retryable=False,
            )
        self.target.write(encoded)
        return len(value)


def _require_matching_existing_output(
    settings: Settings,
    key: str,
    size_bytes: int,
    sha256: str,
) -> None:
    try:
        existing = S3.head_object(Bucket=settings.uploads_bucket, Key=key)
    except (BotoCoreError, ClientError) as error:
        raise RollupError(
            "output_storage_request_failed",
            "The heatmap rollup output could not be verified",
            retryable=True,
        ) from error
    metadata = existing.get("Metadata") or {}
    if existing.get("ContentLength") != size_bytes or metadata.get("sha256") != sha256:
        raise RollupError(
            "immutable_generation_conflict",
            "A heatmap rollup generation already contained different content",
            retryable=False,
        )


def _mark_generation_active(
    settings: Settings,
    claim: Mapping[str, object],
    generated: GeneratedArtifact,
) -> None:
    try:
        S3.put_object_tagging(
            Bucket=generated.bucket,
            Key=generated.key,
            Tagging={"TagSet": [{"Key": "halospawns-rollup-state", "Value": "active"}]},
        )
        generation = int(claim["next_generation"])
        if generation > 1:
            previous_key = _rollup_key(settings.output_prefix, str(claim["scope_id"]), generation - 1)
            try:
                S3.put_object_tagging(
                    Bucket=generated.bucket,
                    Key=previous_key,
                    Tagging={"TagSet": [{"Key": "halospawns-rollup-state", "Value": "superseded"}]},
                )
            except ClientError as error:
                if error.response.get("Error", {}).get("Code") not in {"NoSuchKey", "404"}:
                    raise
    except (BotoCoreError, ClientError):
        # Activation already succeeded. Preserve readability and let lifecycle cleanup lag.
        LOGGER.exception("Heatmap rollup generation tags could not be updated")


def _delete_generated_artifact(artifact: GeneratedArtifact) -> None:
    try:
        S3.delete_object(Bucket=artifact.bucket, Key=artifact.key)
    except (BotoCoreError, ClientError):
        LOGGER.exception("A stale heatmap rollup generation could not be removed")


def _validate_input_manifest(settings: Settings, manifest: Mapping[str, object]) -> None:
    if _required_string(manifest, "schema") != INPUT_SCHEMA:
        raise _invalid_artifact("An occupancy artifact schema was unsupported")
    if _required_string(manifest, "coordinate_space") != SOURCE_COORDINATE_SPACE:
        raise _invalid_artifact("An occupancy artifact coordinate space was unsupported")
    cell_size = _finite_number(manifest, "cell_size", artifact=True)
    if not math.isclose(cell_size, SOURCE_CELL_SIZE):
        raise _invalid_artifact("An occupancy artifact cell size was unsupported")
    if _required_string(manifest, "s3_bucket") != settings.uploads_bucket:
        raise _invalid_artifact("An occupancy artifact bucket was not permitted")
    key = _required_string(manifest, "s3_key")
    if not key.startswith(settings.input_prefix):
        raise _invalid_artifact("An occupancy artifact key was not permitted")
    size = _required_int(manifest, "size_bytes", minimum=1, artifact=True)
    if size > MAX_INPUT_ARTIFACT_BYTES:
        raise _invalid_artifact("An occupancy artifact exceeded its size limit")
    _required_sha256(manifest, "sha256")


def _validate_occupancy_document(document: Mapping[str, object]) -> None:
    if document.get("schema") != INPUT_SCHEMA:
        raise _invalid_artifact("An occupancy artifact schema was unsupported")
    if document.get("coordinate_space") != SOURCE_COORDINATE_SPACE:
        raise _invalid_artifact("An occupancy artifact coordinate space was unsupported")
    cell_size = document.get("cell_size")
    if isinstance(cell_size, bool) or not isinstance(cell_size, (int, float)) or not math.isclose(float(cell_size), SOURCE_CELL_SIZE):
        raise _invalid_artifact("An occupancy artifact cell size was unsupported")
    occupancy = document.get("occupancy")
    if not isinstance(occupancy, list) or len(occupancy) > MAX_CELLS_PER_GROUP:
        raise _invalid_artifact("An occupancy artifact cell list was invalid")


def _validated_claim(claim: Mapping[str, object]) -> dict[str, object]:
    scope_type = _required_string(claim, "scope_type")
    if scope_type not in {"map", "player_map"}:
        raise _invalid_input("A heatmap claim scope type was invalid")
    player_id = claim.get("player_id")
    if player_id is not None and (not isinstance(player_id, str) or not player_id):
        raise _invalid_input("A heatmap claim player was invalid")
    if (scope_type == "map" and player_id is not None) or (scope_type == "player_map" and player_id is None):
        raise _invalid_input("A heatmap claim scope was invalid")
    eligibility = _required_string(claim, "eligibility")
    if eligibility not in {"public_stats", "validated"}:
        raise _invalid_input("A heatmap claim eligibility was invalid")
    return {
        "scope_id": _required_string(claim, "scope_id"),
        "scope_type": scope_type,
        "map_id": _required_string(claim, "map_id"),
        "player_id": player_id,
        "eligibility": eligibility,
        "source_revision": _required_int(claim, "source_revision", minimum=1),
        "built_revision": _required_int(claim, "built_revision", minimum=0),
        "next_generation": _required_int(claim, "next_generation", minimum=1),
    }


def _processed_result(data: Mapping[str, object]) -> Mapping[str, object]:
    processed = data.get("processed_result")
    if not isinstance(processed, Mapping):
        raise _invalid_input("The heatmap API result was invalid")
    return processed


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
    return hmac.new(secret.encode("utf-8"), canonical_request.encode("utf-8"), hashlib.sha256).hexdigest()


def _secret_value(secret_id: str) -> str:
    if secret_id not in SECRET_CACHE:
        try:
            response = SECRETS.get_secret_value(SecretId=secret_id)
        except (BotoCoreError, ClientError) as error:
            raise RollupError(
                "secret_read_failed",
                "The heatmap worker signing secret could not be read",
                retryable=True,
            ) from error
        secret = response.get("SecretString")
        if not isinstance(secret, str) or not secret:
            raise RollupError(
                "secret_read_failed",
                "The heatmap worker signing secret was empty",
                retryable=False,
            )
        SECRET_CACHE[secret_id] = secret
    return SECRET_CACHE[secret_id]


def _settings() -> Settings:
    return Settings(
        app_api_base_url=_required_env("APP_API_BASE_URL").rstrip("/"),
        trusted_client_name=_required_env("APP_API_TRUSTED_CLIENT_NAME"),
        trusted_client_secret_id=_required_env("APP_API_TRUSTED_CLIENT_HMAC_SECRET_ID"),
        uploads_bucket=_required_env("UPLOADS_BUCKET_NAME"),
        input_prefix=_prefix_env("SPATIAL_ARTIFACT_PREFIX", "replays/derived/spatial/"),
        output_prefix=_prefix_env("HEATMAP_ROLLUP_ARTIFACT_PREFIX", "replays/derived/heatmap-rollups/"),
        claim_path=os.getenv("APP_API_HEATMAP_ROLLUP_CLAIM_PATH", "/v1/ingest/heatmap-rollups/claim"),
        input_path_template=os.getenv("APP_API_HEATMAP_ROLLUP_INPUTS_PATH_TEMPLATE", "/v1/ingest/heatmap-rollups/{scope_id}/inputs"),
        complete_path_template=os.getenv("APP_API_HEATMAP_ROLLUP_COMPLETE_PATH_TEMPLATE", "/v1/ingest/heatmap-rollups/{scope_id}/complete"),
        failed_path_template=os.getenv("APP_API_HEATMAP_ROLLUP_FAILED_PATH_TEMPLATE", "/v1/ingest/heatmap-rollups/{scope_id}/failed"),
        input_page_limit=_bounded_int_env("HEATMAP_ROLLUP_INPUT_PAGE_LIMIT", 100, 1, 250),
        max_scopes_per_invocation=_bounded_int_env("HEATMAP_ROLLUP_MAX_SCOPES_PER_INVOCATION", 4, 1, 10),
        retry_after_seconds=_bounded_int_env("HEATMAP_ROLLUP_RETRY_AFTER_SECONDS", 300, 30, 86_400),
        request_timeout_seconds=_bounded_int_env("APP_API_REQUEST_TIMEOUT_SECONDS", 30, 1, 120),
    )


def _rollup_key(prefix: str, scope_id: str, generation: int) -> str:
    return f"{prefix}scopes/{scope_id}/generation-{generation}.json.gz"


def _scope_result(
    status: str,
    accumulator: RollupAccumulator,
    artifact: GeneratedArtifact,
    started: float,
) -> ScopeResult:
    return ScopeResult(
        status=status,
        input_games=accumulator.games_selected,
        input_bytes=accumulator.input_bytes,
        output_bytes=artifact.size_bytes,
        output_cells=artifact.cell_count,
        duration_ms=round((time.monotonic() - started) * 1000),
        output_decoded_bytes=artifact.decoded_size_bytes,
    )


def _classified_error(error: Exception) -> RollupError:
    if isinstance(error, RollupError):
        return error
    if isinstance(error, (BotoCoreError, ClientError, OSError)):
        return RollupError(
            "worker_runtime_failed",
            "The heatmap rollup worker encountered a temporary runtime failure",
            retryable=True,
        )
    return RollupError(
        "worker_unexpected_failure",
        "The heatmap rollup worker encountered an unexpected failure",
        retryable=False,
    )


def _invalid_input(message: str) -> RollupError:
    return RollupError("invalid_api_contract", message, retryable=False)


def _invalid_artifact(message: str) -> RollupError:
    return RollupError("invalid_occupancy_artifact", message, retryable=False)


def _required_string(values: Mapping[str, object], key: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value:
        raise _invalid_input(f"A required heatmap {key} value was invalid")
    return value


def _required_int(
    values: Mapping[str, object],
    key: str,
    *,
    minimum: int,
    artifact: bool = False,
) -> int:
    value = values.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        factory = _invalid_artifact if artifact else _invalid_input
        raise factory(f"A required heatmap {key} value was invalid")
    return value


def _finite_number(values: Mapping[str, object], key: str, *, artifact: bool = False) -> float:
    value = values.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        factory = _invalid_artifact if artifact else _invalid_input
        raise factory(f"A required heatmap {key} value was invalid")
    return float(value)


def _required_sha256(values: Mapping[str, object], key: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or len(value) != 64 or any(character not in "0123456789abcdefABCDEF" for character in value):
        raise _invalid_artifact("An occupancy artifact SHA-256 was invalid")
    return value.lower()


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RollupError(
            "worker_configuration_invalid",
            "The heatmap rollup worker configuration was incomplete",
            retryable=False,
        )
    return value.strip()


def _prefix_env(name: str, default: str) -> str:
    value = os.getenv(name, default).strip(" /")
    if not value:
        raise RollupError(
            "worker_configuration_invalid",
            "The heatmap rollup worker storage configuration was invalid",
            retryable=False,
        )
    return f"{value}/"


def _bounded_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise RollupError(
            "worker_configuration_invalid",
            "The heatmap rollup worker numeric configuration was invalid",
            retryable=False,
        ) from error
    if value < minimum or value > maximum:
        raise RollupError(
            "worker_configuration_invalid",
            "The heatmap rollup worker numeric configuration was invalid",
            retryable=False,
        )
    return value


def _group_sort_key(group: tuple[int, int]) -> tuple[int, int]:
    return group


def _plane_cell(cell_x: int, cell_y: int) -> tuple[int, int]:
    if not (-2_000_001 <= cell_x <= 2_000_000 and -2_000_001 <= cell_y <= 2_000_000):
        raise _invalid_input("A heatmap cell was outside the supported coordinate bounds")
    return cell_x, cell_y


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(DOWNLOAD_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _remaining_time_ms(context: object) -> int:
    getter = getattr(context, "get_remaining_time_in_millis", None)
    return int(getter()) if callable(getter) else 900_000


def _process_peak_rss_kib() -> int | None:
    if resource is None:
        return None
    try:
        return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    except (AttributeError, OSError, ValueError):
        return None


def _emit_metrics(totals: Mapping[str, int], *, duration_ms: int) -> None:
    metric_values = {
        "ScopesCompleted": totals["completed"],
        "ScopesStale": totals["stale"],
        "ScopesFailed": totals["failed"],
        "InputGames": totals["input_games"],
        "InputBytes": totals["input_bytes"],
        "InputDecodedBytes": totals["input_decoded_bytes"],
        "OutputBytes": totals["output_bytes"],
        "OutputDecodedBytes": totals["output_decoded_bytes"],
        "OutputCells": totals["output_cells"],
        "S3Gets": totals["s3_gets"],
        "ApiRequests": totals["api_requests"],
        "ApiDuration": totals["api_duration_ms"],
        "InvocationDuration": duration_ms,
        "ProcessPeakRssKiB": _process_peak_rss_kib() or 0,
    }
    print(
        json.dumps(
            {
                "_aws": {
                    "Timestamp": int(time.time() * 1000),
                    "CloudWatchMetrics": [
                        {
                            "Namespace": "Halospawns/HeatmapRollups",
                            "Dimensions": [["Worker"]],
                            "Metrics": [
                                {
                                    "Name": name,
                                    "Unit": (
                                        "Milliseconds"
                                        if name in {"InvocationDuration", "ApiDuration"}
                                        else "Bytes"
                                        if name in {
                                            "InputBytes",
                                            "InputDecodedBytes",
                                            "OutputBytes",
                                            "OutputDecodedBytes",
                                        }
                                        else "Kilobytes"
                                        if name == "ProcessPeakRssKiB"
                                        else "Count"
                                    ),
                                }
                                for name in metric_values
                            ],
                        }
                    ],
                },
                "Worker": WORKER_VERSION,
                **metric_values,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
