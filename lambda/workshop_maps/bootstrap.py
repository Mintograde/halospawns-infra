"""Local-only Steam Guard bootstrap; raw Steam output never leaves the child PTY."""
import getpass
import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

import pexpect
try:
    from . import steam_auth
except ImportError:
    import steam_auth

INPUT = Path("/tmp/workshop-credentials.json")
OUTPUT = Path("/tmp/workshop-session.json")


def authenticate(child, username, password, interactive):
    child.expect(r"Steam>", timeout=180)
    child.sendline(f'login "{username}" "{password}"')
    deadline = time.monotonic() + 600
    authenticated = False
    prompted = 0
    patterns = [
        r"Steam>",
        r"(?i)(?:Logged in OK|Waiting for user info[^\r\n]*OK|Logging in[^\r\n]*\.\.\.OK)",
        r"(?i)(?:enter|provide)[^\r\n]*(?:code|authenticator)[^\r\n]*:",
        r"(?i)(?:confirm|approve)[^\r\n]*(?:mobile|device|app)",
        pexpect.TIMEOUT, pexpect.EOF,
    ]
    while time.monotonic() < deadline:
        matched = child.expect(patterns, timeout=5)
        if matched == 0:
            if not authenticated:
                raise steam_auth.AuthRequired("login_failed")
            child.sendline("quit")
            child.expect(pexpect.EOF, timeout=30)
            return
        if matched == 1:
            authenticated = True
        elif matched == 2:
            if not interactive or prompted >= 3:
                raise steam_auth.AuthRequired("steam_guard_required")
            prompted += 1
            code = getpass.getpass("Steam Guard code (input hidden; never saved): ").strip()
            if not re.fullmatch(r"[A-Za-z0-9]{5,8}", code):
                raise steam_auth.AuthRequired("invalid_guard_code")
            child.sendline(code)
        elif matched == 3:
            print("Approve this login in your Steam mobile app.", flush=True)
        elif matched == 5:
            raise steam_auth.AuthRequired("login_failed")
    raise steam_auth.AuthRequired("login_timed_out")


def main():
    credentials = json.loads(INPUT.read_text())
    INPUT.unlink()
    username = steam_auth.login_value(credentials.get("username"))
    password = steam_auth.login_value(credentials.get("password"))
    with tempfile.TemporaryDirectory(prefix="workshop-bootstrap-") as temp:
        work = Path(temp)
        steam = work / "steam"
        shutil.copytree("/opt/steamcmd", steam)
        print("Connecting to Steam. Raw login output is private.", flush=True)
        child = pexpect.spawn(str(steam / "steamcmd.sh"), cwd=steam,
            env={"HOME": str(work), "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
            encoding="utf-8", codec_errors="replace", echo=False, maxread=4096)
        try:
            authenticate(child, username, password, bool(credentials.get("interactive")))
        finally:
            child.close(force=True)
        value = steam_auth.encode_session(username, steam_auth.read_config(steam / "config" / "config.vdf"))
        fd = os.open(OUTPUT, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(value)
    print("Steam login succeeded; prepared encrypted-session upload.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except steam_auth.AuthRequired as error:
        raise SystemExit(str(error)) from None
    except BaseException:
        # pexpect exceptions include buffered Steam output; never expose them.
        raise SystemExit("Steam bootstrap failed or was cancelled. No session was uploaded.") from None
