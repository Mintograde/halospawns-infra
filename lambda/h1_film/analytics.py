"""Verified H1 analytics adaptation shared by local reconciliation and intake."""

from __future__ import annotations

import copy
import hashlib
import json
import math
from dataclasses import replace
from pathlib import Path
from typing import Any

from .registry import profile_for_report
from .combat import participant_counters, validate_combat_product

ANALYTICS_SCHEMA = "halospawns.h1AnalyticsSource.v1"
KNOWN_GAPS = {
    "match_end_subtick": "Ungated PGCR counters stop before the first ended snapshot. Exact ordering within that transition tick requires engine hooks; final engine-gated scores are retained.",
    "damage": "PGCR damage dealt is rounded; damage received includes self/environment damage. Xbox uses attributed damage deltas.",
    "weapon_shots": "Per-weapon shot attribution is not exported.",
    "opponent_matrices": "Damage/kill/death attribution by opponent is not exported; counters cannot establish pairs.",
    "streaks_multikills": "Authoritative streak/multikill history is not exported.",
    "powerup_timeline": "Pickup totals exist; per-tick pickup series are not exported.",
    "gametype_settings": "Mode/name/teamplay exist; full recorded variant settings are not exported.",
    "host_topology": "Playback-local seats cannot establish the recording's host/controller topology.",
    "recorded_at": "Film format does not establish an authoritative UTC match timestamp.",
}

NATIVE_METRICS = {
    "pgcr_damage_dealt": "damage_dealt",
    "vitality_damage_received": "damage_received",
    "camo_pickups": "camo_count",
    "overshield_pickups": "overshield_count",
}


def validate_native_product(product: dict, *, encoding: dict, report: dict) -> None:
    """Check semantic invariants that are not expressible in the DTO JSON schema."""
    slots = [player["slot_index"] for player in product["players"]]
    if len(slots) != len(set(slots)) or set(slots) != set(encoding["players"]):
        raise ValueError("Native slots differ from observed roster")
    end = report["analytics"].get("match_end_source_tick")
    stop = report["envelope"]["ticks"] if end is None else end
    points = 0
    for player in product["players"]:
        counters = encoding["final_counters"][str(player["slot_index"])]
        for name, metric in player["metrics"].items():
            value, series = metric.get("value"), metric.get("series")
            expected = counters.get(NATIVE_METRICS[name]) if stop else None
            if value != expected or (stop == 0 and value is not None):
                raise ValueError("Native total differs from match-end counters")
            values = [value, *(point["value"] for point in series or [])]
            if any(number is not None and (
                type(number) not in (int, float) or not math.isfinite(number)
                or not 0 <= number <= 2**53 - 1
                or (name != "vitality_damage_received" and type(number) is not int)
            ) for number in values):
                raise ValueError("Invalid native metric precision/value")
            if series is None:
                continue
            if value is None or len(series) > 4096:
                raise ValueError("Native timeline lacks an observed total or exceeds its budget")
            last_tick, last_value = -1, 0
            for point in series:
                tick, number = point["source_tick"], point["value"]
                if type(tick) is not int or not last_tick < tick < stop or tick < 0 or number < last_value:
                    raise ValueError("Invalid native cumulative timeline")
                last_tick, last_value = tick, number
            if last_value != value:
                raise ValueError("Native timeline does not reconcile with its total")
            points += len(series)
    if points > 16384:
        raise ValueError("Native timelines exceed combined point budget")
    if encoding.get("analytics_revision") == 4:
        if product.get("schema") != "halospawns.h1NativeAnalytics.v2":
            raise ValueError("Analytics revision 4 requires native schema v2")
        validate_combat_product(product["combat"], encoding=encoding, report=report,
                                attribution=product.get("kill_attribution"))
    elif product.get("schema") != "halospawns.h1NativeAnalytics.v1":
        raise ValueError("Retained analytics revisions require native schema v1")


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
    revision = encoding.get("analytics_revision", 1)
    end = analytics.get("match_end_source_tick")
    if end is not None and (type(end) is not int or not 0 <= end < ticks):
        raise ValueError("Invalid H1 match-end boundary")
    statistics_ticks = end + 1 if revision in (2, 3, 4) and end is not None else ticks
    if type(revision) is not int or revision not in (1, 2, 3, 4):
        raise ValueError("Unsupported H1 analytics revision")
    if analytics.get("analytics_revision", 1) != revision:
        raise ValueError("Inconsistent H1 analytics revision")
    if revision >= 2 and (
        analytics.get("statistics_source_ticks") != statistics_ticks
        or encoding.get("analytics") != {k: v for k, v in analytics.items() if k != "sha256"}
    ):
        raise ValueError("Inconsistent H1 match-only analytics evidence")
    if revision >= 3 and (
        not isinstance(encoding.get("native_analytics"), dict)
        or report.get("encoding", {}).get("native_analytics") != encoding["native_analytics"]
    ):
        raise ValueError("Missing or inconsistent H1 native analytics evidence")
    if (
        analytics.get("schema") != profile["analytics_contract"]
        or analytics.get("ticks_per_second") != 30
        or analytics.get("ticks") != (statistics_ticks + 3) // 4
    ):
        raise ValueError("Missing 30 Hz H1 analytics contract")
    products = [
        ("analytics.30hz.json.zst", analytics, 64 * 1024 * 1024),
        ("replay.120hz.hsrdc", encoding.get("120hz", {}), 1024 * 1024 * 1024),
    ]
    if "30hz" in encoding and encoding["30hz"] is None:
        if report.get("reference") or encoding.get("verification") != {
            "mode": "inline-bounded-poses" if encoding.get("viewer_profile_revision") in (4, 5) else "inline-lossless",
            "120hz": ticks, "30hz": None,
        }:
            raise ValueError("Missing source-rate viewer verification")
    else:
        products.append(("replay.30hz.hsrdc", encoding.get("30hz", {}), 1024 * 1024 * 1024))
    for name, details, limit in products:
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
    normalized = participant_counters(encoding)
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
        player["stats"]["betrayals"] = normalized[str(player["slot_index"])].get("team_kills")
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
            "analytics_revision": encoding.get("analytics_revision", 1),
            "postgame": "retained_in_viewer_excluded_from_statistics"
            if encoding.get("analytics_revision", 1) >= 2
            else "retained",
            "parity_status": "partial_pending_semantic_reconciliation",
            "known_gaps": KNOWN_GAPS,
        },
    }
    if encoding.get("analytics_revision", 1) >= 3:
        metadata["h1_film"]["known_gaps"] = {
            key: value for key, value in KNOWN_GAPS.items() if key != "powerup_timeline"
        }
        metadata["h1_film"]["known_gaps"].update(
            opponent_matrices="Verified EVT1 can establish recorded kill pairs; damage attribution by opponent is not exported.",
            gametype_settings="Reviewed resolved variant fields may be available; complete runtime settings are not exported.",
        )
    if encoding.get("analytics_revision") == 4:
        metadata["h1_film"]["known_gaps"].update(
            weapon_shots="Discharge lineage coverage is reported independently in native combat.",
            opponent_matrices="Applied damage and callback death coverage are reported independently in native combat.",
            streaks_multikills="Engine award coverage is reported independently in native combat.",
        )
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
