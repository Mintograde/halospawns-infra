"""Reconcile an offline combat candidate with counters, recorded EVT1 and API DTOs."""

import argparse
import importlib
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import analytics, cloud, combat, recorded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conversion", required=True, type=Path)
    parser.add_argument("--film", required=True, type=Path)
    parser.add_argument("--api", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--parse-analytics", action="store_true")
    args = parser.parse_args()
    report = analytics._json(args.conversion / "report.json")
    encoding = analytics._json(args.conversion / "candidate/encoding.json")
    if report["provenance"]["film_sha256"] != analytics.sha256_file(args.film):
        raise ValueError("Film differs from conversion")
    if encoding["analytics_revision"] != 4 or any(
        report["encoding"][field] != encoding[field]
        for field in ("native_analytics", "final_counters", "analytics_revision", "source_ticks")
    ):
        raise ValueError("Combat encoding/report mismatch")
    simulation = report["simulation"]
    if (
        simulation["played_ticks"] != report["envelope"]["ticks"]
        or simulation["hash_checks"] != report["envelope"]["hash_samples"]
        or simulation["seed_mismatches"] or simulation["hash_mismatches"]
    ):
        raise ValueError("Simulation evidence differs")
    native = {
        **encoding["native_analytics"],
        "kill_attribution": recorded.kill_attribution(args.film, report=report, encoding=encoding),
        "resolved_variant": recorded.resolved_variant(args.film, encoding=encoding),
    }
    cloud.validate_schema("native-analytics", native)
    analytics.validate_native_product(native, encoding=encoding, report=report)
    sys.path.insert(0, str(args.api.resolve() / "src"))
    from halospawns_api.schemas.h1film_combat import H1NativeAnalyticsV2
    from halospawns_api.services.h1film_combat import validate_combat

    checked = H1NativeAnalyticsV2.model_validate(native)
    normalized = combat.participant_counters(encoding)
    participants = {
        slot: SimpleNamespace(stats=SimpleNamespace(**{
            field: normalized[str(slot)].get(source)
            for field, source in (("kills", "kills"), ("deaths", "deaths"),
                                  ("suicides", "suicides"), ("betrayals", "team_kills"))
        })) for slot in encoding["players"]
    }
    end = report["analytics"].get("match_end_source_tick")
    validate_combat(checked.combat, participants=participants, start=0,
                    stop=report["envelope"]["ticks"] if end is None else end + 1)
    if args.parse_analytics:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "replay_parser"))
        with patch("boto3.client", return_value=object()):
            shared = importlib.import_module("replay_parser.handler")
        with tempfile.TemporaryDirectory(prefix="h1-combat-verify-") as temporary:
            decoded = Path(temporary) / "analytics.json"
            shared._decompress_replay(args.conversion / "candidate/analytics.30hz.json.zst", decoded)
            parsed = shared._parse_replay(decoded)
        adapted = analytics.adapt_parsed_replay(parsed, report=report, encoding=encoding)
        for player in adapted.participants:
            expected = participants[player["slot_index"]].stats
            for field in ("kills", "deaths", "suicides", "betrayals"):
                if player["stats"][field] != getattr(expected, field):
                    raise ValueError("Shared parser counter adaptation mismatch")
    product_bytes = len(json.dumps(native["combat"], ensure_ascii=False, separators=(",", ":")).encode())
    evidence = {
        "status": "offline_combat_counters_evt1_and_api_schema_verified",
        "engine_profile": report["engine_profile"], "provenance": report["provenance"],
        "simulation": simulation, "statistics": report["analytics"],
        "combat_bytes": product_bytes,
        "native_bytes": len(json.dumps(native, separators=(",", ":"), ensure_ascii=False).encode()),
        "coverage": {name: native["combat"][name + "_coverage"] for name in ("shot", "damage", "death", "award")},
        "rows": {name: len(native["combat"][name]) for name in ("weapons", "shots", "damage", "deaths", "awards")},
        "recorded_evt1": native["kill_attribution"]["coverage"],
        "participant_counters": normalized,
        "shared_parser_verified": args.parse_analytics,
        "timing": report.get("timing"), "pipeline_resources": report.get("pipeline_resources"),
        "engine_resources": report.get("engine_resources"),
    }
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(evidence, output, indent=2, allow_nan=False)
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
