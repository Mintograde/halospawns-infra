"""Version-pinned H1 intake, with no caller-selected commands or filesystem paths."""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from . import analytics, recorded
from .registry import IDENTITY, load_registry, select_exporter

PACKAGE = Path(__file__).parent
NODE_ROOT = Path(os.getenv("H1_NODE_ROOT", str(PACKAGE)))
LOGGER = logging.getLogger(__name__)
FAILURES = {
    "unsupported_build",
    "missing_map",
    "ambiguous_map",
    "ineligible_map",
    "validation_failed",
    "conversion_failed",
}
FULL_OUTPUTS = {
    "viewer_artifact",
    "game",
    "participants",
    "stats",
    "spawn_points",
    "game_meta",
    "graph_context",
    "spatial_artifact",
}
PLAYBACK = {"tick_rate": 120, "source_tick_rate": 120, "animation_tick_rate": 30}
SOURCE_PREFIX = "films/unprocessed/"
UNKNOWN_RECORDED_AT = "1970-01-01T00:00:00Z"
_CLIENTS_CONFIGURED = False


class FilmError(Exception):
    def __init__(self, reason="validation_failed", *, retryable=False):
        super().__init__(reason)
        self.reason = reason
        self.retryable = retryable


def shared_parser():
    global _CLIENTS_CONFIGURED
    parser_path = str(PACKAGE.parent / "replay_parser")
    if parser_path not in sys.path:
        sys.path.insert(0, parser_path)
    from replay_parser import handler

    if not _CLIENTS_CONFIGURED:
        import boto3
        from botocore.config import Config

        config = Config(
            connect_timeout=5,
            read_timeout=20,
            retries={"mode": "standard", "total_max_attempts": 2},
        )
        handler.S3 = boto3.client("s3", config=config)
        handler.SSM = boto3.client("ssm", config=config)
        _CLIENTS_CONFIGURED = True
    return handler


def require(condition, reason="validation_failed"):
    if not condition:
        raise FilmError(reason)


def validate_schema(name, value):
    schema = analytics._json(PACKAGE / "contracts" / f"h1film-{name}.v1.schema.json")
    require(
        Draft202012Validator(schema, format_checker=FormatChecker()).is_valid(value)
    )


def limits():
    result = {}
    for name, ceiling in (
        ("SIZE_BYTES", 536870912),
        ("SOURCE_TICKS", 432000),
        ("PLAYERS", 4),
    ):
        value = int(os.environ[f"H1_MAX_{name}"])
        require(0 < value <= ceiling)
        result[name] = value
    return result


def validate_source(source, *, raw_map=False):
    require(isinstance(source, dict))
    require(source.get("s3_bucket") == os.environ["H1_UPLOADS_BUCKET"])
    key = source.get("s3_key", "")
    require(isinstance(key, str) and 0 < len(key) <= 1024 and "\\" not in key)
    require(not any(part in {"", ".", ".."} for part in key.split("/")))
    if raw_map:
        require(
            key.startswith(("maps/unprocessed/", "maps/processed/"))
            and key.lower().endswith(".map")
        )
    else:
        require(key.startswith(SOURCE_PREFIX) and key.lower().endswith(".h1film"))
    version = source.get("s3_version_id")
    require(
        isinstance(version, str)
        and 0 < len(version) <= 1024
        and version.lower() != "null"
    )
    if "size_bytes" in source:
        require(
            type(source["size_bytes"]) is int
            and 0
            < source["size_bytes"]
            <= (256 * 1024 * 1024 if raw_map else limits()["SIZE_BYTES"])
        )
    if "sha256" in source:
        require(
            isinstance(source["sha256"], str)
            and re.fullmatch(r"[0-9a-f]{64}", source["sha256"])
        )


