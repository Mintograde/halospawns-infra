"""The same immutable engine identities used by the Node conversion dispatcher."""

from __future__ import annotations

import json
import re
from pathlib import Path

REGISTRY_PATH = Path(__file__).with_name("profiles") / "registry.json"
IDENTITY = ("format", "protocol_revision", "tick_rate", "build")


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, dict]:
    if not 0 < path.stat().st_size <= 1024 * 1024:
        raise ValueError("Invalid engine registry size")
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schema") != "halospawns.h1EngineRegistry.v1":
        raise ValueError("Unsupported engine registry")
    entries = document.get("profiles")
    if not isinstance(entries, list) or not 1 <= len(entries) <= 64:
        raise ValueError("Invalid engine profile count")
    result, identities = {}, set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid engine profile")
        for key in ("id", "port"):
            if not isinstance(entry.get(key), str) or not re.fullmatch(
                r"[a-z0-9][a-z0-9-]{0,95}", entry[key]
            ):
                raise ValueError(f"Invalid engine profile {key}")
        expected = {
            "adapter": "film-v2-120-v1",
            "format": 2,
            "tick_rate": 120,
            "export_contract": "HSFT0001",
            "analytics_contract": "halospawns.h1AnalyticsSource.v1",
            "map_cache_version": 7,
        }
        if any(
            type(entry.get(k)) is not type(v) or entry[k] != v
            for k, v in expected.items()
        ):
            raise ValueError("Unsupported engine adapter contract")
        if (
            type(entry.get("protocol_revision")) is not int
            or entry["protocol_revision"] <= 0
        ):
            raise ValueError("Invalid engine protocol revision")
        build = entry.get("build")
        if (
            not isinstance(build, str)
            or not 0 < len(build.encode()) < 64
            or "\0" in build
        ):
            raise ValueError("Invalid engine build identity")
        for key in ("wasm_sha256", "glue_sha256"):
            if not isinstance(entry.get(key), str) or not re.fullmatch(
                r"[0-9a-f]{64}", entry[key]
            ):
                raise ValueError("Invalid engine artifact hash")
        identity = tuple(entry[key] for key in IDENTITY)
        if entry["id"] in result or identity in identities:
            raise ValueError("Duplicate or ambiguous engine profile")
        result[entry["id"]] = entry
        identities.add(identity)
    return result


def profile_for_report(report: dict) -> dict:
    profile = load_registry().get(report.get("engine_profile"))
    if profile is None:
        raise ValueError("Unsupported H1 engine profile")
    envelope = report.get("envelope", {})
    if any(
        type(envelope.get(k)) is not type(profile[k]) or envelope[k] != profile[k]
        for k in IDENTITY
    ):
        raise ValueError("H1 engine profile differs from the film identity")
    provenance = report.get("provenance", {})
    if any(provenance.get(k) != profile[k] for k in ("wasm_sha256", "glue_sha256")):
        raise ValueError("H1 engine artifacts differ from the pinned profile")
    # Earlier local reports predate the explicit export_contract field.
    if (
        report.get("export_contract", profile["export_contract"])
        != profile["export_contract"]
    ):
        raise ValueError("H1 engine export contract mismatch")
    return profile
