"""Read-only dev audit plus HMAC requests that must stop at the disabled gate."""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

import boto3

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import cloud


def main():
    session = boto3.Session(profile_name="halospawns-dev", region_name="us-east-1")
    assert session.client("sts").get_caller_identity()["Account"] == "283279960672"
    function = session.client("lambda").get_function_configuration(
        FunctionName="halospawns-dev-app-api", Qualifier="live")
    environment = function["Environment"]["Variables"]
    assert environment["H1FILM_UPLOADS_ENABLED"] == "false"
    assert environment["H1FILM_PROCESSING_ENABLED"] == "false"
    parameter = json.loads(environment["TRUSTED_SERVICE_HMAC_PARAMETER_NAMES"])["h1-film"]
    assert parameter == "/halospawns/dev/app-api/trusted-clients/h1-film/hmac-secret"
    secret = session.client("ssm").get_parameter(Name=parameter, WithDecryption=True)["Parameter"]["Value"]
    with patch("boto3.client"):
        shared = cloud.shared_parser()
    fixture = json.loads((cloud.PACKAGE / "tests/fixtures/api-prepare.json").read_text())
    results = []
    for suffix, payload in (("prepare", fixture), ("resolve-map", fixture["film"])):
        path = f"/v1/ingest/h1films/{suffix}"
        body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
        for signed in (False, True):
            headers = {"Content-Type": "application/json"}
            if signed:
                timestamp = str(int(time.time()))
                signature = shared._hmac_signature(client="h1-film", timestamp=timestamp,
                    method="POST", raw_path=path, raw_query_string="", body=body, secret=secret)
                headers.update({"X-Halospawns-Client": "h1-film", "X-Halospawns-Timestamp": timestamp,
                                "X-Halospawns-Signature": "sha256=" + signature})
            request = urllib.request.Request("https://api.dev.halospawns.com" + path,
                                             data=body, method="POST", headers=headers)
            try:
                urllib.request.build_opener(cloud.NoRedirect()).open(request, timeout=30)
                raise AssertionError("Disabled H1 route unexpectedly accepted a request")
            except urllib.error.HTTPError as error:
                response = json.loads(error.read(65536))
                code = response.get("error", {}).get("code")
                assert error.code in (401, 403), (error.code, code)
                assert code == "capability_disabled" if signed else code != "capability_disabled"
                results.append({"route": path, "signed": signed, "status": error.code, "code": code})
    print(json.dumps({"api_version": function["Version"], "uploads_enabled": False,
                      "processing_enabled": False, "hmac_route_checks": results}))


if __name__ == "__main__":
    main()