def validate_job(job):
    validate_schema("job", job)
    versioned = job["schema"] == "halospawns.h1film_job.v2"
    require(versioned == (job.get("analytics_revision") is not None))
    require(job["environment"] == os.environ["ENVIRONMENT"] == "dev")
    conversion = job["conversion"]
    film, engine, binding = (
        conversion[key] for key in ("film", "engine", "map_binding")
    )
    profile = load_registry().get(film["engine_profile"])
    require(profile is not None, "unsupported_build")
    exporter = engine.get("exporter_revision")
    require(exporter is None or versioned, "unsupported_build")
    try:
        profile = select_exporter(profile, exporter)
    except ValueError as error:
        raise FilmError("unsupported_build") from error
    require(
        all(
            engine.get(key) == profile[key]
            for key in (*IDENTITY, "wasm_sha256", "glue_sha256")
        )
    )
    require(all(film.get(key) == profile[key] for key in IDENTITY))
    require(
        film["source_tick_count"] <= limits()["SOURCE_TICKS"]
        and film["player_count"] <= limits()["PLAYERS"]
    )
    require(
        binding["engine_profile"] == profile["id"]
        and binding["scenario"] == film["scenario"]
    )
    require(binding["raw_source"]["size_bytes"] == film["map_size_bytes"])
    validate_source(conversion["source"])
    validate_source(binding["raw_source"], raw_map=True)
    generation = job["attempt_id"] or job["upload_id"]
    require(job["generation_token"] == generation)
    require(job["job_id"] == f"h1film:{job['upload_id']}:generation:{generation}")
    require(upload_id_from_key(conversion["source"]["s3_key"]) == job["upload_id"])
    target = job["viewer_artifact_target"]
    require(type(target.get("request_epoch")) is int and target["request_epoch"] >= 0)
    require(
        type(target.get("request_sequence")) is int and target["request_sequence"] >= 0
    )
    if job["attempt_id"] is None:
        require(
            job["trigger"] == "initial_intake"
            and job["replay_id"] is None
            and job["game_id"] is None
        )
        require(
            job["mode"] == "full_reparse"
            and target["request_epoch"] == target["request_sequence"] == 0
        )
    else:
        require(
            job["trigger"] == "manual_reprocess"
            and job["replay_id"] is not None
            and target["request_sequence"] > 0
        )
    outputs = job["requested_outputs"]
    require(len(outputs) == len(set(outputs)))
    require(
        set(outputs)
        == (FULL_OUTPUTS if job["mode"] == "full_reparse" else {"viewer_artifact"})
    )
    request = shared_parser()._viewer_request_from_payload(
        target, attempt_id=generation
    )
    require(request.profile_revision in (1, 2, 3, 4), "unsupported_build")
    return request


def upload_id_from_key(key):
    require(isinstance(key, str) and key.startswith(SOURCE_PREFIX))
    name = key[len(SOURCE_PREFIX) :]
    require(len(name) > 37 and name[36] == "-" and "/" not in name)
    try:
        value = str(uuid.UUID(name[:36]))
    except ValueError as error:
        raise FilmError() from error
    require(name[:36] == value)
    return value


def work_from_record(record):
    require(
        record.get("eventSource") == "aws:sqs"
        and record.get("eventSourceARN") == os.environ["H1_QUEUE_ARN"]
    )
    body = record.get("body")
    require(isinstance(body, str) and len(body.encode()) <= 256 * 1024)
    payload = json.loads(body)
    require(isinstance(payload, dict))
    if payload.get("schema") in {"halospawns.h1film_job.v1", "halospawns.h1film_job.v2"}:
        validate_job(payload)
        return payload
    require(
        payload.get("Type") == "Notification"
        and payload.get("TopicArn") == os.environ["H1_TOPIC_ARN"]
    )
    require(
        isinstance(payload.get("Message"), str)
        and len(payload["Message"]) <= 128 * 1024
    )
    event = json.loads(payload["Message"])
    # S3 sends this exact setup event when a notification is provisioned.
    if event.get("Event") == "s3:TestEvent":
        require(
            event.get("Service") == "Amazon S3"
            and event.get("Bucket") == os.environ["H1_UPLOADS_BUCKET"]
        )
        return None
    records = event.get("Records")
    require(isinstance(records, list) and len(records) == 1)
    item = records[0]
    require(
        item.get("eventSource") == "aws:s3"
        and item.get("eventName", "").startswith("ObjectCreated:")
    )
    obj = item["s3"]["object"]
    source = {
        "s3_bucket": item["s3"]["bucket"]["name"],
        "s3_key": urllib.parse.unquote_plus(obj["key"]),
        "s3_version_id": obj.get("versionId"),
        "size_bytes": obj.get("size"),
    }
    validate_source(source)
    return {"upload_id": upload_id_from_key(source["s3_key"]), "source": source}


