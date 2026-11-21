"""Generate immutable player movement fields from selected replay worlds."""
import gzip
import hashlib
import json
import logging
import os
import re
import struct
import subprocess
import tempfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import boto3
from botocore.exceptions import ClientError

from heatmap_worker import _api_request
import movement_paths

S3 = boto3.client("s3")
PREFIX = "heatmaps/precomputed/v1/movement/views/"
SCHEMA = "halospawns.movementField.v1"
MAX_ROWS = 160_000
MAX_DECODED = 32 << 20
MAX_STORED = 16 << 20
MAX_SOURCE = 512 << 20
HASH = re.compile(r"[0-9a-f]{64}")
LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)


def command(operation, **payload):
    settings = SimpleNamespace(
        app_api_base_url=os.environ["APP_API_BASE_URL"].rstrip("/"),
        trusted_client_name="heatmap-processing",
        trusted_client_parameter_name=os.environ["APP_API_TRUSTED_CLIENT_HMAC_PARAMETER_NAME"],
        request_timeout_seconds=25,
    )
    return _api_request(settings, "POST", "/v1/ingest/movement-flow",
                        payload={"operation": operation, **payload})


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(test, reason):
    if not test:
        raise ValueError(reason)


def product_key(digest):
    require(isinstance(digest, str) and HASH.fullmatch(digest), "invalid field hash")
    return f"{PREFIX}{digest}.json"


def publish(rows, schema=SCHEMA):
    require(0 < len(rows) <= MAX_ROWS, "field row limit")
    raw = json.dumps({"schema": schema, "rows": rows}, separators=(",", ":")).encode()
    require(len(raw) <= MAX_DECODED, "field exceeds delivery limit")
    digest = sha(raw)
    data = gzip.compress(raw, compresslevel=5, mtime=0)
    require(len(data) <= MAX_STORED, "compressed field exceeds limit")
    try:
        S3.put_object(Bucket=os.environ["UPLOADS_BUCKET_NAME"], Key=product_key(digest), Body=data,
                      ContentType="application/json", ContentEncoding="gzip",
                      CacheControl="public,max-age=31536000,immutable", IfNoneMatch="*")
    except ClientError as exc:
        if exc.response["ResponseMetadata"]["HTTPStatusCode"] != 412:
            raise
    return {"sha256": digest, "rows": len(rows), "size_bytes": len(data),
            "decoded_size_bytes": len(raw)}


def read_field(ref, schema=SCHEMA):
    response = S3.get_object(Bucket=os.environ["UPLOADS_BUCKET_NAME"], Key=product_key(ref["sha256"]))
    with response["Body"] as stream:
        require(response["ContentLength"] == ref["size_bytes"] <= MAX_STORED, "stored field size")
        with gzip.GzipFile(fileobj=stream) as zipped:
            raw = zipped.read(MAX_DECODED + 1)
    require(len(raw) == ref["decoded_size_bytes"] <= MAX_DECODED and sha(raw) == ref["sha256"],
            "field integrity")
    doc = json.loads(raw)
    require(doc["schema"] == schema and len(doc["rows"]) == ref["rows"] <= MAX_ROWS, "field rows")
    return doc["rows"]


def read_source(options, offset, length, sink=None):
    response = S3.get_object(**options, Range=f"bytes={offset}-{offset+length-1}")
    with response["Body"] as stream:
        require(response["ContentLength"] == length, "short source range")
        if sink is None:
            return stream.read()
        digest = hashlib.sha256()
        total = 0
        while block := stream.read(1 << 20):
            sink.write(block)
            digest.update(block)
            total += len(block)
        require(total == length, "truncated source")
        return digest.hexdigest()


def host_range(options, source, revision):
    size = source["size_bytes"]
    head = read_source(options, 0, 64)
    if not head.startswith(b"H1MV"):
        return 0, size, revision
    version, header_size, index_size, physical_size = struct.unpack_from("<4I", head, 8)
    require(1 <= version <= 9 and head[:8] == f"H1MV000{version}".encode() and header_size == 64
            and physical_size == size and 0 < index_size <= min(8 << 20, size-64), "match header")
    index = read_source(options, 64, index_size)
    digest = sha(index)
    require(digest == head[32:64].hex() and digest == source["manifest_sha256"], "match index hash")
    manifest = json.loads(index)
    require(manifest["authoritative_track"] == "host", "authoritative track")
    host = next(t for t in manifest["tracks"] if t["id"] == "host")
    require(host["role"] == "host" and host["verification"]["hash_mismatches"] == 0
            and host["verification"]["seed_mismatches"] == 0, "host verification")
    world = next(e for e in manifest["entries"] if e["id"] == host["world"] and e["kind"] == "world")
    length = world["size_bytes"]
    if version >= 3:
        block, = world["storage"]["blocks"]
        require(block["codec"] == "identity" and block["logical_offset"] == 0
                and block["size_bytes"] == block["decoded_size_bytes"] == length, "host storage")
        offset = block["offset"]
    else:
        offset = world["offset"]
    offset += 64 + index_size
    require(0 < length <= size-offset and offset >= 64+index_size, "host range")
    return offset, length, world["sha256"]


