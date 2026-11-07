"""Compare archived format-3 tables/pads byte-for-byte with the pinned game's reader."""

import argparse
import hashlib
import json
import runpy
import struct
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("film", "replay", "upstream", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    source, replay = args.film.read_bytes(), args.replay.read_bytes()
    upstream = runpy.run_path(str(args.upstream))
    length = struct.unpack_from("<I", replay, 16)[0]
    raw = replay[64:64 + length]
    assert hashlib.sha256(raw).digest() == replay[32:64]
    manifest = json.loads(raw)
    assert manifest["source_film_sha256"] == hashlib.sha256(source).hexdigest()
    entries = {}
    for entry in manifest["entries"]:
        start = 64 + length + entry["offset"]
        data = replay[start:start + entry["size_bytes"]]
        assert len(data) == entry["size_bytes"] and hashlib.sha256(data).hexdigest() == entry["sha256"]
        entries[entry["id"]] = data
    comparisons = 0
    for track in manifest["tracks"]:
        if track["role"] == "host":
            film = source
            account_source = None
        else:
            table_at, _, stride = struct.unpack_from("<3I", source, 520)
            index = int(track["id"].split("-")[1])
            offset, size, account_at, account_size = struct.unpack_from("<4I", source, table_at + index * stride + 4)
            film = source[offset:offset + size]
            account_source = source[account_at:account_at + account_size]
            if account_size:
                assert entries[f'{track["id"]}/recorded/account'] == account_source
        for name, entry in track.get("recorded_sections", {}).items():
            at = {"gametype": 84, "input_script": 92, "events": 112, "roster": 456,
                  "ledger": 480, "network": 448}[name]
            offset, size = struct.unpack_from("<2I", film, at)
            assert film[offset:offset + size] == entries[entry]
            comparisons += size
        for table in track.get("tables", []):
            if not table["count"]:
                continue
            if table["kind"] == "client":
                account = entries[f'{track["id"]}/recorded/account']
                all_tables, _ = upstream["read_tables"](account, 48, 160, 14, upstream["CLIENT_TABLES"])
                packed = upstream["client_packed_rows"](account, 160, 14)
                if packed:
                    all_tables["aim"] = (len(packed[0]), 28, packed[0])
                    all_tables["seen"] = (len(packed[1]), 28, packed[1])
                count, stride, rows = all_tables[table["name"]]
                assert (count, stride) == (table["count"], table["stride"])
                assert b"".join(rows) == entries[table["entry"]]
                comparisons += count * stride
        if track.get("pad"):
            pad = track["pad"]
            original = entries[pad["original"]]
            offset, size = struct.unpack_from("<2I", film, 104)
            assert original == film[offset:offset + size]
            head = struct.unpack_from("<16I", original)
            plain = upstream["pad_unpack"](original, head) if head[7] & 8 else original
            if pad["event_count"]:
                assert plain[64:head[11]] == entries[pad["events"]]
            if pad["count"]:
                assert plain[head[11]:] == entries[pad["samples"]]
            comparisons += len(plain) - 64
    result = {"status": "upstream_recorded_bytes_match", "compared_bytes": comparisons,
              "entries_verified": len(entries), "views": len(manifest["tracks"])}
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