def download(source, path, *, raw_map=False, metadata=None):
    validate_source(source, raw_map=raw_map)
    s3 = shared_parser().S3
    args = {
        "Bucket": source["s3_bucket"],
        "Key": source["s3_key"],
        "VersionId": source["s3_version_id"],
    }
    head = s3.head_object(**args)
    size = head["ContentLength"]
    bound = 256 * 1024 * 1024 if raw_map else limits()["SIZE_BYTES"]
    require(0 < size <= bound and size == source["size_bytes"])
    require(head.get("VersionId") == source["s3_version_id"])
    if not raw_map:
        require(
            head.get("ContentType")
            in {"application/octet-stream", "application/x-h1film"}
        )
    digest, count = hashlib.sha256(), 0
    response = s3.get_object(**args)
    require(
        response.get("VersionId") == source["s3_version_id"]
        and response["ContentLength"] == size
    )
    with response["Body"] as stream, path.open("xb") as target:
        while chunk := stream.read(1024 * 1024):
            count += len(chunk)
            require(count <= size)
            digest.update(chunk)
            target.write(chunk)
    require(count == size)
    actual = digest.hexdigest()
    require("sha256" not in source or source["sha256"] == actual)
    if metadata is not None:
        metadata.update(
            content_type=head.get("ContentType"), metadata=head.get("Metadata", {})
        )
    return {**source, "sha256": actual}


def child_environment():
    # The simulator must never inherit Lambda credentials, HMAC configuration,
    # preload hooks or user-supplied compiler/export flags.
    return {
        key: value
        for key, value in {
            "PATH": os.environ.get("PATH", ""),
            "LANG": "C.UTF-8",
            "TZ": "UTC",
            "H1_ENGINE_ROOT": os.environ.get("H1_ENGINE_ROOT", ""),
            "HOME": "/tmp",
            "TMPDIR": "/tmp",
            "SystemRoot": os.environ.get("SystemRoot"),
        }.items()
        if value is not None
    }


def group_rss_kib(group):
    if sys.platform != "linux":
        return 0
    rss = 0
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            data = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            if int(data[2]) == group:
                rss += (
                    int((entry / "statm").read_text().split()[1])
                    * os.sysconf("SC_PAGE_SIZE")
                    // 1024
                )
        except (OSError, ValueError, IndexError):
            continue
    return rss


def work_bytes(work):
    total = 0
    for path in work.rglob("*"):
        try:
            if not path.is_file():
                continue
            size = path.stat().st_size
        except FileNotFoundError:
            # The converter atomically renames its completed staging directory.
            continue
        require(path.suffix != ".log" or size < 8 * 1024**2, "conversion_failed")
        total += size
    require(total < 6 * 1024**3, "conversion_failed")
    return total


def run_bounded(
    arguments, work, deadline, *, output_name="command.log", allow_failure=False
):
    require(deadline > time.monotonic(), "conversion_failed")
    output = work / output_name
    peak_rss, peak_disk = 0, 0
    with output.open("xb") as log:
        process = subprocess.Popen(
            arguments,
            cwd=work,
            env=child_environment(),
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=sys.platform != "win32",
        )
        try:
            while process.poll() is None:
                peak_rss = max(peak_rss, group_rss_kib(process.pid))
                peak_disk = max(peak_disk, work_bytes(work))
                require(
                    time.monotonic() < deadline and peak_rss < 2400 * 1024,
                    "conversion_failed",
                )
                time.sleep(0.25)
        finally:
            if sys.platform == "win32":
                if process.poll() is None:
                    process.kill()
            else:
                # Also reap descendants if the orchestrator exited first.
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
    peak_disk = max(peak_disk, work_bytes(work))
    LOGGER.info(
        "h1_process_metrics %s",
        json.dumps(
            {
                "process": Path(arguments[0]).name,
                "peak_rss_kib": peak_rss,
                "peak_work_bytes": peak_disk,
                "exit_code": process.returncode,
            }
        ),
    )
    require(allow_failure or process.returncode == 0, "conversion_failed")
    require(output.stat().st_size <= 8 * 1024**2, "conversion_failed")
    return output


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise FilmError("retry_pending", retryable=True)


