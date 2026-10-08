"""Offline exercise of the production Xbox parser/finalization path for H1 films.

All AWS clients are replaced before the production handler is imported. No
upload, callback, database connection or credentials are needed or allowed.
"""

from __future__ import annotations

import argparse
import dataclasses
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

LAMBDA = Path(__file__).resolve().parents[2]
PARSER = LAMBDA / "replay_parser"
sys.path.insert(0, str(PARSER))
sys.path.insert(0, str(LAMBDA))
from h1_film import analytics as h1_film


class OfflineAWS:
    def __init__(self, output: Path):
        self.output = output

    def put_object(self, **kwargs):
        if kwargs["Key"].startswith("replays/derived/spatial/"):
            (self.output / "spatial.json.gz").write_bytes(kwargs["Body"])
        elif kwargs["Key"].startswith("replays/derived/viewer/"):
            with (self.output / "viewer-upload.hsrdc").open("xb") as target:
                shutil.copyfileobj(kwargs["Body"], target)
        else:
            raise RuntimeError(
                "Only offline spatial/viewer artifact writes are permitted"
            )
        return {"VersionId": "offline-version"}

    def __getattr__(self, name):
        raise RuntimeError(f"AWS operation is forbidden in the offline harness: {name}")


def comparable(parsed):
    value = dataclasses.asdict(parsed)
    value["metadata"].pop("parser", None)
    value["spatial_facts"]["coverage"].pop("parser", None)
    value["spatial_facts"].pop("runtime_metrics", None)
    return value


def reconcile(directory: Path, film: Path, extractor: Path, output: Path) -> dict:
    started = time.perf_counter()
    report, encoding, source = h1_film.verified_products(
        directory, film_sha256=h1_film.sha256_file(film)
    )
    output.mkdir(parents=True, exist_ok=False)
    sink = OfflineAWS(output)
    with patch("boto3.client", return_value=sink):
        parser = importlib.import_module("handler")
    with tempfile.TemporaryDirectory(prefix="h1-reconcile-") as temp:
        extracted = Path(temp) / "extractor.json"
        subprocess.run(
            [
                str(extractor),
                "--input",
                str(source),
                "--output",
                str(extracted),
                "--cell-size",
                "0.5",
            ],
            check=True,
            timeout=120,
            stdout=subprocess.DEVNULL,
        )
        native = parser._parsed_replay_from_document(
            parser._replay_document_from_native(
                h1_film._json(extracted, 64 * 1024 * 1024)
            ),
            parse_started=time.perf_counter(),
        )
        decoded = Path(temp) / "analytics.json"
        parser._decompress_replay(source, decoded)
        python = parser._parse_replay(decoded)
        if comparable(native) != comparable(python):
            raise AssertionError("Native/Python production analytics disagree")
    parsed = h1_film.adapt_parsed_replay(native, report=report, encoding=encoding)
    source_hash = report["provenance"]["film_sha256"]
    upload_id = "11111111-1111-4111-8111-111111111111"
    parts = parser.load_native_viewer_parts(
        directory / "candidate" / "parts-120", native_binary_path=extractor, revision=2
    )
    request = h1_film._json(directory / "request.json")
    container = parser.assemble_viewer_container(
        parts,
        output / "viewer.hsrdc",
        replay_id=upload_id,
        recorded_at=request["recorded_at"],
    )
    with (
        patch.object(parser, "S3", sink),
        patch.object(
            parser,
            "_settings",
            return_value={"viewer_artifact_prefix": "replays/derived/viewer/"},
        ),
    ):
        viewer = parser._write_viewer_artifact(
            bucket="offline-fixtures",
            upload_id=upload_id,
            source_replay_sha256=source_hash,
            source_size_bytes=film.stat().st_size,
            request=parser.ViewerBuildRequest(
                generation_token=upload_id, request_epoch=0, request_sequence=0
            ),
            mode="initial",
            parts=parts,
            container=container,
        )
        spatial = parser._write_spatial_artifact(
            parsed=parsed,
            bucket="offline-fixtures",
            upload_id=upload_id,
            generation=1,
            source_replay_sha256=source_hash,
        )
    payload = parser._replay_finalization_payload(
        upload_id=upload_id,
        source_external_id=upload_id,
        original_object=parser.S3ReplayObject(
            bucket="offline-fixtures",
            key="films/unprocessed/film.h1film",
            event_name="offline",
            sqs_message_id="offline",
        ),
        processed_key=f"replays/processed/{upload_id}/sources/{source_hash}/film.h1film",
        downloaded=parser.DownloadedReplay(
            path=film,
            content_type="application/octet-stream",
            size_bytes=film.stat().st_size,
            sha256=source_hash,
            metadata={},
        ),
        parsed=parsed,
        spatial_artifact=spatial,
        viewer_artifact=viewer,
    )
    (output / "finalization.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8"
    )
    metrics = {
        metric: sum(
            len(p.get(metric, {})) for p in parsed.game_meta["players"].values()
        )
        for metric in [
            "kills_by_tick",
            "deaths_by_tick",
            "assists_by_tick",
            "shots_by_tick",
            "damage_dealt_by_tick",
            "damage_received_by_tick",
        ]
    }
    result = {
        "schema": "halospawns.h1PipelineReconciliation.v1",
        "status": "offline_pipeline_verified",
        "native_python_parity": True,
        "participants": len(parsed.participants),
        "game": parsed.game,
        "stats": [p["stats"] for p in parsed.participants],
        "spawns": len(parsed.spawn_points),
        "graph_points": metrics,
        "spatial": spatial["coverage"],
        "source_film_sha256": source_hash,
        "analytics_bytes": source.stat().st_size,
        "viewer_artifact": {
            "tick_count": viewer["tick_count"],
            "profile_revision": viewer["profile_revision"],
            "size_bytes": viewer["size_bytes"],
            "sha256": viewer["sha256"],
        },
        "elapsed_seconds": time.perf_counter() - started,
        "known_gaps": h1_film.KNOWN_GAPS,
        "scope": "No API persistence, hosted viewer selection, or Xbox/H1 same-match oracle comparison",
    }
    (output / "reconciliation.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    return result


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--conversion", type=Path, required=True)
    args.add_argument("--film", type=Path, required=True)
    args.add_argument("--extractor", type=Path, required=True)
    args.add_argument("--output", type=Path, required=True)
    options = args.parse_args()
    # Identical occupancy configuration for both independent production parsers.
    with patch.dict(os.environ, {"SPATIAL_OCCUPANCY_CELL_SIZE": "0.5"}):
        print(
            json.dumps(
                reconcile(
                    options.conversion,
                    options.film,
                    options.extractor.resolve(),
                    options.output,
                ),
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
