"""Pinned, native x86-64 Steam downloader with private, bounded scratch state."""
import contextlib
import os
import signal
import subprocess
import time
from pathlib import Path

try:
    from . import steam_auth
except ImportError:
    import steam_auth


def environment(home):
    return {"HOME": str(home), "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8",
            "DOTNET_SYSTEM_GLOBALIZATION_INVARIANT": "1", "DOTNET_EnableDiagnostics": "0"}


def command(username, identifier, package, *, manifest_only=False):
    args = [str(Path(os.environ.get("DEPOTDOWNLOADER_ROOT", "/opt/depotdownloader")) / "DepotDownloader"),
            "-app", "976730", "-pubfile", identifier,
            "-username", steam_auth.login_value(username), "-remember-password",
            "-dir", str(package), "-validate", "-max-downloads", "4"]
    if manifest_only:
        args.append("-manifest-only")
    return args


def download(identifier, work, deadline, credentials, *, error_type, check_tree):
    if not credentials or "account_config" not in credentials:
        raise error_type("authentication_required", "auth_required")
    home, package = work / "home", work / "package"
    home.mkdir(mode=0o700)
    config = home / steam_auth.session_path(credentials["account_path"])
    config.parent.mkdir(parents=True, mode=0o700)
    config.write_bytes(credentials["account_config"])
    config.chmod(0o600)
    log = work / "steam.log"
    with log.open("wb") as output:
        log.chmod(0o600)
        process = subprocess.Popen(command(credentials["username"], identifier, package),
            cwd=home, env=environment(home), stdin=subprocess.DEVNULL,
            stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while process.poll() is None:
                if time.monotonic() >= deadline or log.stat().st_size > 4 * 1024**2:
                    raise error_type("download_failed")
                check_tree(work)
                time.sleep(1)
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
    if log.stat().st_size > 4 * 1024**2:
        raise error_type("download_failed")
    output = log.read_text(errors="replace")
    authenticated = steam_auth.logged_in(output)
    if authenticated and credentials.get("save_config"):
        try:
            credentials["save_config"](steam_auth.read_config(config))
        except Exception:
            raise error_type("download_failed", reason="session_storage_failed", authenticated=True) from None
    # Empty/unsupported files can exit zero; only a completed depot transfer qualifies.
    if process.returncode != 0 or not authenticated or "Total downloaded:" not in output:
        reason = steam_auth.failure_reason(output)
        state = "auth_required" if reason in ("no_subscription", "access_denied", "authentication_required") else "failed"
        code = "authentication_required" if state == "auth_required" else "download_failed"
        raise error_type(code, state, reason, authenticated, process.returncode)
    if not package.is_dir():
        raise error_type("invalid_package")
    check_tree(work)
    return package