def api(method, path, payload):
    shared = shared_parser()
    settings = shared._settings()
    base = urllib.parse.urlsplit(settings["app_api_base_url"])
    require(
        base.scheme == "https"
        and base.hostname == "api.dev.halospawns.com"
        and base.port in {None, 443}
        and not base.username
        and not base.password
        and base.path in {"", "/"}
        and not base.query
        and not base.fragment
    )
    body = json.dumps(
        payload, separators=(",", ":"), sort_keys=True, allow_nan=False
    ).encode()
    timestamp = str(int(time.time()))
    signature = shared._hmac_signature(
        client="h1-film",
        timestamp=timestamp,
        method=method,
        raw_path=path,
        raw_query_string="",
        body=body,
        secret=shared._signing_secret(settings),
    )
    request = urllib.request.Request(
        settings["app_api_base_url"].rstrip("/") + path,
        data=body,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-Halospawns-Client": "h1-film",
            "X-Halospawns-Timestamp": timestamp,
            "X-Halospawns-Signature": f"sha256={signature}",
        },
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(
            request, timeout=30
        ) as response:
            raw = response.read(8 * 1024**2 + 1)
            require(len(raw) <= 8 * 1024**2)
            result = json.loads(raw)
            require(isinstance(result, dict))
            return result
    except urllib.error.HTTPError as error:
        try:
            reason = json.loads(error.read(64 * 1024)).get("error", {}).get("code")
        except (ValueError, AttributeError):
            reason = None
        if reason in FAILURES:
            raise FilmError(reason) from error
        if reason in {"stale_attempt", "identity_conflict"}:
            raise FilmError(reason) from error
        # Configuration/auth/callback failures must not mark a valid film corrupt.
        raise FilmError("retry_pending", retryable=True) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise FilmError("retry_pending", retryable=True) from error


def inspect_film(path, work, deadline):
    log = run_bounded(
        ["node", str(NODE_ROOT / "runtime/inspect.mjs"), str(path)],
        work,
        min(deadline, time.monotonic() + 15),
        output_name="inspect.log",
        allow_failure=True,
    )
    result = analytics._json(log, 64 * 1024)
    if "error" in result:
        raise FilmError(
            result["error"] if result["error"] in FAILURES else "validation_failed"
        )
    env = result["envelope"]
    require(
        env["ticks"] <= limits()["SOURCE_TICKS"]
        and env["players"] <= limits()["PLAYERS"]
    )
    require(0 < env["map_bytes"] <= 256 * 1024**2)
    return {
        "engine_profile": result["profile"],
        **{key: env[key] for key in IDENTITY},
        "scenario": env["map"],
        "map_size_bytes": env["map_bytes"],
        "source_tick_count": env["ticks"],
        "player_count": env["players"],
        "hash_sample_count": env["hash_samples"],
    }


def convert(job, film, work, deadline):
    binding = job["conversion"]["map_binding"]
    (work / "maps").mkdir()
    download(
        binding["raw_source"],
        work / "maps" / f"{binding['scenario']}.map",
        raw_map=True,
    )
    catalog = {
        "schema": "halospawns.h1FilmMapCatalog.v1",
        "maps": [
            {
                "engine_profile": binding["engine_profile"],
                "scenario": binding["scenario"],
                "size_bytes": binding["raw_source"]["size_bytes"],
                "sha256": binding["raw_source"]["sha256"],
                "map_id": binding["map_id"],
                "game_release_key": binding["game_release_key"],
            }
        ],
    }
    (work / "maps.json").write_text(json.dumps(catalog), encoding="utf-8")
    timeout = int(deadline - time.monotonic() - 180)
    require(timeout >= 30, "conversion_failed")
    directory = work / "conversion"
    run_bounded(
        [
            "node",
            str(NODE_ROOT / "convert.mjs"),
            "--film",
            str(film),
            "--assets",
            str(work),
            "--encoder",
            str(NODE_ROOT / "bin/h1-film-encoder"),
            "--output",
            str(directory),
            "--map-catalog",
            str(work / "maps.json"),
            "--profile",
            binding["engine_profile"],
            "--trusted-local",
            "--skip-readback",
            "--source-viewer-only",
            "--analytics",
            "--analytics-revision",
            str(job.get("analytics_revision") or 2),
            "--viewer-revision",
            str(job["viewer_artifact_target"]["profile_revision"]),
            *(["--exporter-revision", str(job["conversion"]["engine"]["exporter_revision"])]
              if job["conversion"]["engine"].get("exporter_revision") is not None else []),
            "--engine-permissions",
            "--timeout",
            str(timeout),
        ],
        work,
        deadline - 180,
        output_name="convert.log",
    )
    # The encoder compares every decoded tick to its source and checks every
    # compressed chunk. Require that evidence before omitting the second scan.
    ticks = job["conversion"]["film"]["source_tick_count"]
    encoding = analytics._json(directory / "candidate/encoding.json")
    require(encoding.get("verification") == {
        "mode": "inline-bounded-poses" if job["viewer_artifact_target"]["profile_revision"] == 4 else "inline-lossless",
        "120hz": ticks, "30hz": None,
    }, "conversion_failed")
    return directory


