#!/usr/bin/env python3
"""Bootstrap Steam Guard locally or test MCC downloads; never print secret values."""
import argparse
import base64
import importlib
import io
import json
import re
import subprocess
import sys
import tarfile
import uuid
from pathlib import Path

import boto3
from botocore.config import Config

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
auth = importlib.import_module("lambda.workshop_maps.steam_auth")
PREFIX = "/halospawns/dev/workshop-maps/"
FUNCTION = "halospawns-workshop-maps-dev"
ACCOUNT = "283279960672"


def docker(*args, input=None):
    result = subprocess.run(["docker", *args], input=input, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("Docker operation failed; check Docker Desktop and AWS/ECR access")
    return result.stdout


def input_tar(credentials, interactive):
    payload = json.dumps({"username": auth.login_value(credentials["username"]),
                         "password": auth.login_value(credentials["password"]),
                         "interactive": interactive}).encode()
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        member = tarfile.TarInfo("workshop-credentials.json")
        member.size, member.mode = len(payload), 0o600
        archive.addfile(member, io.BytesIO(payload))
    return stream.getvalue()


def session_from_tar(raw, username):
    if len(raw) > 32 * 1024:
        raise RuntimeError("Unexpected session export size")
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        members = archive.getmembers()
        if len(members) != 1 or not members[0].isfile() or members[0].size > auth.MAX_SECRET:
            raise RuntimeError("Invalid session export")
        value = archive.extractfile(members[0]).read(auth.MAX_SECRET + 1).decode()
    auth.decode_session(username, value)
    return value


def bootstrap(session, client, interactive):
    ssm = session.client("ssm")
    credentials = json.loads(ssm.get_parameter(Name=PREFIX + "steam-credentials",
        WithDecryption=True)["Parameter"]["Value"])
    payload = input_tar(credentials, interactive)
    image = client.get_function(FunctionName=FUNCTION)["Code"]["ResolvedImageUri"]
    if not re.fullmatch(ACCOUNT + r"\.dkr\.ecr\.us-east-1\.amazonaws\.com/halospawns-workshop-maps@sha256:[a-f0-9]{64}", image):
        raise RuntimeError("Expected the deployed immutable dev Workshop image")
    authorization = session.client("ecr").get_authorization_token(registryIds=[ACCOUNT])["authorizationData"][0]
    username, password = base64.b64decode(authorization["authorizationToken"]).decode().split(":", 1)
    docker("login", "--username", username, "--password-stdin", authorization["proxyEndpoint"], input=password.encode())
    docker("pull", image)
    name = "halospawns-steam-bootstrap-" + uuid.uuid4().hex
    try:
        docker("create", "--name", name, "--interactive", *(["--tty"] if interactive else []),
            "--log-driver", "none", "--memory", "2g", "--pids-limit", "256",
            "--entrypoint", "/usr/local/bin/python", image, "/var/task/bootstrap.py")
        docker("cp", "-", name + ":/tmp", input=payload)
        result = subprocess.run(["docker", "start", "--attach", "--interactive", name], check=False)
        if result.returncode:
            raise RuntimeError("Bootstrap did not finish; run it in your own terminal to complete Steam Guard")
        value = session_from_tar(docker("cp", name + ":/tmp/workshop-session.json", "-"), credentials["username"])
        current = json.loads(ssm.get_parameter(Name=PREFIX + "steam-credentials",
            WithDecryption=True)["Parameter"]["Value"])
        if current != credentials:
            raise RuntimeError("Credentials changed during bootstrap; session was not saved")
        response = ssm.put_parameter(Name=PREFIX + "steam-session", Value=value,
            Type="SecureString", KeyId="alias/aws/ssm", Tier="Standard", Overwrite=True)
        print(f"Session saved in SSM, version {response['Version']}. Run the probe next.")
    finally:
        subprocess.run(["docker", "rm", "--force", name], capture_output=True, check=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("bootstrap", "probe"))
    parser.add_argument("--profile", default="halospawns-dev")
    parser.add_argument("--non-interactive", action="store_true")
    parser.add_argument("--item-id", default="2890016882")
    args = parser.parse_args()
    session = boto3.Session(profile_name=args.profile, region_name="us-east-1")
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Expected the Halospawns dev AWS account")
    client = session.client("lambda", config=Config(read_timeout=930, retries={"total_max_attempts": 1}))
    if args.action == "bootstrap":
        bootstrap(session, client, interactive=not args.non_interactive)
    else:
        if not re.fullmatch(r"[1-9][0-9]{0,19}", args.item_id) or int(args.item_id) > 2**64-1:
            raise ValueError("Invalid Workshop item ID")
        response = client.invoke(FunctionName=FUNCTION,
            Payload=json.dumps({"action": "probe", "item_id": args.item_id}).encode())
        result = json.loads(response["Payload"].read())
        if response.get("FunctionError"):
            raise RuntimeError("Probe invocation failed")
        print(json.dumps({k: result[k] for k in ("state", "reason", "item_id", "maps") if k in result}))
        if result.get("state") != "download_verified":
            raise SystemExit(2)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # SDK/Docker exceptions may carry secret input; print no raw exception data.
        raise SystemExit("Steam operation failed. Check credentials, Steam Guard, Docker and dev AWS access; secret values were not printed.") from None
