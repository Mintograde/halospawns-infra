"""Private, version-pinned exchange of embedded client worlds between workers."""

import base64
import contextlib
import contextvars
import hashlib
import json
import logging
import math
import os
import re
import shutil
import socketserver
import struct
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import cloud
from .cloud import require

LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)
SCHEMA = "halospawns.h1FilmWorld.v1"
PREFIX = "films/world-work/"
MIB = 1024**2
MAX_BUNDLE = 1536 * MIB
MAX_WORKERS = 8
FIRST_DELIVERY = contextvars.ContextVar("h1_first_delivery", default=True)


@contextlib.contextmanager
def delivery(record):
    count = record.get("attributes", {}).get("ApproximateReceiveCount", "1")
    token = FIRST_DELIVERY.set(str(count) == "1")
    try:
        yield
    finally:
        FIRST_DELIVERY.reset(token)


def request_hash(event):
    return hashlib.sha256(json.dumps(event, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def fragment_key(event):
    job = event["job"]
    return f"{PREFIX}{job['upload_id']}/{job['generation_token']}/{event['nonce']}/{event['index']}.bin"


def file_limits(index):
    # Only ship inputs and products the host needs for assembly, recovery
    # verification and sniper attribution. No scratch maps or engine dumps.
    name = f"client-{index}"
    files = {"track.json": 16 * MIB, name + ".h1film": 512 * MIB}
    for attempt in (name, name + "-recovered", name + ".partial", name + "-recovered.partial"):
        for path, limit in (
            ("report.json", 32), ("playback.log", 8), ("client-verification.log", 8),
            ("candidate/sniper.ndjson", 128), ("verified-sniper.ndjson", 128),
            ("sniper-prefix.ndjson", 128), ("sniper-prefix.json", 1),
        ):
            files[f"{attempt}/{path}"] = limit * MIB
        if not attempt.endswith(".partial"):
            for rate in ("120hz", "source"):
                files[f"{attempt}/candidate/replay.{rate}.hsrdc"] = 512 * MIB
    return files


def validate_files(files, index):
    limits = file_limits(index)
    require(isinstance(files, dict) and "track.json" in files)
    require(all(name in limits and type(size) is int and 0 <= size <= limits[name]
                for name, size in files.items()))
    require(0 < sum(files.values()) <= MAX_BUNDLE)


def validate_dispatch(index, simulation, job):
    require(type(index) is int and 0 <= index < 16)
    if simulation is not None:
        film = job["conversion"]["film"]
        require(isinstance(simulation, dict) and simulation.get("seed_mismatches") == 0
                and simulation.get("hash_mismatches") == 0
                and simulation.get("played_ticks") == film["source_tick_count"]
                and simulation.get("hash_checks") == film["hash_sample_count"] > 0)


def copy_exact(source, target, size, digest, expires=None):
    while size:
        if expires is not None:
            require(time.time() < expires)
        chunk = source.read(min(MIB, size))
        require(0 < len(chunk) <= size)
        target.write(chunk)
        digest.update(chunk)
        size -= len(chunk)


def publish(event, work, s3):
    folder = work / "result"
    files = {name: (folder / name).stat().st_size for name in file_limits(event["index"])
             if (folder / name).is_file()}
    validate_files(files, event["index"])
    digest = hashlib.sha256()
    with (work / "fragment.bin").open("x+b") as bundle:
        for name, size in files.items():
            with (folder / name).open("rb") as source:
                copy_exact(source, bundle, size, digest, event.get("expires"))
                require(not source.read(1))
        bundle.seek(0)
        put = s3.put_object(Bucket=os.environ["H1_WORLD_BUCKET"],
                            Key=fragment_key(event), Body=bundle, IfNoneMatch="*",
                            ContentLength=sum(files.values()), ContentType="application/octet-stream",
                            ChecksumSHA256=base64.b64encode(digest.digest()).decode())
    version = put.get("VersionId")
    require(isinstance(version, str) and version and version != "null")
    return {"request_sha256": request_hash(event), "version": version, "sha256": digest.hexdigest(),
            "files": list(files.items())}


def receive(event, receipt, folder, s3):
    require(receipt["request_sha256"] == request_hash(event))
    require(isinstance(receipt["version"], str) and 0 < len(receipt["version"]) <= 1024
            and receipt["version"] != "null" and re.fullmatch("[0-9a-f]{64}", receipt["sha256"]))
    entries = receipt["files"]
    require(isinstance(entries, list) and len(entries) <= len(file_limits(event["index"])))
    files = dict(entries)
    require(len(files) == len(entries))
    validate_files(files, event["index"])
    response = s3.get_object(Bucket=os.environ["H1_WORLD_BUCKET"],
                             Key=fragment_key(event), VersionId=receipt["version"])
    digest = hashlib.sha256()
    with response["Body"] as source:
        require(response["VersionId"] == receipt["version"] and response["ContentLength"] == sum(files.values()))
        folder.mkdir()
        for name, size in files.items():
            path = folder / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as target:
                copy_exact(source, target, size, digest, event.get("expires"))
        require(not source.read(1) and digest.hexdigest() == receipt["sha256"])


def handler(event, context):
    require(os.environ.get("H1_WORKER_MODE") == "world")
    require(isinstance(event, dict) and set(event) == {
        "schema", "image_digest", "nonce", "index", "simulation", "job", "expires",
    } and event["schema"] == SCHEMA and re.fullmatch("[0-9a-f]{32}", event["nonce"]))
    require(event["image_digest"] == os.environ["H1_WORKER_IMAGE_DIGEST"]
            and re.fullmatch("sha256:[0-9a-f]{64}", event["image_digest"]))
    job = event["job"]
    cloud.validate_job(job)
    require(job["conversion"]["film"]["format"] == 3)
    validate_dispatch(event["index"], event["simulation"], job)
    require(type(event["expires"]) is int)
    remaining = min(event["expires"] - time.time(), context.get_remaining_time_in_millis()/1000 - 2)
    require(1 < remaining <= 900)
    deadline = time.monotonic() + remaining
    started = time.monotonic()
    conversion = job["conversion"]
    s3 = cloud.shared_parser().S3
    with tempfile.TemporaryDirectory(prefix="h1-world-") as temporary:
        work = Path(temporary)
        with ThreadPoolExecutor(max_workers=2) as io:
            source = io.submit(cloud.download, conversion["source"], work / "input.h1film")
            cloud.stage_map(conversion["map_binding"], work)
            source.result()
        timeout = math.floor(deadline - time.monotonic())
        require(timeout > 0)
        (work / "world.json").write_text(json.dumps({
            "index": event["index"], "simulation": event["simulation"],
            "conversion": conversion, "timeout": timeout,
        }))
        (work / "result").mkdir()
        staged = time.monotonic()
        cloud.run_bounded(["node", str(cloud.NODE_ROOT / "runtime/convert-world.mjs")], work, deadline)
        require(time.monotonic() < deadline)
        converted = time.monotonic()
        receipt = publish(event, work, s3)
        LOG.info("h1_world index=%d stage_s=%.3f convert_s=%.3f publish_s=%.3f bytes=%d",
                 event["index"], staged-started, converted-staged, time.monotonic()-converted,
                 sum(size for _, size in receipt["files"]))
        return receipt


def invoke(event, seconds):
    import boto3
    from botocore.config import Config

    client = boto3.client("lambda", config=Config(connect_timeout=3, read_timeout=seconds,
                          retries={"total_max_attempts": 1}))
    try:
        response = client.invoke(FunctionName=os.environ["H1_WORLD_FUNCTION"], Payload=json.dumps(event).encode())
        with response["Payload"] as stream:
            require(response["StatusCode"] == 200 and not response.get("FunctionError"))
            data = stream.read(32769)
        require(len(data) <= 32768)
        return json.loads(data)
    finally:
        client.close()


class WorldServer(socketserver.ThreadingMixIn, getattr(socketserver, "UnixStreamServer", socketserver.TCPServer)):
    # The converter waits for all active calls; server_close also drains on a
    # killed converter before its temporary directory can be reclaimed.
    daemon_threads = False
    request_queue_size = MAX_WORKERS


def labeled_parts(film, header):
    # This is only a scheduling hint. The child and the parent still inspect
    # the complete pinned match and verify every selected part independently.
    if len(header) < 536:
        return []
    magic, version, _, _, table, count, stride = struct.unpack_from("<4s6I", header, 504)
    if (magic != b"MTCH" or (version, stride) not in ((1, 96), (2, 112))
            or not 1 <= count <= 16 or table < 536 or table + count * stride != film.stat().st_size):
        return []
    with film.open("rb") as source:
        source.seek(table)
        rows = source.read(count * stride)
        if len(rows) != count * stride:
            return []
        result = []
        for index in range(count):
            start = index * stride
            offset, size = struct.unpack_from("<II", rows, start + 4)
            if size < 504 or offset < 536 or offset + size > table:
                return []
            source.seek(offset + 384)
            if source.read(1) not in (b"", b"\0"):
                result.append(index)
        return result


@contextlib.contextmanager
def world_pool(job, film, work, deadline):
    function = os.environ.get("H1_WORLD_FUNCTION")
    if not function or not FIRST_DELIVERY.get() or job["conversion"]["film"]["format"] != 3:
        yield []
        return
    with film.open("rb") as source:
        header = source.read(536)
    if len(header) < 536 or header[64:68] != (536).to_bytes(4, "little") or not any(header[524:528]):
        yield []
        return
    concurrency = int(os.environ.get("H1_WORLD_CONCURRENCY", "4"))
    require(1 <= concurrency <= MAX_WORKERS)
    # A short fixture spends more time starting a child than playing the
    # recording. Keep small batches on the already-running parent.
    parts = int.from_bytes(header[524:528], "little")
    if min(parts, concurrency) * job["conversion"]["film"]["source_tick_count"] < 8192:
        yield []
        return
    slots = threading.BoundedSemaphore(concurrency)
    folder = work / "world-pool"
    folder.mkdir(mode=0o700)
    path = folder / "worker.sock"
    s3 = cloud.shared_parser().S3

    def fetch(index, simulation):
        nonce = uuid.uuid4().hex
        try:
            validate_dispatch(index, simulation, job)
            seconds = math.floor(deadline - time.monotonic())
            require(seconds > 1)
            event = {"index":index, "simulation":simulation, "schema":SCHEMA, "job":job, "nonce":nonce,
                     "expires":int(time.time()) + seconds, "image_digest":os.environ["H1_WORKER_IMAGE_DIGEST"]}
            receipt = invoke(event, seconds)
            receive(event, receipt, folder / nonce, s3)
            return nonce
        except Exception as error:
            if (folder / nonce).exists():
                shutil.rmtree(folder / nonce)
            LOG.warning("h1_world_fallback type=%s", type(error).__name__)
            return None
        finally:
            slots.release()

    prefetched = {}
    lock = threading.Lock()

    class Request(socketserver.StreamRequestHandler):
        def handle(self):
            token = None
            try:
                self.connection.settimeout(5)
                data = self.rfile.readline(2049)
                require(len(data) <= 2048)
                message = json.loads(data)
                require(set(message) == {"index", "simulation"})
                index, simulation = message["index"], message["simulation"]
                validate_dispatch(index, simulation, job)
                with lock:
                    future = prefetched.pop(index, None) if simulation is None else None
                if future is not None:
                    token = future.result()
                elif slots.acquire(blocking=False):
                    token = fetch(index, simulation)
            except Exception as error:
                LOG.warning("h1_world_fallback type=%s", type(error).__name__)
            with contextlib.suppress(OSError):
                self.wfile.write(json.dumps(token).encode())

    with ThreadPoolExecutor(max_workers=concurrency) as pool, WorldServer(str(path), Request) as server:
        if job["conversion"].get("engine", {}).get("exporter_revision", 0) >= 52:
            for index in labeled_parts(film, header)[:concurrency]:
                slots.acquire()
                prefetched[index] = pool.submit(fetch, index, None)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05})
        thread.start()
        try:
            yield ["--world-socket", str(path), "--client-concurrency", str(concurrency), "--overlap-host"]
        except cloud.FilmError as error:
            if time.monotonic() + 2 >= deadline:
                # Remote capacity/transport can exhaust an otherwise valid
                # job's budget. Redelivery gets the full serial budget.
                raise cloud.FilmError(error.reason, retryable=True) from error
            raise
        finally:
            server.shutdown()
            thread.join()
