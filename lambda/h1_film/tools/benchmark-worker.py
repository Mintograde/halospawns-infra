"""Profile the real packaged worker using verify-cloud's offline S3/API fixtures.

Run in the release image, network disabled, with Linux-local /tmp storage.
No cloud credentials or services are used. Extra callback/retry checks are
reported separately from the first conversion and first finalization.
"""
import importlib.util
import json
import os
import shutil
import sys
import time
from pathlib import Path

from h1_film import cloud


def main():
    evidence = Path(os.environ["H1_BENCH_EVIDENCE"])
    evidence.mkdir(parents=True, exist_ok=True)
    spans = []
    bounded = cloud.run_bounded
    convert = cloud.convert
    products = cloud.build_products
    execute = cloud.execute
    child_environment = cloud.child_environment

    def benchmark_environment():
        result = child_environment()
        if os.environ.get("H1_BENCH_FANOUT"):
            result["H1_BENCH_FANOUT"] = os.environ["H1_BENCH_FANOUT"]
        return result

    def timed(name, function, *args, **kwargs):
        started = time.monotonic()
        try:
            return function(*args, **kwargs)
        finally:
            spans.append({"stage": name, "seconds": time.monotonic() - started})

    def run_bounded(command, *args, **kwargs):
        command = list(command)
        if any(str(arg).endswith("/convert.mjs") for arg in command):
            command += ["--client-concurrency", os.environ.get("H1_BENCH_CLIENTS", "1")]
            if os.environ.get("H1_BENCH_OVERLAP") == "1":
                command += ["--overlap-host"]
        name = kwargs.get("output_name", "command.log")
        try:
            return timed(name, bounded, command, *args, **kwargs)
        finally:
            log = Path(args[0]) / name
            if log.exists():
                shutil.copyfile(log, evidence / f"subprocess-{len(spans)}-{name}")

    def conversion(*args, **kwargs):
        directory = timed("conversion", convert, *args, **kwargs)
        # Archive after the measured conversion, before the worker removes /tmp.
        for relative in [Path("report.json"), Path("match-tracks.json"),
                         *directory.glob("client-*/report.json")]:
            source = relative if relative.is_absolute() else directory / relative
            if source.exists():
                target = evidence / "worlds" / source.relative_to(directory)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
        return directory

    def finalize(job, *args, **kwargs):
        return timed("finalize_" + job["mode"], products, job, *args, **kwargs)

    def execution(*args, **kwargs):
        return timed("execute_with_extra_callback_checks", execute, *args, **kwargs)

    cloud.run_bounded = run_bounded
    cloud.convert = conversion
    cloud.build_products = finalize
    cloud.execute = execution
    cloud.child_environment = benchmark_environment
    spec = importlib.util.spec_from_file_location("verify_cloud", Path(__file__).with_name("verify-cloud.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    started = time.monotonic()
    try:
        module.main()
    finally:
        metrics = {"scope": "offline packaged worker; excludes AWS/API latency and cold start",
                   "harness_seconds": time.monotonic() - started, "spans": spans}
        finals = [span["seconds"] for span in spans if span["stage"].startswith("finalize_")]
        executions = [span["seconds"] for span in spans if span["stage"] == "execute_with_extra_callback_checks"]
        if executions and len(finals) == 3:
            metrics["first_execution_less_extra_finalizations_seconds"] = executions[0] - sum(finals[1:])
        for name in ("memory.peak", "cpu.stat", "memory.events",
                     "memory/memory.max_usage_in_bytes", "memory/memory.failcnt",
                     "cpu/cpu.stat", "cpuacct/cpuacct.usage"):
            path = Path("/sys/fs/cgroup") / name
            if path.exists():
                metrics[name] = path.read_text()
        (evidence / "stages.json").write_text(json.dumps(metrics, indent=2))
    output = Path(sys.argv[sys.argv.index("--output") + 1])
    for source in output.glob("*.json"):
        shutil.copyfile(source, evidence / source.name)


if __name__ == "__main__":
    main()
