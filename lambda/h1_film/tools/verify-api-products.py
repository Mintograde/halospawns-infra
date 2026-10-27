"""Validate an offline H1 callback using the sibling API's real pure builders."""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", required=True, type=Path)
    parser.add_argument("--finalization", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--release-catalog", type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(args.api.resolve() / "src"))
    if args.release_catalog:
        from halospawns_api.h1film_releases import _catalog
        os.environ["H1FILM_RELEASES_ENABLED"] = "true"
        _catalog.set(json.loads(args.release_catalog.read_text(encoding="utf-8-sig")))
    from halospawns_api.repositories.replay_ingest import _game_graph_data_from_meta
    from halospawns_api.schemas.h1films import H1FilmJob
    from halospawns_api.schemas.replay_ingest import ReplayIngestRequest
    from halospawns_api.schemas.replay_viewer_artifacts import (
        ReplayViewerArtifactCompletionRequest,
    )
    from halospawns_api.services.replay_ingest import _spatial_events_from_game_meta
    from halospawns_api.services.h1film_ingest import normalize_h1film_ingest

    payload = json.loads(args.finalization.read_text(encoding="utf-8"))
    request = ReplayIngestRequest.model_validate(payload)
    request = normalize_h1film_ingest(request)
    assert ReplayIngestRequest.model_validate_json(request.model_dump_json(by_alias=True)).model_dump() == request.model_dump()
    failure_path = args.finalization.with_name("failure-status.json")
    if failure_path.exists():
        from halospawns_api.schemas.replay_ingest import ReplayReprocessAttemptStatusUpdate
        from halospawns_api.schemas.uploads import UploadProcessingStatusUpdate
        for failure in json.loads(failure_path.read_text()):
            model = ReplayReprocessAttemptStatusUpdate if "/replay-reprocess-attempts/" in failure["path"] else UploadProcessingStatusUpdate
            model.model_validate(failure["payload"])
    settings_document = payload.get("h1film_settings")
    if settings_document is not None:
        from halospawns_api.schemas.h1film_settings import public_settings, settings_catalogue

        assert request.h1film_settings.model_dump(mode="json", by_alias=True) == settings_document
        assert public_settings(settings_document) == settings_document
        catalogue_path = Path(__file__).resolve().parents[1] / "contracts/h1film-settings-catalogue.v1.json"
        assert settings_catalogue() == json.loads(catalogue_path.read_text(encoding="utf-8"))
    checked_modes = ["initial"]
    for mode, model in (("viewer-rebuild", ReplayViewerArtifactCompletionRequest),
                        ("full-reparse", ReplayIngestRequest)):
        path = args.finalization.with_name(f"{mode}-completion.json")
        if path.exists():
            other = model.model_validate_json(path.read_text(encoding="utf-8"))
            if mode == "full-reparse":
                other = normalize_h1film_ingest(other)
                assert other.metadata.get("native_analytics") == request.metadata.get("native_analytics")
                if settings_document is not None:
                    assert other.h1film_settings.model_dump(mode="json", by_alias=True) == settings_document
            elif settings_document is not None:
                assert "h1film_settings" not in other.model_dump()
            job = H1FilmJob.model_validate_json(path.with_name(f"{mode}-job.json").read_text(encoding="utf-8"))
            if mode == "viewer-rebuild":
                assert other.h1film.network_host is None
                assert other.h1film == request.h1film.model_copy(update={"network_host": None})
            else:
                assert other.h1film == request.h1film
                assert [player.metadata for player in other.participants] == [
                    player.metadata for player in request.participants
                ]
            assert str(other.reprocess_attempt_id) == str(job.attempt_id)
            checked_modes.append(mode)
    participants = tuple(
        {**p.model_dump(), "id": f"offline-slot-{p.slot_index}"}
        for p in request.participants
    )
    graphs = _game_graph_data_from_meta(
        request.game_meta,
        participants,
        participant_stats_by_slot={},
        graph_context=request.metadata["graph_context"],
    )
    events = _spatial_events_from_game_meta(
        request.game_meta, source_schema="halospawns.replayGameMeta.v1"
    )
    last_tick = request.metadata["tick_count"] - 1
    assert all(event.event_tick <= last_tick for event in events)
    assert request.spatial_artifact.ticks_per_second == 30
    result = {
        "status": "api_schema_and_pure_builders_verified",
        "database_access": False,
        "product_modes": checked_modes,
        "participants": len(participants),
        "native_analytics": request.metadata.get("native_analytics"),
        "settings_verified": settings_document is not None,
        "network_host": request.h1film.network_host.model_dump() if request.h1film.network_host else None,
        "host_slots": [player.slot_index for player in request.participants if player.metadata.get("is_host")],
        "graphs": graphs,
        "spatial_event_count": len(events),
        "spatial_event_sample": [dataclasses.asdict(event) for event in events[:8]],
        "note": "No database persistence, map resolution, or viewer artifact registration performed",
    }
    with args.output.open("x", encoding="utf-8") as target:
        json.dump(result, target, indent=2)
    print(
        json.dumps(
            {
                "status": result["status"],
                "participants": len(participants),
                "spatial_events": len(events),
                "series": {k: len(v) for k, v in graphs["series"].items()},
            }
        )
    )


if __name__ == "__main__":
    main()
