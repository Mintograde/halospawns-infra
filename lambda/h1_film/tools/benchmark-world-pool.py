"""Run the packaged worker and its world workers in separate, equally capped Linux containers.

The controller requires Docker and a Linux scratch directory. The only shared volume
between workers emulates Invoke and versioned S3. Each worker has a private /tmp.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def write_atomic(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data))
    temporary.rename(path)


def inside(role):
    from h1_film import cloud
    from h1_film import world_pool as pool
    exchange = Path("/exchange")
    verify = module("verify-cloud")

    def local_invoke(event, seconds):
        if str(event["index"]) == os.environ.get("H1_BENCH_FAIL_WORLD"):
            raise RuntimeError("Injected world invocation failure")
        nonce = event["nonce"]
        write_atomic(exchange / (nonce + ".request"), event)
        reply = exchange / (nonce + ".reply")
        deadline = time.monotonic() + seconds
        while not reply.exists():
            if time.monotonic() >= deadline:
                raise TimeoutError("offline world invocation")
            time.sleep(0.02)
        return json.loads(reply.read_text())

    def get_fragment(self, *, Bucket, Key, VersionId=None):
        if not Key.startswith(pool.PREFIX):
            return original_get(self, Bucket=Bucket, Key=Key, VersionId=VersionId)
        path = exchange / Key
        assert VersionId == "fixture-world-v1"
        return {"Body": path.open("rb"), "VersionId": VersionId, "ContentLength": path.stat().st_size}

    # verify-cloud is loaded independently by benchmark-worker. Patch its storage
    # only for private version-pinned fragments, leaving normal callback checks on.
    original_get = verify.LocalS3.get_object
    if role == "parent":
        def read_fragment(event, receipt, folder, s3):
            with_get = SimpleNamespace(get_object=lambda **args: get_fragment(s3, **args))
            original_receive(event, receipt, folder, with_get)
        original_receive = pool.receive
        with patch.object(pool, "invoke", local_invoke), patch.object(pool, "receive", read_fragment):
            module("benchmark-worker").main()
        return
    with patch("boto3.client"):
        shared = cloud.shared_parser()

    def convert_request(request):
        event = json.loads(request.read_text())
        conversion = event["job"]["conversion"]
        s3 = verify.LocalS3(exchange)
        s3.add(conversion["source"], Path("/input/film.h1film"), "application/octet-stream")
        map_name = conversion["map_binding"]["scenario"] + ".map"
        s3.add(conversion["map_binding"]["raw_source"], Path("/input") / map_name, "application/octet-stream")

        def put_fragment(**args):
            assert args["Key"] == pool.fragment_key(event) and args["IfNoneMatch"] == "*"
            path = exchange / args["Key"]
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as out:
                shutil.copyfileobj(args["Body"], out, 1024**2)
            return {"VersionId": "fixture-world-v1"}

        started = time.monotonic()
        with patch.object(shared, "S3", s3), patch.object(s3, "put_object", put_fragment):
            result = pool.handler(event, SimpleNamespace(get_remaining_time_in_millis=lambda: 900000))
        write_atomic(exchange / (event["nonce"] + ".metrics"), {
            "index": event["index"], "seconds": time.monotonic() - started,
            "bytes": sum(size for _, size in result["files"]),
        })
        write_atomic(exchange / (event["nonce"] + ".reply"), result)

    name = sys.argv.pop(1)
    if role == "child":
        convert_request(exchange / (name + ".request"))
        return
    (exchange / (name + ".ready")).touch()
    while not (exchange / "stop").exists():
        for request in exchange.glob("*.request"):
            claim = request.with_suffix(".claimed")
            try:
                request.rename(claim)
            except FileNotFoundError:
                continue
            convert_request(claim)
        time.sleep(0.02)


def controller():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("film", "map", "output", "image", "profile"):
        parser.add_argument("--" + arg, required=True)
    parser.add_argument("--scratch", type=Path, default=Path("/tmp"))
    parser.add_argument("--workers", type=int, default=0, choices=range(9))
    parser.add_argument("--warm", action="store_true", help="Start the isolated child containers before timing the parent")
    parser.add_argument("--initial-only", action="store_true", help="Measure only the normal initial product build and idempotent callbacks")
    parser.add_argument("--fail-world", type=int, choices=range(16), help="Simulate one failed child invocation")
    parser.add_argument("--candidate", action="store_true", help="Overlay the current worker runtime on the image")
    parser.add_argument("--encoder", help="Linux encoder binary for the candidate")
    parser.add_argument("--revisions", nargs=3, type=int, metavar=("EXPORTER", "ANALYTICS", "VIEWER"),
                        help="Use an older registered recipe for this profile")
    args = parser.parse_args()
    if not args.workers and (args.warm or args.fail_world is not None):
        parser.error("--warm and --fail-world require --workers")
    pkg = Path(__file__).resolve().parents[1]
    output = Path(args.output).resolve()
    output.mkdir(parents=True)
    image = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", args.image], text=True).strip()
    processing = json.loads((pkg / "profiles/registry.json").read_text())["processing"]
    recipe = processing["defaults"][args.profile]
    if args.revisions:
        fields = ["exporter_revision", "analytics_revision", "viewer_revision"]
        recipe = next((r for r in processing["recipes"][args.profile]
                       if [r[key] for key in fields] == args.revisions), None)
        if recipe is None:
            parser.error("The requested revisions are not registered for this profile")
    config = {**vars(args), "scratch": str(args.scratch), "image_id": image, "evidence_on_scratch": True,
              "cpus_per_worker": 1.700396, "memory_mib_per_worker": 3008}
    if args.encoder:
        config["encoder_sha256"] = hashlib.sha256(Path(args.encoder).read_bytes()).hexdigest()
    (output / "configuration.json").write_text(json.dumps(config, indent=2))
    with tempfile.TemporaryDirectory(prefix="h1-pool-", dir=args.scratch) as scratch, contextlib.ExitStack() as resources:
        root = Path(scratch)
        evidence = root / "evidence"
        evidence.mkdir()
        exchange = root / "exchange"
        exchange.mkdir()
        inputs = root / "input"
        inputs.mkdir()
        map_name = Path(args.map).name
        shutil.copyfile(args.film, inputs / "film.h1film")
        shutil.copyfile(args.map, inputs / map_name)
        common = ["docker","run","--rm","--user",f"{os.getuid()}:{os.getgid()}","--network","none","--read-only","--memory","3008m","--memory-swap","3008m",
                  "--cpus","1.700396","--entrypoint","/var/lang/bin/python3.12","-e","PYTHONPATH=/var/task",
                  "-e","PYTHONDONTWRITEBYTECODE=1","-e","AWS_EC2_METADATA_DISABLED=true","-e","AWS_DEFAULT_REGION=us-east-1",
                  "-e","ENVIRONMENT=dev","-e","H1_UPLOADS_BUCKET=contract-fixture-bucket","-e","H1_WORLD_BUCKET=fixture-worlds",
                  "-e","H1_MAX_SIZE_BYTES=536870912","-e","H1_MAX_SOURCE_TICKS=432000","-e","H1_MAX_PLAYERS=16",
                  "-e","H1_WORKER_IMAGE_DIGEST="+image]
        for source, target in [(pkg,"/checks"),(pkg/"tests","/var/task/h1_film/tests"),(inputs,"/input")]:
            common.extend(["-v",f"{source}:{target}:ro"])
        if args.candidate:
            code = root / "code"
            code.mkdir()
            hashes = {}
            for name in ["runtime","convert.mjs","cloud.py","worker.py","world_pool.py","match_replay.py"]:
                target = "/var/task/" + ("h1_film/" if name.endswith(".py") else "") + name
                if (pkg / name).is_dir():
                    shutil.copytree(pkg / name, code / name)
                else:
                    shutil.copyfile(pkg / name, code / name)
                common.extend(["-v",f"{code/name}:{target}:ro"])
            for path in code.rglob("*"):
                if path.is_file():
                    hashes[str(path.relative_to(code))] = hashlib.sha256(path.read_bytes()).hexdigest()
            (output / "runtime-hashes.json").write_text(json.dumps(hashes, indent=2))
        if args.encoder:
            encoder = root / "h1-film-encoder"
            shutil.copyfile(args.encoder, encoder)
            encoder.chmod(0o755)
            common.extend(["-v",f"{encoder}:/var/task/bin/h1-film-encoder:ro"])
        common.extend(["-v",f"{exchange}:/exchange"])
        children = {}

        def launch(name, arguments):
            work = root / name
            work.mkdir()
            work.chmod(0o777)
            log = resources.enter_context((output/(name+".log")).open("wb"))
            container_name = root.name + "-" + name
            return subprocess.Popen(common + ["--name", container_name, "-v", f"{work}:/tmp"] + arguments,
                                    stdout=log, stderr=subprocess.STDOUT)

        program = "/checks/tools/benchmark-world-pool.py"
        commands = ["--film","/input/film.h1film","--map","/input/"+map_name,"--output","/tmp/products",
                    "--exporter-revision",str(recipe["exporter_revision"]),"--viewer-revision",str(recipe["viewer_revision"]),
                    "--analytics-revision",str(recipe["analytics_revision"])]
        if args.initial_only:
            commands.append("--initial-only")
        env = ["-e","H1_BENCH_EVIDENCE=/evidence","-v",f"{evidence}:/evidence"]
        if args.workers:
            env += ["-e","H1_WORLD_FUNCTION=fixture:1","-e",f"H1_WORLD_CONCURRENCY={args.workers}"]
            if args.fail_world is not None:
                env += ["-e", f"H1_BENCH_FAIL_WORLD={args.fail_world}"]
            cmd = [program,"parent"]
        else:
            cmd = ["/checks/tools/benchmark-worker.py"]
        parent = None
        try:
            if args.warm:
                for i in range(args.workers):
                    name = f"standby-{i}"
                    children[name] = launch(name, ["-e","H1_WORKER_MODE=world",image,program,"standby",name])
                start = time.monotonic()
                while len(list(exchange.glob("*.ready"))) < args.workers:
                    if any(c.poll() is not None for c in children.values()) or time.monotonic()-start > 60:
                        raise RuntimeError("Warm pool startup failed")
                    time.sleep(0.05)
            parent = launch("parent", env + [image] + cmd + commands)
            while parent.poll() is None:
                for request in ([] if args.warm else exchange.glob("*.request")):
                    nonce = request.stem
                    if nonce not in children:
                        children[nonce] = launch(nonce, ["-e","H1_WORKER_MODE=world", image, program, "child", nonce])
                for nonce, child in children.items():
                    if child.poll() not in (None, 0):
                        raise RuntimeError("World worker failed, see " + nonce + ".log")
                time.sleep(0.04)
            (exchange / "stop").touch()
            if parent.returncode or any(c.wait() for c in children.values()):
                raise RuntimeError("Packaged run failed, see " + str(output))
            if args.workers:
                fallbacks = (output/"parent.log").read_text().count("h1_world_fallback")
                assert fallbacks == int(args.fail_world is not None)
                report = json.loads((evidence / "report.json").read_text())
                metrics = sorted((json.loads(p.read_text()) for p in exchange.glob("*.metrics")),
                                 key=lambda result: result["index"])
                (output / "world-invocations.json").write_text(json.dumps(metrics, indent=2))
                if metrics or fallbacks:
                    assert len(metrics) + fallbacks == report["match_tracks"]["client_count"]
                    assert report["world_pool"] == {"remote": len(metrics), "local": fallbacks}
                else:
                    tracks = report.get("match_tracks", {}).get("client_count", 0)
                    assert min(tracks, args.workers)*report["envelope"]["ticks"] < 8192
        finally:
            for name, process in {"parent": parent, **children}.items():
                if process is not None and process.poll() is None:
                    subprocess.run(["docker", "rm", "--force", root.name + "-" + name],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    process.wait()
            shutil.copytree(evidence, output, dirs_exist_ok=True)


if __name__ == "__main__":
    if sys.argv[1:2] in (["parent"], ["child"], ["standby"]):
        inside(sys.argv.pop(1))
    else:
        controller()
