"""Separately authorized client tracks; never enter host/statistics finalization."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

from . import analytics, cloud
from .registry import load_registry, matches_film, select_exporter

CONTRACT = "halospawns.h1ClientView.v1"
DISPATCH = "halospawns.h1ClientViewDispatch.v1"
SOURCE_PREFIX = "films/client-views/unprocessed/"
API = "/v1/ingest/h1films/client-views"
PROFILE = "h1-performance-beta5-p9818-wasm-v1"
TERMINAL = {"completed", "failed"}
FAILURES = {"invalid_source", "association_mismatch", "verification_failed",
            "conversion_failed", "artifact_failed"}


def require(condition, reason="association_mismatch"):
    cloud.require(condition, reason)


def identifier(value):
    try:
        require(isinstance(value, str) and str(uuid.UUID(value)) == value)
    except (ValueError, TypeError, AttributeError) as error:
        raise cloud.FilmError("invalid_source") from error
    return value


def upload_id_from_key(key):
    require(isinstance(key, str) and key.startswith(SOURCE_PREFIX), "invalid_source")
    parts = key[len(SOURCE_PREFIX):].split("/")
    require(len(parts) == 2 and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_. -]{0,180}\.h1film", parts[1]),
            "invalid_source")
    return identifier(parts[0])


def validate_dispatch(item):
    require(set(item) == {"schema", "upload_id", "attempt_id"}, "invalid_source")
    require(item["schema"] == DISPATCH, "invalid_source")
    identifier(item["upload_id"])
    identifier(item["attempt_id"])


def recipes():
    registry = analytics._json(cloud.PACKAGE / "profiles/registry.json")
    require(registry["processing"]["requirements"].get("client_view") == CONTRACT)
    return registry["processing"]["client_view_recipes"][PROFILE]


def validate_association(evidence):
    cloud.validate_schema("client-view-prepare", evidence)
    client, host, clock = (evidence[k] for k in ("client", "host", "clock_host"))
    require(client["recording_role"] == "client" and host["recording_role"] == clock["recording_role"] == "host")
    require(client["match_id"] != "0000000000000000")
    require(client["recorded_own_player"] == clock["recorded_own_player"] == evidence["diagnostic_recorded_own_player"])
    require(client["source"]["sha256"] != clock["source"]["sha256"])
    for item in (client, host, clock):
        film = item["film"]
        require(film["engine_profile"] == PROFILE and film["source_tick_count"] <= cloud.limits()["SOURCE_TICKS"]
                and film["player_count"] <= cloud.limits()["PLAYERS"])
        require(matches_film(load_registry()[PROFILE], film))
        require(item["match_id"] == client["match_id"] and item["raw_map_sha256"] == client["raw_map_sha256"]
                and film["scenario"] == client["film"]["scenario"])
        cloud.validate_source(item["source"], client_view=item["recording_role"] == "client")
    if host["source"] == clock["source"]:
        require(host == clock)


def validate_job(job, item):
    require(isinstance(job, dict) and set(job) == {"schema", "attempt_id", "identity", "evidence",
            "requested_outputs", "viewer_artifact_target", "output"})
    require(job["schema"] == CONTRACT and job["attempt_id"] == item["attempt_id"])
    pin, evidence = job["identity"], job["evidence"]
    cloud.validate_schema("client-view-identity", pin)
    validate_association(evidence)
    require(pin["upload_id"] == item["upload_id"] == upload_id_from_key(pin["source"]["s3_key"]))
    require(evidence["attempt_id"] == job["attempt_id"])
    client = evidence["client"]
    for key in ("source", "match_id", "recorded_own_player"):
        require(pin[key] == client[key])
    require(pin["clock_source"] == evidence["clock_host"]["source"])
    require(pin["raw_map"]["sha256"] == client["raw_map_sha256"])
    cloud.validate_source(pin["raw_map"], raw_map=True)
    recipe = pin["release"]["recipe"]
    require(recipe in recipes() and all(pin[k] == recipe[k] for k in
            ("exporter_revision", "viewer_revision", "analytics_revision")))
    require(evidence["exporter_revision"] == pin["exporter_revision"] and client["film"]["player_count"] <= recipe["max_players"])
    engine = select_exporter(load_registry()[PROFILE], pin["exporter_revision"])
    require(all(pin[k] == engine[k] for k in ("wasm_sha256", "glue_sha256")))
    require(job["requested_outputs"] == ["viewer_artifact"])
    target = job["viewer_artifact_target"]
    require(target["profile_revision"] == 5 and target["schema_name"] == "halospawns.viewerReplay.v1"
            and target["profile"] == "frontend-default")
    require(set(target) == {"artifact_kind", "format", "container_version", "manifest_schema_sha256",
        "encoding_sha256", "schema_name", "profile", "profile_revision", "projection_sha256"})
    try:
        cloud.shared_parser()._viewer_request_from_payload({**target, "generation_token": job["attempt_id"],
            "request_epoch": 0, "request_sequence": 0}, attempt_id=job["attempt_id"])
    except ValueError as error:
        raise cloud.FilmError("association_mismatch") from error
    prefix = cloud.shared_parser()._settings()["viewer_artifact_prefix"].rstrip("/")
    require(job["output"] == {"s3_bucket": os.environ["H1_UPLOADS_BUCKET"],
        "prefix": f"{prefix}/client-views/{pin['upload_id']}/generations/{job['attempt_id']}/"})


def validate_completion(job, payload):
    cloud.validate_schema("client-view-completion", payload)
    require(payload["identity"] == job["identity"] and payload["attempt_id"] == job["attempt_id"])
    client = job["evidence"]["client"]
    require(payload["frame_count"] == client["film"]["source_tick_count"]
            and payload["verified_hash_count"] == client["film"]["hash_sample_count"]
            and payload["first_update"] == client["first_update"])
    for key, template, bound in (
        ("artifact", "halospawns.viewerReplay.v1.frontend-default-r5.{}.viewer-delta.v2.hsrv", 512 * 1024**2),
        ("timeline", "h1-client-view-timeline.v1.{}.json", 32 * 1024**2),
    ):
        source = payload[key]
        require(source["s3_bucket"] == job["output"]["s3_bucket"]
                and source["s3_key"] == job["output"]["prefix"] + template.format(source["sha256"])
                and source["s3_version_id"].lower() != "null" and source["size_bytes"] <= bound)


def replay_completion(job):
    shared = cloud.shared_parser()
    bucket, key = job["output"]["s3_bucket"], job["output"]["prefix"] + "completion.json"
    listing = shared.S3.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
    if not any(row["Key"] == key for row in listing.get("Contents", [])):
        return False
    response = shared.S3.get_object(Bucket=bucket, Key=key)
    with response["Body"] as stream:
        raw = stream.read(256 * 1024 + 1)
    require(0 < len(raw) <= 256 * 1024, "artifact_failed")
    payload = json.loads(raw)
    validate_completion(job, payload)
    cloud.api("POST", API + "/complete", payload)
    return True


def inspect(path, work, deadline, name):
    destination = work / f"{name}.json"
    cloud.run_bounded(["node", str(cloud.NODE_ROOT / "runtime/client-view-evidence.mjs"), str(path), str(destination)],
                      work, min(deadline, time.monotonic() + 60), output_name=f"{name}.log")
    return analytics._json(destination, 32 * 1024**2)


def recording(observed, source, map_hash):
    require(observed["source_film_sha256"] == source["sha256"], "invalid_source")
    return {k: observed[k] for k in ("film", "recording_role", "match_id", "recorded_own_player", "first_update")} | {
        "source": source, "raw_map_sha256": map_hash}


def verify_host(evidence, context):
    pin, artifact = context["identity"], context["artifact"]
    require(evidence["recording_role"] == "host" and evidence["source"] == pin["source"]
            and evidence["film"] == pin["film"] and evidence["raw_map_sha256"] == pin["map_binding"]["raw_source"]["sha256"])
    proof = artifact["metadata"]["h1film"]
    cloud.validate_proof(pin, proof, analytics_revision=proof.get("analytics_revision"))
    require(artifact["tick_count"] == pin["film"]["source_tick_count"], "verification_failed")


def initial_context(item):
    event_source = item.get("source")
    if event_source:
        cloud.validate_source(event_source, client_view=True)
        require(upload_id_from_key(event_source["s3_key"]) == item["upload_id"], "invalid_source")
        head = cloud.shared_parser().S3.head_object(Bucket=event_source["s3_bucket"], Key=event_source["s3_key"],
                                                  VersionId=event_source["s3_version_id"])
        metadata = head.get("Metadata", {})
        require(metadata.get("upload-id") == item["upload_id"] and metadata.get("source-kind") == "h1film-client-view",
                "invalid_source")
        item["attempt_id"] = identifier(metadata.get("attempt-id"))
    identifier(item["attempt_id"])
    result = cloud.api("GET", API + "/attempts/" + item["attempt_id"])["data"]
    require(result["upload_id"] == item["upload_id"] and result["attempt_id"] == item["attempt_id"])
    item["_authorized_attempt"] = True
    return result


def source_for(item, context):
    source = dict(context["source"])
    require(upload_id_from_key(source["s3_key"]) == item["upload_id"], "invalid_source")
    if item.get("source"):
        event_source = item["source"]
        require(all(event_source[k] == source[k] for k in ("s3_bucket", "s3_key")), "invalid_source")
        if "s3_version_id" not in source:
            require(source["size_bytes"] == event_source["size_bytes"], "invalid_source")
            source["s3_version_id"] = event_source["s3_version_id"]
    elif "s3_version_id" not in source:
        # Only an API-authorized missed-notification retry may discover the latest version.
        require(source["s3_bucket"] == os.environ["H1_UPLOADS_BUCKET"], "invalid_source")
        head = cloud.shared_parser().S3.head_object(Bucket=source["s3_bucket"], Key=source["s3_key"])
        source["s3_version_id"] = head.get("VersionId")
    cloud.validate_source(source, client_view=True)
    return source


def convert(job, film, work, deadline):
    timeout = int(deadline - time.monotonic() - 90)
    require(timeout >= 30, "conversion_failed")
    output = work / "conversion"
    cloud.run_bounded(["node", str(cloud.NODE_ROOT / "convert.mjs"), "--film", str(film), "--assets", str(work),
        "--encoder", str(cloud.NODE_ROOT / "bin/h1-film-encoder"), "--output", str(output),
        "--map-catalog", str(work / "maps.json"), "--profile", PROFILE, "--client-view", "--trusted-local",
        "--skip-readback", "--source-viewer-only", "--analytics-revision", "2", "--viewer-revision", "5",
        "--exporter-revision", str(job["identity"]["exporter_revision"]), "--engine-permissions", "--timeout", str(timeout)],
        work, deadline - 90, output_name="convert.log")
    return output


def timeline(job, client, clock):
    value = {"contract": "halospawns.h1ClientViewTimeline.v1", "attempt_id": job["attempt_id"],
        "host_artifact_id": job["identity"]["host_artifact_id"],
        "source_film_sha256": job["identity"]["source"]["sha256"],
        "clock_source_film_sha256": job["identity"]["clock_source"]["sha256"],
        "frame_count": client["film"]["source_tick_count"], "first_update": client["first_update"],
        "clocks": client["clocks"], "alignment_method": "beta5-client-clock-v1",
        "alignment_rows": clock["alignment_rows"]}
    cloud.validate_schema("client-view-timeline", value)
    frames = [row["frame"] for row in value["clocks"]]
    require(frames[0] == 0 and frames[-1] < value["frame_count"] and all(a < b for a, b in zip(frames, frames[1:])))
    return value


def products(job, directory, timeline_value, work):
    report = analytics._json(directory / "report.json", 32 * 1024**2)
    encoding = analytics._json(directory / "candidate/encoding.json")
    pin, client = job["identity"], job["evidence"]["client"]
    film, simulation = client["film"], report["simulation"]
    ticks = film["source_tick_count"]
    require(report["status"] == "simulation_and_encoding_verified" and report["engine_profile"] == PROFILE
            and report["exporter_revision"] == pin["exporter_revision"], "verification_failed")
    require(report["envelope"]["recording_kind"] == "client-view" and report["envelope"]["first_update"] == client["first_update"])
    require(report["provenance"]["film_sha256"] == pin["source"]["sha256"]
            and report["provenance"]["map_sha256"] == pin["raw_map"]["sha256"]
            and all(report["provenance"][k] == pin[k] for k in ("wasm_sha256", "glue_sha256")))
    require(simulation["played_ticks"] == ticks and simulation["hash_checks"] == film["hash_sample_count"]
            and simulation["hash_mismatches"] == simulation["seed_mismatches"] == 0, "verification_failed")
    require(encoding["verification"] == {"mode": "inline-bounded-poses", "120hz": ticks, "30hz": None}
            and encoding["120hz"]["tickCount"] == ticks, "verification_failed")
    require("analytics" not in report and "client_diagnostics" not in report, "verification_failed")
    timeline_path = work / "timeline.json"
    timeline_path.write_text(json.dumps(timeline_value, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    shared = cloud.shared_parser()
    payload = {"attempt_id": job["attempt_id"], "identity": pin, "frame_count": ticks,
        "first_update": client["first_update"], "verified_hash_count": film["hash_sample_count"],
        "producer": {"release_id": os.environ["H1_WORKER_RELEASE_ID"], "image_digest": os.environ["H1_WORKER_IMAGE_DIGEST"]},
        "verification": "simulation_and_encoding_verified"}
    for name, path, template, content_type, bound in (
        ("artifact", directory / "candidate/replay.120hz.hsrdc",
         "halospawns.viewerReplay.v1.frontend-default-r5.{}.viewer-delta.v2.hsrv", "application/octet-stream", 512 * 1024**2),
        ("timeline", timeline_path, "h1-client-view-timeline.v1.{}.json", "application/json", 32 * 1024**2),
    ):
        size = path.stat().st_size
        require(0 < size <= bound, "artifact_failed")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if name == "artifact":
            require(digest == encoding["120hz"]["sha256"] and size == encoding["120hz"]["sizeBytes"], "artifact_failed")
        key = job["output"]["prefix"] + template.format(digest)
        version = shared._put_immutable_file(bucket=job["output"]["s3_bucket"], key=key, path=path,
            content_type=content_type, sha256=digest, metadata={"sha256": digest})
        require(isinstance(version, str) and version.lower() != "null", "artifact_failed")
        payload[name] = {"s3_bucket": job["output"]["s3_bucket"], "s3_key": key, "s3_version_id": version,
                         "sha256": digest, "size_bytes": size}
    validate_completion(job, payload)
    return payload


def execute(item, lambda_context):
    deadline = time.monotonic() + min(lambda_context.get_remaining_time_in_millis() / 1000 - 10, 890)
    context = initial_context(item)
    if context["status"] in TERMINAL:
        return
    job = context.get("job")
    if job:
        validate_job(job, item)
        if replay_completion(job):
            return
    with tempfile.TemporaryDirectory(prefix="h1-client-view-") as temporary:
        work = Path(temporary)
        source = source_for(item, context)
        source_metadata = {}
        source = cloud.download(source, work / "client.h1film", client_view=True, metadata=source_metadata)
        metadata = source_metadata["metadata"]
        require(metadata.get("upload-id") == item["upload_id"] and metadata.get("source-kind") == "h1film-client-view", "invalid_source")
        client = inspect(work / "client.h1film", work, deadline, "client")
        binding = context["host"]["identity"]["map_binding"]
        require(binding == context["clock_host"]["identity"]["map_binding"])
        map_hash = binding["raw_source"]["sha256"]
        observed = {"client": client}
        evidence = {"attempt_id": item["attempt_id"],
            "exporter_revision": job["identity"]["exporter_revision"] if job else recipes()[-1]["exporter_revision"],
            "client": recording(client, source, map_hash)}
        seen = {}
        for name in ("host", "clock_host"):
            host_source = context[name]["identity"]["source"]
            cache_key = json.dumps(host_source, sort_keys=True)
            if cache_key not in seen:
                path = work / f"{name}.h1film"
                cloud.download(host_source, path)
                seen[cache_key] = inspect(path, work, deadline, name)
            observed[name] = seen[cache_key]
            evidence[name] = recording(observed[name], host_source, map_hash)
            verify_host(evidence[name], context[name])
        evidence["diagnostic_recorded_own_player"] = observed["clock_host"].get("diagnostic_recorded_own_player")
        validate_association(evidence)
        (work / "maps").mkdir()
        cloud.download(binding["raw_source"], work / "maps" / f"{binding['scenario']}.map", raw_map=True)
        (work / "maps.json").write_text(json.dumps({"schema": "halospawns.h1FilmMapCatalog.v1", "maps": [{
            "engine_profile": PROFILE, "scenario": binding["scenario"], "size_bytes": binding["raw_source"]["size_bytes"],
            "sha256": map_hash, "map_id": binding["map_id"], "game_release_key": binding["game_release_key"]}]}), encoding="utf-8")
        if not job:
            prepared = cloud.api("POST", API + "/prepare", evidence)["data"]
            if prepared["status"] in TERMINAL:
                return
            job = prepared["job"]
        validate_job(job, item)
        require(job["evidence"] == evidence and job["identity"]["map_binding_id"] == binding["binding_id"]
                and job["identity"]["raw_map"] == binding["raw_source"]
                and job["identity"]["host_artifact_id"] == context["host"]["artifact"]["id"]
                and job["identity"]["game_id"] == context["host"]["replay"]["game_id"])
        if replay_completion(job):
            return
        time_data = timeline(job, client, observed["clock_host"])
        directory = convert(job, work / "client.h1film", work, deadline)
        payload = products(job, directory, time_data, work)
        shared = cloud.shared_parser()
        shared._put_immutable_json(bucket=job["output"]["s3_bucket"], key=job["output"]["prefix"] + "completion.json", value=payload)
        require(replay_completion(job), "artifact_failed")


def report_failure(item, error):
    # Untrusted source metadata cannot fail an unrelated API attempt.
    if not item.get("_authorized_attempt"):
        raise cloud.FilmError("retry_pending", retryable=True)
    code = error.reason if error.reason in FAILURES else "invalid_source"
    cloud.api("POST", API + "/failed", {"attempt_id": item["attempt_id"], "code": code})
