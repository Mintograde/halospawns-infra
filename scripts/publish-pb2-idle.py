"""Package the PB2 audit reader and publish it to the dev audit worker."""
import base64
import hashlib
import io
import re
import zipfile
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "lambda/pb2_idle_worker"
VIEWER = ROOT.parent / "halospawns-svelte/packages/viewer/src/lib/core/session/replayDeltaCodec.js"
FUNCTION = "halospawns-dev-pb2-idle"


def package():
    # Include the same delta reader as the site and only the film reader's
    # static dependency closure. The managed Node runtime supplies the AWS SDK.
    todo = [WORKER / "audit.mjs", WORKER / "profiles.mjs"]
    files = {"index.mjs": WORKER / "index.mjs", "replayDeltaCodec.mjs": VIEWER}
    while todo:
        source = todo.pop().resolve()
        key = source.relative_to(ROOT).as_posix()
        if key in files:
            continue
        files[key] = source
        for name in re.findall(r"""\bfrom\s*['"](\.[^'"]+)['"]""", source.read_text("utf-8")):
            todo.append(source.parent / name)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, path in sorted(files.items()):
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    return out.getvalue()


if __name__ == "__main__":
    aws = boto3.Session(profile_name="halospawns-dev", region_name="us-east-1")
    if aws.client("sts").get_caller_identity()["Account"] != "283279960672":
        raise ValueError("Expected the dev account")
    client = aws.client("lambda")
    data = package()
    expected = base64.b64encode(hashlib.sha256(data).digest()).decode()
    alias = client.get_alias(FunctionName=FUNCTION, Name="live")
    current = client.get_function_configuration(FunctionName=FUNCTION, Qualifier=alias["FunctionVersion"])
    if current["CodeSha256"] != expected:
        prior = client.get_function_configuration(FunctionName=FUNCTION)
        version = client.update_function_code(FunctionName=FUNCTION, ZipFile=data, Publish=True,
                                               RevisionId=prior["RevisionId"])
        if version["CodeSha256"] != expected:
            raise RuntimeError("Published audit worker hash differs")
        client.get_waiter("published_version_active").wait(FunctionName=FUNCTION, Qualifier=version["Version"])
        alias = client.update_alias(FunctionName=FUNCTION, Name="live", FunctionVersion=version["Version"],
                                    RevisionId=alias["RevisionId"])
    print(f"{FUNCTION}:{alias['FunctionVersion']} {expected}")
