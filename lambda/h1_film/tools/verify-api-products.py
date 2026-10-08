"""Validate an offline H1 callback using the sibling API's real pure builders."""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", required=True, type=Path)
    parser.add_argument("--finalization", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(args.api.resolve() / "src"))
    from halospawns_api.repositories.replay_ingest import _game_graph_data_from_meta
    from halospawns_api.schemas.replay_ingest import ReplayIngestRequest
    from halospawns_api.services.replay_ingest import _spatial_events_from_game_meta

    payload = json.loads(args.finalization.read_text(encoding="utf-8"))
    request = ReplayIngestRequest.model_validate(payload)
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
        "participants": len(participants),
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
