"""Bounded Steam Workshop discovery. Package bytes are never executed."""
import base64
import contextlib
import hashlib
import hmac
import json
import os
import re
import shutil
import signal
import stat
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

try:
    from . import steam_auth
except ImportError:  # Lambda imports worker as a top-level module.
    import steam_auth

APP = 976730
MAX_PACKAGE = 4 * 1024**3
MAX_MAP = 256 * 1024**2
MAX_FILES = 10000


class WorkshopError(Exception):
    def __init__(self, code, state="failed", reason=None):
        super().__init__(code)
        self.code, self.state = code, state
        self.reason = reason or code


def item_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,19}",value):
        raise WorkshopError("invalid_package")
    if int(value) > 2**64-1:
        raise WorkshopError("invalid_package")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise WorkshopError("download_failed")


def http_json(request, timeout=30):
    with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as response:
        raw = response.read(1024*1024+1)
    if len(raw) > 1024*1024:
        raise WorkshopError("invalid_package")
    return json.loads(raw)


def metadata(identifier):
    identifier = item_id(identifier)
    payload = urllib.parse.urlencode({"itemcount": 1, "publishedfileids[0]": identifier}).encode()
    result = http_json(urllib.request.Request(
        "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
        data=payload, method="POST"))
    details = result.get("response", {}).get("publishedfiledetails", [])
    if len(details) != 1 or details[0].get("publishedfileid") != identifier:
        raise WorkshopError("invalid_package")
    detail = details[0]
    if detail.get("result") != 1:
        raise WorkshopError("not_available", "unavailable")
    if detail.get("consumer_app_id") != APP or detail.get("file_type", 0) != 0:
        raise WorkshopError("invalid_package", "unavailable")
    if type(detail.get("time_updated")) is not int or not 0 <= detail["time_updated"] < 2**63:
        raise WorkshopError("invalid_package")
    try:
        size = int(detail.get("file_size", 0))
    except (ValueError, TypeError) as error:
        raise WorkshopError("invalid_package") from error
    if size < 0 or size > MAX_PACKAGE:
        raise WorkshopError("package_too_large", "unavailable")
    return detail


def needs_download(job, detail, now=None):
    if job.get("time_updated") != detail["time_updated"] or not job.get("last_downloaded_at"):
        return True
    then = datetime.fromisoformat(job["last_downloaded_at"].replace("Z", "+00:00"))
    return (now or datetime.now(UTC)) - then >= timedelta(days=1)


def tree_size(root):
    total, count = 0, 0
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(parent) / name
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or not (
                stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)
            ):
                raise WorkshopError("invalid_package")
            total += info.st_size if stat.S_ISREG(info.st_mode) else 0
            count += 1
            if total > MAX_PACKAGE or count > MAX_FILES:
                raise WorkshopError("package_too_large")
    return total


