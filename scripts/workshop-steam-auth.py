#!/usr/bin/env python3
"""Bootstrap Steam Guard locally or test MCC downloads; never print secret values."""
import argparse
import contextlib
import csv
import importlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import uuid
from pathlib import Path

import boto3
from botocore.config import Config

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
auth = importlib.import_module("lambda.workshop_maps.steam_auth")
PREFIX = "/halospawns/dev/workshop-maps/"
FUNCTION = "halospawns-workshop-maps-dev"
ACCOUNT = "283279960672"


class OperationError(Exception):
    """Only fixed, non-secret operator guidance may be used as this message."""


def docker(*args, input=None, config=None, env=None):
    prefix = ["--config", config] if config else []
    result = subprocess.run(["docker", *prefix, *args], input=input, env=env, capture_output=True, check=False)
    if result.returncode:
        output = (result.stdout + result.stderr).lower()
        hints = [label for text, label in (
            (b"credentials", "credential_store"), (b"logon session", "windows_logon_session"),
            (b"access is denied", "access_denied"), (b"unauthorized", "registry_auth"),
            (b"cannot connect", "daemon_connection"), (b"certificate", "tls_certificate"),
            (b"password-stdin", "stdin_login"), (b"forbidden", "forbidden"),
            (b"not found", "not_found"), (b"timeout", "timeout"),
        ) if text in output]
        raise OperationError("Docker operation failed (" + ",".join(hints or ["unclassified"]) + "); check Docker Desktop and AWS/ECR access")
    return result.stdout


@contextlib.contextmanager
def private_docker_config():
    # ECR's temporary registry token must not depend on a desktop keychain session.
    # The Steam password/session never touches this host directory.
    with tempfile.TemporaryDirectory(prefix="halospawns-ecr-") as temp:
        if not Path(temp).resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()):
            raise OperationError("Unexpected temporary configuration location")
        if os.name == "nt":
            identity = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"],
                capture_output=True, check=True, text=True)
            sid = next(csv.reader(io.StringIO(identity.stdout)))[1]
            if not re.fullmatch(r"S-1-[0-9-]+", sid):
                raise OperationError("Cannot establish a private temporary directory")
            permissions = subprocess.run(["icacls", temp, "/inheritance:r", "/grant:r",
                f"*{sid}:(OI)(CI)F"], capture_output=True, check=False)
            if permissions.returncode:
                raise OperationError("Cannot protect temporary registry authentication")
        (Path(temp) / "config.json").write_text("{}")
        yield temp


def input_tar(credentials, interactive):
    payload = json.dumps({"username": auth.login_value(credentials["username"]),
                         "password": auth.password_value(credentials["password"]),
                         "interactive": interactive}).encode()
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        member = tarfile.TarInfo("workshop-credentials.json")
        member.size, member.mode = len(payload), 0o600
        archive.addfile(member, io.BytesIO(payload))
    return stream.getvalue()


def session_from_tar(raw, username):
    if len(raw) > 32 * 1024:
        raise OperationError("Unexpected session export size")
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        members = archive.getmembers()
        if len(members) != 1 or not members[0].isfile() or members[0].size > auth.MAX_SECRET:
            raise OperationError("Invalid session export")
        value = archive.extractfile(members[0]).read(auth.MAX_SECRET + 1).decode()
    auth.decode_session(username, value)
    return value


