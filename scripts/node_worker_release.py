import base64
import hashlib
import io
import re
import zipfile
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT.parent / "halospawns-svelte/packages/viewer/src/lib/core/session/replayDeltaCodec.js"


def package(worker, modules):
    # Include the same delta reader as the site and only the film reader's
    # static dependency closure. The managed Node runtime supplies the AWS SDK.
    todo = [worker / name for name in modules]
    files = {"index.mjs": worker / "index.mjs", "replayDeltaCodec.mjs": VIEWER}
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


def publish(function, data):
    aws = boto3.Session(profile_name="halospawns-dev", region_name="us-east-1")
    if aws.client("sts").get_caller_identity()["Account"] != "283279960672":
        raise ValueError("Expected the dev account")
    client = aws.client("lambda")
    expected = base64.b64encode(hashlib.sha256(data).digest()).decode()
    alias = client.get_alias(FunctionName=function, Name="live")
    current = client.get_function_configuration(FunctionName=function, Qualifier=alias["FunctionVersion"])
    if current["CodeSha256"] != expected:
        prior = client.get_function_configuration(FunctionName=function)
        version = client.update_function_code(FunctionName=function, ZipFile=data, Publish=True,
                                               RevisionId=prior["RevisionId"])
        if version["CodeSha256"] != expected:
            raise RuntimeError("Published worker hash differs")
        client.get_waiter("published_version_active").wait(FunctionName=function, Qualifier=version["Version"])
        alias = client.update_alias(FunctionName=function, Name="live", FunctionVersion=version["Version"],
                                    RevisionId=alias["RevisionId"])
    print(f"{function}:{alias['FunctionVersion']} {expected}")