def completion_proof(job, report, encoding):
    pin = job["conversion"]
    film = pin["film"]
    simulation = report["simulation"]
    require(report["map_binding"]["map_id"] == pin["map_binding"]["map_id"])
    proof = {
        "conversion_id": pin["conversion_id"],
        "engine_profile": film["engine_profile"],
        "wasm_sha256": report["provenance"]["wasm_sha256"],
        "glue_sha256": report["provenance"]["glue_sha256"],
        "raw_map_sha256": report["provenance"]["map_sha256"],
        "source_tick_count": film["source_tick_count"],
        "played_tick_count": simulation["played_ticks"],
        "hash_checks": simulation["hash_checks"],
        "expected_hash_checks": film["hash_sample_count"],
        "hash_mismatches": simulation["hash_mismatches"],
        "seed_mismatches": simulation["seed_mismatches"],
        "recording_duration_seconds": film["source_tick_count"] / film["tick_rate"],
        "match_end_source_tick": encoding["analytics"].get("match_end_source_tick"),
        "recording_complete": False,
        "analytics_revision": encoding.get("analytics_revision", 1),
    }
    if pin["engine"].get("exporter_revision") is not None:
        proof["exporter_revision"] = pin["engine"]["exporter_revision"]
    if proof["analytics_revision"] == 3:
        # The format reader validates the closed trailer separately from simulation.
        require(report["envelope"]["end_reason"] in (1, 2))
        proof["recording_closed"] = True
        start = recorded.match_start(report, encoding)
        if start is not None:
            proof["match_start_source_tick"] = start
    validate_proof(pin, proof, analytics_revision=job.get("analytics_revision"))
    return proof


def validate_proof(pin, proof, *, analytics_revision=None):
    validate_schema("completion", proof)
    require(
        proof.get("analytics_revision", 1) == analytics_revision
        if analytics_revision is not None else proof.get("analytics_revision", 1) < 3
    )
    require(proof.get("exporter_revision") == pin["engine"].get("exporter_revision"))
    require(
        proof["conversion_id"] == pin["conversion_id"]
        and proof["engine_profile"] == pin["film"]["engine_profile"]
    )
    require(proof["raw_map_sha256"] == pin["map_binding"]["raw_source"]["sha256"])
    require(
        all(proof[key] == pin["engine"][key] for key in ("wasm_sha256", "glue_sha256"))
    )
    require(
        proof["source_tick_count"]
        == proof["played_tick_count"]
        == pin["film"]["source_tick_count"]
    )
    require(
        proof["hash_checks"]
        == proof["expected_hash_checks"]
        == pin["film"]["hash_sample_count"]
    )
    require(
        abs(proof["recording_duration_seconds"] - proof["source_tick_count"] / 120)
        < 0.000001
    )
    require(
        proof["match_end_source_tick"] is None
        or proof["match_end_source_tick"] < proof["source_tick_count"]
    )


