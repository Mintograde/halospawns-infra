"""H1 analytics adaptation. Not registered as a live upload handler yet."""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from .registry import profile_for_report

ANALYTICS_SCHEMA = "halospawns.h1AnalyticsSource.v1"
KNOWN_GAPS = {
    "damage": "PGCR damage dealt is rounded; damage received includes self/environment damage. Xbox uses attributed damage deltas.",
    "weapon_shots": "Per-weapon shot attribution is not exported.",
    "opponent_matrices": "Damage/kill/death attribution by opponent is not exported; counters cannot establish pairs.",
    "streaks_multikills": "Authoritative streak/multikill history is not exported.",
    "powerup_timeline": "Pickup totals exist; per-tick pickup series are not exported.",
    "gametype_settings": "Mode/name/teamplay exist; full recorded variant settings are not exported.",
    "host_topology": "Playback-local seats cannot establish the recording's host/controller topology.",
    "recorded_at": "Film format does not establish an authoritative UTC match timestamp.",
}


def _json(path: Path, limit: int = 16 * 1024 * 1024) -> dict[str, Any]:
    if not 0 < path.stat().st_size <= limit:
        raise ValueError(f"Invalid H1 metadata size: {path.name}")
    with path.open(encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise ValueError("H1 metadata must be an object")
    return value


def sha256_file(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verified_products(directory: Path, *, film_sha256: str) -> tuple[dict, dict, Path]:
    """Bind local products to a separately verified canonical film, never its name."""
    report = _json(directory / "report.json")
    candidate = directory / "candidate"
    encoding = _json(candidate / "encoding.json")
    if report.get("schema") != "halospawns.h1FilmWasmComparisonRun.v1" or report.get(
        "status"
    ) not in {
        "simulation_and_encoding_verified",
        "simulation_and_artifacts_verified",
        "simulation_verified_pending_artifact_comparison",
    }:
        raise ValueError(
            "H1 conversion has not passed simulation and encoding verification"
        )
    profile = profile_for_report(report)
    if report.get("provenance", {}).get("film_sha256") != film_sha256:
        raise ValueError("H1 conversion belongs to a different canonical film")
    simulation = report.get("simulation", {})
    envelope = report.get("envelope", {})
    ticks = envelope.get("ticks")
    if (
        type(ticks) is not int
        or not 1 <= ticks <= 432000
        or simulation.get("played_ticks") != ticks
        or simulation.get("seed_mismatches") != 0
        or simulation.get("hash_mismatches") != 0
        or simulation.get("hash_checks", 0) <= 0
        or simulation.get("hash_checks") != envelope.get("hash_samples")
        or simulation.get("control_pushes", 0) <= 0
        or encoding.get("source_ticks") != ticks
    ):
        raise ValueError("Incomplete H1 simulation evidence")
    analytics = report.get("analytics", {})
    if (
        analytics.get("schema") != profile["analytics_contract"]
        or analytics.get("ticks_per_second") != 30
        or analytics.get("ticks") != (ticks + 3) // 4
    ):
        raise ValueError("Missing 30 Hz H1 analytics contract")
    for name, details, limit in [
        ("analytics.30hz.json.zst", analytics, 64 * 1024 * 1024),
        ("replay.120hz.hsrdc", encoding.get("120hz", {}), 1024 * 1024 * 1024),
        ("replay.30hz.hsrdc", encoding.get("30hz", {}), 1024 * 1024 * 1024),
    ]:
        path = candidate / name
        size = path.stat().st_size
        if not 0 < size <= limit or size != details.get(
            "size_bytes", details.get("sizeBytes")
        ):
            raise ValueError(f"H1 product size mismatch: {name}")
        if sha256_file(path) != details.get("sha256"):
            raise ValueError(f"H1 product hash mismatch: {name}")
        if (
            name.endswith(".hsrdc")
            and report["status"] == "simulation_verified_pending_artifact_comparison"
        ):
            if (
                not report.get("reference")
                or sha256_file(Path(report["reference"]) / name) != details["sha256"]
            ):
                raise ValueError("H1 compact replay differs from the native reference")
    return report, encoding, candidate / "analytics.30hz.json.zst"


def adapt_parsed_replay(parsed: Any, *, report: dict, encoding: dict) -> Any:
    """Keep the normal parser's stats/facts/occupancy, with explicit H1 provenance."""
    if parsed.metadata["tick_count"] != report["analytics"]["ticks"]:
        raise ValueError("H1 analytics parser tick count mismatch")
    participants = copy.deepcopy(parsed.participants)
    for player in participants:
        counters = encoding["final_counters"][str(player["slot_index"])]
        for field, source in [
            ("kills", "kills"),
            ("deaths", "deaths"),
            ("assists", "assists"),
            ("suicides", "suicides"),
            ("betrayals", "team_kills"),
        ]:
            if player["stats"][field] != counters.get(source):
                raise ValueError(f"H1 final counter mismatch: {field}")
        # The common parser's legacy score fallback treats zero as absent.
        if "score" in counters:
            player["stats"]["score"] = counters["score"]
        if "shots_hit" in counters:
            player["stats"]["shots_hit"] = counters["shots_hit"]
        player["metadata"].pop("local_player", None)
    game = copy.deepcopy(parsed.game)
    binding = report.get("map_binding")
    if binding:
        if (
            binding.get("engine_profile") != report["engine_profile"]
            or binding.get("scenario") != report["envelope"]["map"]
            or binding.get("sha256") != report["provenance"]["map_sha256"]
            or binding.get("size_bytes") != report["envelope"]["map_bytes"]
        ):
            raise ValueError("H1 map binding differs from simulated map")
        # An API-owned resolver must establish these trusted catalog identities.
        for key in ("map_id", "game_release_key"):
            if binding.get(key):
                game[key] = binding[key]
    facts = copy.deepcopy(parsed.facts)
    if facts:
        facts["game"].pop("game.host_style", None)
    metadata = {
        **copy.deepcopy(parsed.metadata),
        "h1_film": {
            "engine_profile": report["engine_profile"],
            "film_sha256": report["provenance"]["film_sha256"],
            "raw_map_sha256": report["provenance"]["map_sha256"],
            "map_resolution": "catalog_bound"
            if binding and binding.get("map_id")
            else "local_only_not_hosted",
            "source_tick_rate": 120,
            "viewer_tick_rate": 120,
            "analytics_tick_rate": 30,
            "position_sampling": "every_fourth_source_tick_live_body_only",
            "counter_sampling": "every_source_tick_then_aggregate_to_30hz",
            "postgame": "retained",
            "parity_status": "partial_pending_semantic_reconciliation",
            "known_gaps": KNOWN_GAPS,
        },
    }
    # A film shorter than four ticks has one occupancy sample carrying its final
    # scores. Preserve the independently captured first-tick graph baseline.
    graph_players = metadata.get("graph_context", {}).get("players", {})
    for slot, counters in encoding.get("initial_counters", {}).items():
        if slot in graph_players:
            graph_players[slot]["baselines"] = {
                key: counters[key]
                for key in ("kills", "deaths", "assists")
                if key in counters
            }
    return replace(
        parsed, participants=participants, game=game, facts=facts, metadata=metadata
    )
