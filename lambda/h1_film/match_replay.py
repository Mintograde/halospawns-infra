"""Finalize one immutable, range-readable artifact containing every recorded view."""

import hashlib
import json
import time

from jsonschema import Draft202012Validator

from . import analytics


def assemble_match_replay(film, directory, host, work, deadline, revision=6):
    from .cloud import NODE_ROOT, require, run_bounded, shared_parser

    shared = shared_parser()
    contract = shared.load_pinned_contract(revision)
    output = work / "match.hsrv"
    request = work / "match-request.json"
    request.write_text(json.dumps({
        "film": str(film), "directory": str(directory), "hostWorld": str(host.path),
        "output": str(output), "sourceContract": {
            **contract.source_contract, "tick_count": host.tick_count,
        },
    }), encoding="utf-8")
    started = time.perf_counter()
    run_bounded(["node", str(NODE_ROOT / "runtime/export-match-replay.mjs"), str(request)],
                work, deadline - 90, output_name="match-pack.log")
    result = analytics._json(work / "match.hsrv.json", 8 * 1024**2)
    manifest = result["manifest"]
    Draft202012Validator(contract.manifest_schema).validate(manifest)
    require(output.stat().st_size == result["size_bytes"])
    with output.open("rb") as stream:
        require(hashlib.file_digest(stream, "sha256").hexdigest() == result["sha256"])
    entries = {entry["id"]: entry for entry in manifest["entries"]}
    tracks = []
    for track in manifest["tracks"]:
        item = {key: track[key] for key in (
            "id", "role", "source_film_sha256", "frame_count", "first_update",
        )}
        if revision in (7, 8, 9, 10, 11, 12):
            item["status"] = track["status"]
        if track.get("status") == "unavailable":
            item["failure"] = track["failure"]
        else:
            item.update(world_sha256=entries[track["world"]]["sha256"],
                        verified_hash_count=track["verification"]["hash_checks"])
        item.update(alignment="authoritative" if track["role"] == "host"
                    else track["alignment"]["method"],
                    diagnostic_counts={t["name"]: t["count"] for t in track.get("tables", [])})
        if track["role"] == "client":
            item.update(recorded_own_player=track["recorded_own_player"],
                        ends_early=track["ends_early"],
                        inputs_trust=track["recorded_trust"]["inputs"],
                        messages_trust=track["recorded_trust"]["messages"])
        tracks.append(item)
    proof = {key: manifest[key] for key in (
        "schema", "source_film_sha256", "match_id", "authoritative_track",
    )}
    proof.update(manifest_sha256=result["manifest_sha256"], tracks=tracks)
    # Inner worlds retain their compression; revision 8 virtualizes duplicate record tables.
    # The outer container itself has no compression.
    container = shared.ViewerContainer(
        path=output, sha256=result["sha256"], size_bytes=result["size_bytes"],
        uncompressed_size_bytes=result["size_bytes"], tick_count=host.tick_count,
        chunk_count=len(entries), manifest=manifest,
        metrics={**host.metrics, "match_pack_duration_ms": round((time.perf_counter()-started)*1000),
                 **({"unavailable_client_count": sum(t.get("status") == "unavailable" for t in tracks)}
                    if revision in (7, 8, 9, 10, 11, 12) else {}),
                 "match_view_count": len(tracks), "artifact_bytes": result["size_bytes"],
                 "artifact_uncompressed_bytes": result["size_bytes"], "compression_ratio": 1},
    )
    return container, proof