def game_product(job, directory):
    source = job["source"]
    paths = job.get("representation") == "paths"
    bucket = os.environ["UPLOADS_BUCKET_NAME"]
    viewer = source["format"] == "viewer"
    prefix = os.environ["VIEWER_PREFIX" if viewer else "RECORDING_PREFIX"].rstrip("/") + "/"
    require(source["bucket"] == bucket and source["key"].startswith(prefix)
            and 0 < source["size_bytes"] <= MAX_SOURCE, "source outside configured input")
    options = {"Bucket": bucket, "Key": source["key"]}
    if source["version"]:
        options["VersionId"] = source["version"]
    source_hash = job["revision"].partition(".")[0]
    require(HASH.fullmatch(source_hash), "invalid source hash")
    offset, size, digest = host_range(options, source, source_hash) if viewer else (
        0, source["size_bytes"], source_hash)
    path = Path(directory, "source")
    with path.open("wb") as output:
        require(read_source(options, offset, size, output) == digest, "source hash mismatch")
    playback = source["playback"] or {"tick_rate": 30, "source_tick_rate": 30}
    rate, source_rate = playback["tick_rate"], playback["source_tick_rate"]
    require(rate in (30, 120) and source_rate in (30, 120) and source_rate % rate == 0, "clock")
    stride = source_rate // rate
    start = (int(source["start"] or 0) + stride-1) // stride
    end = (int(source["end"]) + stride-1) // stride if source["end"] is not None else 432001
    target = Path(directory, "fields.json")
    with target.open("wb") as output:
        subprocess.run([str(Path(__file__).parent / "movement_field"), source["format"], str(path),
                        str(rate), str(start), str(end), str(source["tick_count"] or 0),
                        *(["--paths"] if paths else [])],
                       stdout=output, check=True, timeout=240)
    require(target.stat().st_size <= 64 << 20, "game field output limit")
    with target.open() as file:
        slots = json.load(file)
    if paths:
        groups = {slot: publish(movement_paths.slot_rows(rows, f"{source_hash}/{slot}"),
                                movement_paths.SCHEMA) for slot, rows in slots.items() if rows}
    else:
        groups = {slot: publish(rows) for slot, rows in slots.items() if rows}
    LOG.info("Movement source %s: %d of %d source bytes, %d rows", job["revision"], size,
             source["size_bytes"], sum(ref["rows"] for ref in groups.values()))
    return {"games": 1, "observed": int(bool(groups)), "groups": groups}


def merge(group, rows):
    for row in rows:
        require(len(row) == 12, "invalid movement row")
        key = tuple(row[:4])
        values = group.get(key)
        if values is None:
            require(len(group) < MAX_ROWS, "aggregate field limit")
            group[key] = row[4:]
        else:
            for index, number in enumerate(row[4:]):
                values[index] += number
            require(values[0] <= (1 << 53) // 4096, "movement accumulation overflow")


def scope_product(lease, representation="field"):
    groups = defaultdict(dict)
    paths = representation == "paths"
    add = movement_paths.merge if paths else merge
    def read(ref):
        return read_field(ref, movement_paths.SCHEMA) if paths else read_field(ref)
    selected = observed = 0
    after = None
    with ThreadPoolExecutor(max_workers=4) as pool:
        while True:
            page = command("inputs", lease=lease, after=after, representation=representation)
            if page.get("superseded"):
                return None
            if page.get("waiting"):
                command("retry", lease=lease, reason="waiting_for_source")
                return None
            for game in page["games"]:
                selected += 1
                slots = [(team, ref) for team, ref in game["slots"] if ref]
                observed += bool(slots)
                for (team, _), rows in zip(slots, pool.map(read, (r for _, r in slots)), strict=True):
                    add(groups["all"], rows)
                    if team is not None and team >= 0:
                        add(groups[f"team:{team}"], rows)
                        if game["winner"] is not None:
                            add(groups["winning" if game["winner"] == team else "losing"], rows)
                require(sum(map(len, groups.values())) <= 650000, "aggregate group limit")
            after = page["next"]
            if after is None:
                break
    if paths:
        result = {group: publish(movement_paths.compact(cells), movement_paths.SCHEMA)
                  for group, cells in groups.items() if cells}
    else:
        result = {group: publish([list(k)+v for k,v in sorted(cells.items())])
                  for group, cells in groups.items() if cells}
    return {"games": selected, "observed": observed, "groups": result}


def handler(event, context):
    count = 0
    while count < 16 and context.get_remaining_time_in_millis() > 270000:
        # Give newly uploaded games both representations. Existing v1 readers
        # continue to use their own immutable products during the rollout.
        preferred = "paths" if count % 2 == 0 else "field"
        job = command("claim_any", representation=preferred)["job"]
        if not job:
            break
        try:
            if job["kind"] == "scope":
                product = scope_product(job["lease"], job.get("representation", "field"))
            else:
                with tempfile.TemporaryDirectory() as directory:
                    product = game_product(job, directory)
            if product is not None:
                command("complete", lease=job["lease"], product=product)
        except Exception:
            command("retry", lease=job["lease"], reason="build_failed")
            LOG.exception("Movement build failed for lease %s", job["lease"])
            raise
        count += 1
    return {"processed": count}