def build_products(job, film, directory, work, deadline, source_metadata):
    shared = shared_parser()
    request = validate_job(job)
    source = job["conversion"]["source"]
    report, encoding, sidecar = analytics.verified_products(
        directory, film_sha256=source["sha256"]
    )
    proof = completion_proof(job, report, encoding)
    extractor = shared._native_extractor_path()
    extracted = work / "analytics-extracted.json"
    run_bounded(
        [
            str(extractor),
            "--input",
            str(sidecar),
            "--output",
            str(extracted),
            "--cell-size",
            "0.5",
        ],
        work,
        deadline - 90,
        output_name="extract.log",
    )
    parsed = shared._parsed_replay_from_document(
        shared._replay_document_from_native(analytics._json(extracted, 64 * 1024**2)),
        parse_started=time.perf_counter(),
    )
    parsed = analytics.adapt_parsed_replay(parsed, report=report, encoding=encoding)
    parsed.game["metadata"]["is_full_game"] = False
    parsed.metadata["summary"]["is_full_game"] = False
    parsed.metadata["h1_film"]["recorded_at_authoritative"] = False
    parts = shared.load_native_viewer_parts(
        directory / "candidate/parts-120",
        native_binary_path=extractor,
        revision=request.profile_revision,
    )
    # The released manifest requires a timestamp. This stable sentinel is not
    # game UTC; the API's availability contract marks recorded UTC unavailable.
    container = shared.assemble_viewer_container(
        parts,
        work / "viewer.hsrdc",
        replay_id=job["upload_id"],
        recorded_at=UNKNOWN_RECORDED_AT,
    )
    require(container.tick_count == proof["source_tick_count"])
    viewer = shared._write_viewer_artifact(
        bucket=source["s3_bucket"],
        upload_id=job["upload_id"],
        source_replay_sha256=source["sha256"],
        source_size_bytes=source["size_bytes"],
        request=request,
        mode=job["mode"] if job["attempt_id"] else "initial",
        parts=parts,
        container=container,
    )
    viewer["playback"] = dict(PLAYBACK)
    if job["mode"] == "viewer_rebuild":
        return "/v1/ingest/replay-viewer-artifacts", {
            "replay_file_id": job["replay_id"],
            "upload_id": job["upload_id"],
            "reprocess_attempt_id": job["attempt_id"],
            "source_replay_sha256": source["sha256"],
            "viewer_artifact": viewer,
            "source_kind": "h1film",
            "h1film": proof,
        }
    spatial = shared._write_spatial_artifact(
        parsed=parsed,
        bucket=source["s3_bucket"],
        upload_id=job["upload_id"],
        generation=shared._reprocess_spatial_generation(job["attempt_id"])
        if job["attempt_id"]
        else 1,
        source_replay_sha256=source["sha256"],
    )
    payload = shared._replay_finalization_payload(
        upload_id=job["upload_id"],
        source_external_id=job["upload_id"],
        original_object=shared.S3ReplayObject(
            bucket=source["s3_bucket"],
            key=source["s3_key"],
            event_name="h1film",
            sqs_message_id="h1film",
        ),
        processed_key=source["s3_key"],
        downloaded=shared.DownloadedReplay(
            path=film,
            content_type=source_metadata["content_type"],
            size_bytes=source["size_bytes"],
            sha256=source["sha256"],
            metadata={},
            version_id=source["s3_version_id"],
        ),
        parsed=parsed,
        reprocess_attempt_id=job["attempt_id"],
        viewer_artifact=viewer,
        spatial_artifact=spatial,
    )
    payload.update(source_kind="h1film", h1film=proof)
    if proof["analytics_revision"] == 3:
        native = encoding["native_analytics"]
        validate_schema("native-analytics", native)
        analytics.validate_native_product(native, encoding=encoding, report=report)
        payload["h1film_analytics"] = {
            **native, "kill_attribution": recorded.kill_attribution(film, report=report, encoding=encoding),
            "resolved_variant": recorded.resolved_variant(film, encoding=encoding),
        }
        validate_schema("native-analytics", payload["h1film_analytics"])
    return "/v1/ingest/replay-uploads", payload


