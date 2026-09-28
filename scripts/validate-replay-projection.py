"""Build both pinned viewer revisions from a hash-pinned local replay corpus."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(
    0, str(Path(__file__).resolve().parents[1] / "lambda" / "replay_parser")
)
viewer_delta = importlib.import_module("viewer_delta")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "fixtures": [],
        "browser_gates": "pending compatible frontend reader release",
    }
    for fixture in corpus["fixtures"]:
        source = args.sources / Path(fixture["s3_key"]).name
        with source.open("rb") as stream:
            source_sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
        if source_sha256 != fixture["source"]["sha256"]:
            raise ValueError(f"Source hash mismatch: {fixture['role']}")
        row = {
            "role": fixture["role"],
            "source_sha256": source_sha256,
            "source_bytes": source.stat().st_size,
            "revisions": {},
        }
        for revision in (1, 2):
            name = f"{fixture['role']}-r{revision}"
            directory = args.output / name
            started = time.perf_counter()
            subprocess.run(
                [
                    str(args.binary),
                    "--input",
                    str(source),
                    "--output",
                    str(args.output / f"{name}.facts.json"),
                    "--viewer-parts",
                    str(directory),
                    "--viewer-profile-revision",
                    str(revision),
                ],
                check=True,
            )
            parts = viewer_delta.load_native_viewer_parts(
                directory, native_binary_path=args.binary, revision=revision
            )
            if parts.tick_count != fixture["tick_count"]:
                raise ValueError(f"Tick count mismatch: {name}")
            container = viewer_delta.assemble_viewer_container(
                parts,
                args.output / f"{name}.hsrv",
                replay_id=fixture["replay_id"],
                recorded_at=fixture["recorded_at"],
            )
            row["revisions"][str(revision)] = {
                "container_file": container.path.name,
                "sha256": container.sha256,
                "bytes": container.size_bytes,
                "source_ratio": container.size_bytes / source.stat().st_size,
                "build_seconds": round(time.perf_counter() - started, 3),
                "tick_count": parts.tick_count,
                "metrics": container.metrics,
            }
            print(
                json.dumps(
                    {
                        "role": fixture["role"],
                        "revision": revision,
                        **row["revisions"][str(revision)],
                    }
                ),
                flush=True,
            )
        row["growth_percent"] = 100 * (
            row["revisions"]["2"]["bytes"] / row["revisions"]["1"]["bytes"] - 1
        )
        report["fixtures"].append(row)
        (args.output / "report.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8"
        )
    ratios = [row["revisions"]["2"]["source_ratio"] for row in report["fixtures"]]
    report["size_gate"] = {
        "every_output_smaller": all(ratio < 1 for ratio in ratios),
        "median_source_ratio": statistics.median(ratios),
        "passed": all(ratio < 1 for ratio in ratios)
        and statistics.median(ratios) <= 0.30,
    }
    (args.output / "report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report["size_gate"]), flush=True)
    if not report["size_gate"]["passed"]:
        raise SystemExit("Corpus size gate failed")


if __name__ == "__main__":
    main()