def steam_download(identifier, work, deadline, credentials=None):
    identifier = item_id(identifier)
    steam = work / "steam"
    shutil.copytree(os.environ.get("STEAMCMD_ROOT", "/opt/steamcmd"),steam)
    login = "login anonymous"
    if credentials:
        # Credentials live only in a private temporary script, never argv or logs.
        try:
            username = steam_auth.login_value(credentials.get("username"))
            login = f'login "{username}"'
            if "config_vdf" in credentials:
                config = steam / "config" / "config.vdf"
                config.parent.mkdir(parents=True, exist_ok=True)
                config.write_bytes(credentials["config_vdf"])
                config.chmod(0o600)
            else:
                login += ' "' + steam_auth.login_value(credentials.get("password")) + '"'
        except steam_auth.AuthRequired:
            raise WorkshopError("authentication_required", "auth_required") from None
    script = work / "download.txt"
    script.write_text("@ShutdownOnFailedCommand 1\n@NoPromptForPassword 1\n" + login +
                      f"\nworkshop_download_item {APP} {identifier} validate\nquit\n")
    script.chmod(0o600)
    log = work / "steam.log"
    with log.open("wb") as output:
        process = subprocess.Popen([str(steam / "steamcmd.sh"), "+runscript", str(script)],
            cwd=steam, env={"HOME": str(work), "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
            stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while process.poll() is None:
                if time.monotonic() >= deadline:
                    raise WorkshopError("download_failed")
                tree_size(work)
                time.sleep(1)
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid,signal.SIGKILL)
            process.wait(timeout=10)
    # SteamCMD sometimes exits zero even though the download failed.
    if log.stat().st_size > 4*1024**2:
        raise WorkshopError("download_failed")
    result = log.read_text(errors="replace")
    success = f"Success. Downloaded item {identifier}" in result
    if credentials and credentials.get("save_config") and (success or steam_auth.logged_in(result)):
        try:
            credentials["save_config"](steam_auth.read_config(steam / "config" / "config.vdf"))
        except Exception:
            raise WorkshopError("download_failed", reason="session_storage_failed") from None
    reason = steam_auth.failure_reason(result)
    if not success and reason in ("no_subscription", "access_denied", "authentication_required"):
        raise WorkshopError("authentication_required", "auth_required", reason)
    if process.returncode != 0 or not success:
        if not credentials:
            raise WorkshopError("authentication_required", "auth_required")
        raise WorkshopError("download_failed", reason=reason)
    package = steam / "steamapps" / "workshop" / "content" / str(APP) / identifier
    if not package.is_dir():
        raise WorkshopError("invalid_package")
    tree_size(package)
    return package


def package_maps(root):
    tree_size(root)
    result, paths = [], set()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() != ".map":
            continue
        relative = path.relative_to(root).as_posix()
        if (len(relative) > 512 or ":" in relative or "\\" in relative
            or any(ord(c)<32 for c in relative) or relative.casefold() in paths):
            raise WorkshopError("invalid_package")
        paths.add(relative.casefold())
        with path.open("rb") as stream:
            head = stream.read(2048)
        # Only CE MCC playable cache candidates; the existing map processor validates all tags.
        if len(head) < 2048 or head[:4] != b"daeh" or struct.unpack_from("<I",head,4)[0] != 13:
            continue
        if struct.unpack_from("<H",head,0x60)[0] != 1:
            continue
        size = path.stat().st_size
        if not 2048 <= size <= MAX_MAP:
            raise WorkshopError("package_too_large")
        scenario = head[0x20:0x40].split(b"\0",1)[0].decode("ascii",errors="strict").lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,159}",scenario):
            raise WorkshopError("invalid_package")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream,"sha256").hexdigest()
        result.append({"path": path,"relative_path": relative,"scenario": scenario,
                       "sha256": digest,"size_bytes": size})
        if len(result) > 128:
            raise WorkshopError("package_too_large")
    return result


def snapshot(s3, bucket, entry):
    key = f"workshop/maps/{entry['sha256']}.map"
    checksum = base64.b64encode(bytes.fromhex(entry["sha256"])).decode()
    with entry["path"].open("rb") as stream:
        try:
            response = s3.put_object(Bucket=bucket, Key=key, Body=stream,
                ContentLength=entry["size_bytes"],ContentType="application/octet-stream",
                Metadata={"sha256": entry["sha256"]}, ChecksumSHA256=checksum, IfNoneMatch="*")
        except Exception as error:
            if getattr(error,"response",{}).get("Error",{}).get("Code") != "PreconditionFailed":
                raise
            response = s3.head_object(Bucket=bucket,Key=key)
            if (response.get("ContentLength") != entry["size_bytes"]
                or response.get("Metadata",{}).get("sha256") != entry["sha256"]):
                raise WorkshopError("invalid_package") from error
    version = response.get("VersionId")
    if not version or version == "null":
        raise WorkshopError("invalid_package")
    return {"relative_path": entry["relative_path"], "scenario": entry["scenario"], "source": {
        "s3_bucket": bucket,"s3_key": key,"s3_version_id": version,
        "size_bytes": entry["size_bytes"],"sha256": entry["sha256"]}}


def process(job, *, s3, bucket, deadline, credentials=None, fetch=metadata, download=steam_download):
    identifier = item_id(job["item_id"])
    if job["app_id"] != APP:
        raise WorkshopError("invalid_package")
    receipt = {k: job[k] for k in ("app_id","item_id","lease_id")}
    try:
        detail = fetch(identifier)
        receipt.update(state="available",time_updated=detail["time_updated"],
                       title=str(detail.get("title", ""))[:256])
        if needs_download(job,detail):
            with tempfile.TemporaryDirectory(prefix="workshop-") as temp:
                root = download(identifier,Path(temp),deadline,credentials)
                maps = package_maps(root)
                after = fetch(identifier)
                if any(detail.get(k) != after.get(k) for k in ("time_updated","hcontent_file")):
                    raise WorkshopError("revision_changed")
                receipt["maps"] = [snapshot(s3,bucket,m) for m in maps]
        return receipt
    except WorkshopError as error:
        return {**{k: job[k] for k in ("app_id","item_id","lease_id")},
                "state": error.state,"error": error.code}