def replay_completion(job):
    shared = shared_parser()
    pin = job["conversion"]
    key = shared._completion_manifest_key(job["upload_id"], job["generation_token"])
    found = shared.S3.list_objects_v2(
        Bucket=pin["source"]["s3_bucket"], Prefix=key, MaxKeys=1
    )
    if not any(item["Key"] == key for item in found.get("Contents", [])):
        return False
    manifest = shared._load_completion_manifest(
        bucket=pin["source"]["s3_bucket"], key=key
    )
    shared._validate_completion_manifest(
        manifest,
        upload_id=job["upload_id"],
        generation_token=job["generation_token"],
        expected_mode=job["mode"] if job["attempt_id"] else "initial",
        expected_source_replay_sha256=pin["source"]["sha256"],
        expected_profile_revision=job["viewer_artifact_target"]["profile_revision"],
    )
    payload = manifest["callback"]["payload"]
    proof = payload.get("h1film")
    validate_proof(pin, proof, analytics_revision=job.get("analytics_revision"))
    require(payload.get("source_kind") == "h1film" and "cleanup_object" not in manifest)
    require(payload["viewer_artifact"].get("playback") == PLAYBACK)
    for key in ("generation_token", "request_epoch", "request_sequence"):
        require(
            payload["viewer_artifact"].get(key) == job["viewer_artifact_target"][key]
        )
    path = (
        "/v1/ingest/replay-viewer-artifacts"
        if job["mode"] == "viewer_rebuild"
        else "/v1/ingest/replay-uploads"
    )
    require(manifest["callback"]["path"] == path)
    api("POST", path, payload)
    return True


def execute(work_item, context):
    started = time.monotonic()
    deadline = started + min(context.get_remaining_time_in_millis() / 1000 - 10, 890)
    with tempfile.TemporaryDirectory(prefix="h1-job-") as temporary:
        work = Path(temporary)
        job = work_item if "conversion" in work_item else None
        if job is not None:
            validate_job(job)
            if replay_completion(job):
                return
        source = work_item["conversion"]["source"] if job else work_item["source"]
        film = work / "input.h1film"
        source_metadata = {}
        source = download(source, film, metadata=source_metadata)
        evidence = inspect_film(film, work, deadline)
        if job is None:
            prepare = {"upload_id": work_item["upload_id"], "source": source, "film": evidence}
            try:
                result = api("POST", "/v1/ingest/h1films/prepare", {
                    **prepare, "analytics_revision": 3, "exporter_revision": 2,
                })
            except FilmError as error:
                if error.reason != "identity_conflict":
                    raise
                # A redelivered notification can belong to an already pinned
                # legacy job. Omission retrieves that job without repinning it;
                # the API still checks the complete original source identity.
                result = api("POST", "/v1/ingest/h1films/prepare", prepare)
            job = result["data"]["job"]
            validate_job(job)
            require(
                job["upload_id"] == work_item["upload_id"] and job["attempt_id"] is None
            )
        require(
            job["conversion"]["source"] == source
            and job["conversion"]["film"] == evidence
        )
        if replay_completion(job):
            return
        directory = convert(job, film, work, deadline)
        path, payload = build_products(
            job, film, directory, work, deadline, source_metadata
        )
        shared = shared_parser()
        manifest = shared._completion_manifest(
            upload_id=job["upload_id"],
            generation_token=job["generation_token"],
            mode=job["mode"] if job["attempt_id"] else "initial",
            source_replay_sha256=source["sha256"],
            callback_path=path,
            callback_payload=payload,
            cleanup_object=None,
        )
        shared._put_immutable_json(
            bucket=source["s3_bucket"],
            key=shared._completion_manifest_key(
                job["upload_id"], job["generation_token"]
            ),
            value=manifest,
        )
        # Re-read and validate the winner before dispatch, including concurrent retries.
        require(replay_completion(job))
    LOGGER.info(
        "h1_job_completed %s",
        json.dumps(
            {
                "upload_id": job["upload_id"],
                "generation": job["generation_token"],
                "seconds": round(time.monotonic() - started, 3),
            }
        ),
    )


def report_failure(item, error):
    if error.reason in {"stale_attempt", "identity_conflict"}:
        return
    reason = error.reason if error.reason in FAILURES else "retry_pending"
    if item.get("attempt_id"):
        path = f"/v1/ingest/replay-reprocess-attempts/{item['attempt_id']}/status"
        payload = {"status": "failed", "h1film_error": reason, "error_message": reason}
    else:
        path = f"/v1/uploads/{item['upload_id']}/processing-status"
        payload = {
            "status": "failed",
            "h1film_error": reason,
            "processing_error": reason,
        }
    api("PATCH", path, payload)