def bootstrap(session, client, interactive):
    ssm = session.client("ssm")
    print("Reading the dedicated account from SSM.", flush=True)
    raw = ssm.get_parameter(Name=PREFIX + "steam-credentials", WithDecryption=True)["Parameter"]["Value"]
    try:
        credentials = json.loads(raw)
        payload = input_tar(credentials, interactive)
    except (ValueError, KeyError, TypeError):
        raise OperationError("The credential parameter must contain a JSON object with username and password string fields.") from None
    except auth.AuthRequired:
        raise OperationError("Login values must be nonempty and contain no control characters; the account name cannot contain quotes or backslashes.") from None
    print("Credentials validated. Resolving the deployed Workshop image.", flush=True)
    image = client.get_function(FunctionName=FUNCTION)["Code"]["ResolvedImageUri"]
    if not re.fullmatch(ACCOUNT + r"\.dkr\.ecr\.us-east-1\.amazonaws\.com/halospawns-workshop-maps@sha256:[a-f0-9]{64}", image):
        raise OperationError("Expected the deployed immutable dev Workshop image")
    endpoint = docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}").decode().strip()
    if not endpoint.startswith(("npipe://", "unix://")):
        raise OperationError("Bootstrap requires a local Docker engine")
    environment = {**os.environ, "DOCKER_HOST": endpoint}
    environment.pop("DOCKER_CONTEXT", None)
    with private_docker_config() as config:
        authorization = session.client("ecr").get_authorization_token(registryIds=[ACCOUNT])["authorizationData"][0]
        registry = image.split("/", 1)[0]
        if authorization["proxyEndpoint"] != "https://" + registry:
            raise OperationError("Unexpected registry authorization endpoint")
        # A populated private auth file avoids Docker's automatic native-keychain
        # discovery, including Windows logon sessions without a usable keychain.
        auth_path = Path(config) / "config.json"
        auth_path.write_text(json.dumps({"auths": {registry: {"auth": authorization["authorizationToken"]}}}))
        auth_path.chmod(0o600)
        print("Pulling the pinned Workshop image.", flush=True)
        docker("pull", image, config=config, env=environment)
        bootstrap_container(ssm, image, payload, credentials, interactive, config, environment)


def bootstrap_container(ssm, image, payload, credentials, interactive, config, environment):
    name = "halospawns-steam-bootstrap-" + uuid.uuid4().hex
    try:
        docker("create", "--name", name, "--interactive", *(["--tty"] if interactive else []),
            "--log-driver", "none", "--memory", "2g", "--pids-limit", "256",
            "--entrypoint", "/usr/local/bin/python", image, "/var/task/bootstrap.py", config=config, env=environment)
        docker("cp", "-", name + ":/tmp", input=payload, config=config, env=environment)
        result = subprocess.run(["docker", "--config", config, "start", "--attach", "--interactive", name],
                                env=environment, check=False)
        if result.returncode:
            raise OperationError("Bootstrap did not finish; run it in your own terminal to complete Steam Guard")
        value = session_from_tar(docker("cp", name + ":/tmp/workshop-session.json", "-",
            config=config, env=environment), credentials["username"])
        current = json.loads(ssm.get_parameter(Name=PREFIX + "steam-credentials",
            WithDecryption=True)["Parameter"]["Value"])
        if current != credentials:
            raise OperationError("Credentials changed during bootstrap; session was not saved")
        response = ssm.put_parameter(Name=PREFIX + "steam-session", Value=value,
            Type="SecureString", KeyId="alias/aws/ssm", Tier="Standard", Overwrite=True)
        print(f"Session saved in SSM, version {response['Version']}. Run the probe next.")
    finally:
        subprocess.run(["docker", "--config", config, "rm", "--force", name],
                       env=environment, capture_output=True, check=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("bootstrap", "probe"))
    parser.add_argument("--profile", default="halospawns-dev")
    parser.add_argument("--non-interactive", action="store_true")
    parser.add_argument("--item-id", default="2903623613")
    args = parser.parse_args()
    session = boto3.Session(profile_name=args.profile, region_name="us-east-1")
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise OperationError("Expected the Halospawns dev AWS account")
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
            raise OperationError("Probe invocation failed")
        print(json.dumps({k: result[k] for k in ("state", "reason", "item_id", "maps", "stage", "error_type", "authenticated", "exit_code") if k in result}))
        if result.get("state") != "download_verified":
            raise SystemExit(2)


if __name__ == "__main__":
    try:
        main()
    except OperationError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        # SDK/Docker exceptions may carry secret input; print no raw exception data.
        raise SystemExit("Steam operation failed. Check credentials, Steam Guard, Docker and dev AWS access; secret values were not printed.") from None
