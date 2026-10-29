"""Immutable, source-bound companion for Beta 5's recorded client evidence."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

SCHEMA = "halospawns.h1ClientDiagnostics.v1"
MEDIA_TYPE = "application/vnd.halospawns.h1-diagnostics"
PROFILE = "h1-performance-beta5-p9818-wasm-v1"
MAX_BYTES = 128 * 1024 * 1024
FIELDS = {"schema", "content_type", "compression", "size_bytes", "sha256", "manifest_sha256",
          "source_replay_sha256", "raw_map_sha256", "engine_profile", "source_tick_count"}


def required(proof):
    return proof["engine_profile"] == PROFILE and (proof.get("exporter_revision") or 1) >= 11


def validate(value, proof, viewer, *, stored=True):
    if not required(proof):
        if value is not None:
            raise ValueError("Diagnostics require the Beta 5 diagnostic exporter")
        return
    storage = {"s3_bucket", "s3_key", "s3_version_id"} if stored else set()
    if not isinstance(value, dict) or set(value) != FIELDS | storage:
        raise ValueError("Missing or invalid client diagnostics descriptor")
    expected = {"schema": SCHEMA, "content_type": MEDIA_TYPE, "compression": "identity",
                "engine_profile": proof["engine_profile"], "source_replay_sha256": viewer["source_replay_sha256"],
                "raw_map_sha256": proof["raw_map_sha256"], "source_tick_count": proof["source_tick_count"]}
    if any(value.get(k) != v for k, v in expected.items()):
        raise ValueError("Client diagnostics source binding mismatch")
    if type(value["size_bytes"]) is not int or not 32 < value["size_bytes"] <= MAX_BYTES:
        raise ValueError("Client diagnostics size is invalid")
    if any(not isinstance(value[k], str) or not re.fullmatch(r"[a-f0-9]{64}", value[k])
           for k in ("sha256", "manifest_sha256")):
        raise ValueError("Client diagnostics digest is invalid")
    if stored:
        key = viewer["s3_key"].rsplit("/", 1)[0] + f"/h1-client-diagnostics.v1.{value['sha256']}.h1diag"
        if value["s3_bucket"] != viewer["s3_bucket"] or value["s3_key"] != key:
            raise ValueError("Client diagnostics generation binding mismatch")
        version = value["s3_version_id"]
        if version is not None and (not isinstance(version, str) or not 0 < len(version) <= 1024
                                    or version.lower() == "null"):
            raise ValueError("Client diagnostics S3 version is invalid")


def publish(shared, report, directory: Path, proof, viewer):
    descriptor = report.get("client_diagnostics")
    validate(descriptor, proof, viewer, stored=False)
    if descriptor is None:
        return
    path = directory / "candidate/client-diagnostics.h1diag"
    if path.stat().st_size != descriptor["size_bytes"]:
        raise ValueError("Client diagnostics artifact size changed")
    with path.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != descriptor["sha256"]:
            raise ValueError("Client diagnostics artifact digest changed")
    key = viewer["s3_key"].rsplit("/", 1)[0] + f"/h1-client-diagnostics.v1.{descriptor['sha256']}.h1diag"
    version = shared._put_immutable_file(
        bucket=viewer["s3_bucket"], key=key, path=path, content_type=MEDIA_TYPE,
        sha256=descriptor["sha256"], metadata={"schema": SCHEMA,
        "source-sha256": viewer["source_replay_sha256"], "manifest-sha256": descriptor["manifest_sha256"],
        "generation-token": viewer["generation_token"]})
    viewer["h1_diagnostics"] = {**descriptor, "s3_bucket": viewer["s3_bucket"],
                                "s3_key": key, "s3_version_id": version}
    validate(viewer["h1_diagnostics"], proof, viewer)
