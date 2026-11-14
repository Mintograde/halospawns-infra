"""Bounded SteamCMD login state stored in one external SSM SecureString."""
import base64
import json
import re
import stat
import zlib

MAX_CONFIG = 256 * 1024
MAX_SECRET = 4096


class AuthRequired(Exception):
    pass


def login_value(value):
    if not isinstance(value, str) or not value or re.search(r'[\x00-\x1f\x7f"\\]', value):
        raise AuthRequired("invalid_credentials")
    return value


def password_value(value):
    # Passwords are sent to SteamCMD's hidden prompt, not its command parser.
    if not isinstance(value, str) or not value or re.search(r"[\x00-\x1f\x7f]", value):
        raise AuthRequired("invalid_credentials")
    return value


def encode_session(username, config):
    login_value(username)
    if not isinstance(config, bytes) or not config or len(config) > MAX_CONFIG:
        raise AuthRequired("invalid_session")
    value = json.dumps({"version": 1, "username": username,
        "config_zlib": base64.b64encode(zlib.compress(config, 9)).decode()},
        sort_keys=True, separators=(",", ":"))
    if len(value.encode()) > MAX_SECRET:
        raise AuthRequired("session_too_large")
    return value


def decode_session(username, value):
    try:
        if len(value.encode()) > MAX_SECRET:
            raise ValueError()
        data = json.loads(value)
        if data.get("version") != 1 or data.get("username") != username:
            raise ValueError()
        packed = base64.b64decode(data["config_zlib"], validate=True)
        decoder = zlib.decompressobj()
        config = decoder.decompress(packed, MAX_CONFIG + 1)
        if not config or len(config) > MAX_CONFIG or not decoder.eof or decoder.unused_data:
            raise ValueError()
        return config
    except (ValueError, KeyError, TypeError, AttributeError, zlib.error):
        raise AuthRequired("invalid_session") from None


def read_config(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_CONFIG:
        raise AuthRequired("invalid_session")
    return path.read_bytes()


def load_credentials(ssm, credential_parameter, session_parameter=""):
    if not credential_parameter:
        if session_parameter:
            raise AuthRequired("missing_credentials")
        return None
    try:
        credentials = json.loads(ssm.get_parameter(Name=credential_parameter,
            WithDecryption=True)["Parameter"]["Value"])
        username = login_value(credentials["username"])
        if not session_parameter:
            return {"username": username, "password": login_value(credentials["password"])}
        parameter = ssm.get_parameter(Name=session_parameter, WithDecryption=True)["Parameter"]
        config = decode_session(username, parameter["Value"])
    except Exception:
        raise AuthRequired("authentication_required") from None

    def save_config(updated):
        value = encode_session(username, updated)
        if value == parameter["Value"]:
            return
        # Do not replace a session bootstrapped or revoked during this invocation.
        current = ssm.get_parameter(Name=session_parameter, WithDecryption=True)["Parameter"]
        if current["Version"] != parameter["Version"]:
            return
        ssm.put_parameter(Name=session_parameter, Value=value, Type="SecureString",
            KeyId="alias/aws/ssm", Tier="Standard", Overwrite=True)

    # Password never enters scheduled SteamCMD invocations when session mode is configured.
    return {"username": username, "config_vdf": config, "save_config": save_config}


def failure_reason(output):
    if re.search(r"Exec format error|cannot execute binary|bad ELF interpreter|error while loading shared libraries", output, re.I):
        return "steam_runtime_unavailable"
    if re.search(r"No space left on device", output, re.I):
        return "scratch_full"
    if re.search(r"No\s*subscription|NoSubscription", output, re.I):
        return "no_subscription"
    if re.search(r"Access\s*Denied|AccessDenied", output, re.I):
        return "access_denied"
    if re.search(r"Invalid Password|InvalidPassword|Account Logon Denied|AccountLogonDenied|"
                 r"Invalid Login|InvalidLogin|Steam Guard|two.factor|LogonFailure|"
                 r"Not logged on|NotLoggedOn|Cached credentials.*(?:invalid|expired)", output, re.I):
        return "authentication_required"
    return "download_failed"


def logged_in(output):
    return bool(re.search(r"Logged in OK|Waiting for user info[^\r\n]*OK|"
                          r"Logging in[^\r\n]*\.\.\.OK", output, re.I))