def api(path, payload, secret):
    body = json.dumps(payload,sort_keys=True,separators=(",", ":")).encode()
    stamp = str(int(time.time()))
    client = "workshop-maps"
    canonical = "\n".join(["HALOSPAWNS-HMAC-SHA256",client,stamp,"POST",path,"",
                            hashlib.sha256(body).hexdigest()])
    signature = hmac.new(secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()
    base = os.environ["APP_API_BASE_URL"].rstrip("/")
    if base != "https://api.dev.halospawns.com":
        raise ValueError("Workshop worker is dev-only")
    return http_json(urllib.request.Request(base+path,data=body,method="POST",headers={
        "Content-Type": "application/json","X-Halospawns-Client": client,
        "X-Halospawns-Timestamp": stamp,"X-Halospawns-Signature": signature}))["data"]


def probe(event, context, ssm):
    """IAM-only canary: download in fresh scratch without importing or claiming work."""
    identifier = item_id(event["item_id"])
    stage = "credentials"
    try:
        credentials = steam_auth.load_credentials(ssm,
            os.environ.get("WORKSHOP_STEAM_CREDENTIALS_PARAMETER", ""),
            os.environ.get("WORKSHOP_STEAM_SESSION_PARAMETER", ""))
        if not credentials:
            raise steam_auth.AuthRequired("authentication_required")
        stage = "metadata"
        metadata(identifier)
        with tempfile.TemporaryDirectory(prefix="workshop-probe-") as temp:
            stage = "download"
            root = steam_download(identifier, Path(temp),
                time.monotonic()+min(720,context.get_remaining_time_in_millis()/1000-60), credentials)
            stage = "package"
            maps = package_maps(root)
            return {"state": "download_verified", "item_id": identifier, "maps": len(maps)}
    except steam_auth.AuthRequired:
        return {"state": "auth_required", "reason": "authentication_required"}
    except WorkshopError as error:
        return {"state": error.state, "reason": error.reason, "stage": stage}
    except Exception as error:
        kind = type(error).__name__
        if kind not in {"PermissionError", "FileNotFoundError", "OSError", "HTTPError", "URLError", "TimeoutError", "ClientError"}:
            kind = "InternalError"
        return {"state": "failed", "reason": "download_failed", "stage": stage, "error_type": kind}


def handler(event, context):
    is_probe = (isinstance(event, dict) and set(event) == {"action", "item_id"}
                and event["action"] == "probe")
    if event != {"action": "poll"} and not is_probe:
        raise ValueError("Expected scheduled poll or authenticated download probe")
    import boto3
    ssm, s3 = boto3.client("ssm"), boto3.client("s3")
    if is_probe:
        return probe(event, context, ssm)
    secret = ssm.get_parameter(Name=os.environ["WORKSHOP_HMAC_PARAMETER"],
                               WithDecryption=True)["Parameter"]["Value"]
    api("/v1/ingest/workshop/maintain",{},secret)
    job = api("/v1/ingest/workshop/claim",{},secret)["job"]
    if not job:
        return {"state": "idle"}
    try:
        credentials = steam_auth.load_credentials(ssm,
            os.environ.get("WORKSHOP_STEAM_CREDENTIALS_PARAMETER", ""),
            os.environ.get("WORKSHOP_STEAM_SESSION_PARAMETER", ""))
        receipt = process(job,s3=s3,bucket=os.environ["WORKSHOP_BUCKET"],credentials=credentials,
                          deadline=time.monotonic()+min(720,context.get_remaining_time_in_millis()/1000-60))
    except steam_auth.AuthRequired:
        receipt = {**{k: job[k] for k in ("app_id","item_id","lease_id")},
                   "state": "auth_required", "error": "authentication_required"}
    except Exception:
        # Raw Steam/API errors may contain authentication material; never log them.
        receipt = {**{k: job[k] for k in ("app_id","item_id","lease_id")},
                   "state": "failed","error": "download_failed"}
    api("/v1/ingest/workshop/complete",receipt,secret)
    api("/v1/ingest/workshop/maintain",{},secret)
    return {"state": receipt["state"],"item_id": job["item_id"]}
