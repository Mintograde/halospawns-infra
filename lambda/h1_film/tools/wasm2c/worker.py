"""Offline-only bridge to the complete worker benchmark, never a Lambda entrypoint."""

import hashlib
import json
import runpy
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

from h1_film import cloud


def main():
    if sys.platform != "linux":
        raise RuntimeError("The native experiment requires the offline Linux container")
    module = Path("/native/engine.node")
    with module.open("rb") as stream:
        module_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    original_environment = cloud.child_environment

    with tempfile.TemporaryDirectory(prefix="h1-native-receipt-") as directory:
        receipt_path = Path(directory) / "receipt.json"

        def environment():
            return {
                **original_environment(),
                "NODE_OPTIONS": "--import=/native-tools/worker-preload.mjs",
                "H1_AOT_OFFLINE": "1",
                "H1_AOT_MODULE": str(module),
                "H1_AOT_RECEIPT": str(receipt_path),
            }

        with patch.object(cloud, "child_environment", environment):
            runpy.run_path("/harness.py", run_name="__main__")
        receipt = json.loads(receipt_path.read_text())
    with module.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != module_hash:
            raise RuntimeError("Native module changed during execution")
    output = Path(sys.argv[sys.argv.index("--output") + 1])
    report_path = output / "report.json"
    report = json.loads(report_path.read_text())
    if receipt != {
        "kind": "wasm2c_native_experiment",
        "wasm_sha256": report["provenance"]["wasm_sha256"],
        "module": str(module),
    }:
        raise RuntimeError("Native execution receipt does not match the worker")
    report["offline_execution_variant"] = {
        "kind": "wasm2c_native_experiment",
        "module_sha256": module_hash,
        "production_sandbox": False,
        "registered_engine": False,
    }
    report_path.write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
