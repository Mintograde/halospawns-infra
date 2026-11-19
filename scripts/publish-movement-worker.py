"""Build and publish the dev movement worker. Run from any directory."""
import base64
import hashlib
import io
import subprocess
import tempfile
import zipfile
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "lambda/movement_flow_worker"
ROLLUP = ROOT / "lambda/heatmap_rollup_worker"
FUNCTION = "halospawns-movement-flow-dev"


def package(directory):
    subprocess.run(["docker", "build", "--platform", "linux/amd64", "--file",
                    str(SOURCE / "Dockerfile"), "--output", f"type=local,dest={directory}",
                    str(ROOT)], check=True)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, path in [("worker.py", SOURCE / "worker.py"),
                           ("heatmap_worker.py", ROLLUP / "handler.py"),
                           ("region_stats.py", ROLLUP / "region_stats.py"),
                           ("movement_field", Path(directory, "movement_field"))]:
            member = zipfile.ZipInfo(name)
            member.create_system = 3
            member.external_attr = (0o100755 if name == "movement_field" else 0o100644) << 16
            member.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(member, path.read_bytes())
    return buffer.getvalue()


def main():
    session = boto3.Session(profile_name="halospawns-dev", region_name="us-east-1")
    assert session.client("sts").get_caller_identity()["Account"] == "283279960672"
    client = session.client("lambda")
    with tempfile.TemporaryDirectory() as directory:
        data = package(directory)
    previous = client.get_alias(FunctionName=FUNCTION, Name="live")
    version = client.update_function_code(FunctionName=FUNCTION, ZipFile=data, Publish=True,
        RevisionId=client.get_function_configuration(FunctionName=FUNCTION)["RevisionId"])
    assert version["CodeSha256"] == base64.b64encode(hashlib.sha256(data).digest()).decode()
    client.get_waiter("published_version_active").wait(FunctionName=FUNCTION,
                                                      Qualifier=version["Version"])
    client.update_alias(FunctionName=FUNCTION, Name="live", FunctionVersion=version["Version"],
                        RevisionId=previous["RevisionId"])
    print(f"Published {FUNCTION}:{version['Version']} {version['CodeSha256']}")


if __name__ == "__main__":
    main()
