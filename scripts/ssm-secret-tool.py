#!/usr/bin/env python3
"""Create or rotate an externally managed SSM SecureString without exposing its value."""

from __future__ import annotations

import argparse
import base64
import secrets
import sys
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError


MAX_STANDARD_SECURE_STRING_BYTES = 4096
DEFAULT_KEY_ID = "alias/aws/ssm"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--expected-account-id", required=True)
    parser.add_argument("--parameter-name", required=True)
    parser.add_argument("--description", required=True)
    parser.add_argument("--environment", required=True, choices=("dev", "prod"))
    parser.add_argument("--project", default="halospawns")
    parser.add_argument("--tag", action="append", default=[], metavar="KEY=VALUE")

    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-parameter-name")
    source.add_argument("--value-file", type=Path)
    source.add_argument("--value-stdin", action="store_true")
    source.add_argument("--generate-bytes", type=int)
    return parser


def _tags(args: argparse.Namespace) -> dict[str, str]:
    tags = {
        "Project": args.project,
        "Environment": args.environment,
        "ManagedBy": "halospawns-infra",
        "SecretBackend": "ssm-parameter-store",
    }
    for item in args.tag:
        key, separator, value = item.partition("=")
        if not separator or not key.strip() or not value.strip():
            raise ValueError("--tag values must use non-empty KEY=VALUE syntax")
        tags[key.strip()] = value.strip()
    return tags


def _load_value(
    args: argparse.Namespace,
    ssm: Any,
) -> str:
    if args.source_parameter_name:
        response = ssm.get_parameter(Name=args.source_parameter_name, WithDecryption=True)
        value = response.get("Parameter", {}).get("Value", "")
    elif args.value_file:
        value = args.value_file.read_text(encoding="utf-8")
    elif args.value_stdin:
        value = sys.stdin.read().rstrip("\r\n")
    else:
        if args.generate_bytes < 1:
            raise ValueError("--generate-bytes must be positive")
        value = base64.urlsafe_b64encode(secrets.token_bytes(args.generate_bytes)).decode("ascii").rstrip("=")

    if not value or not value.strip():
        raise ValueError("The secret value must not be empty")
    if len(value.encode("utf-8")) > MAX_STANDARD_SECURE_STRING_BYTES:
        raise ValueError("The secret value exceeds the 4096-byte standard parameter limit")
    return value


def _parameter_metadata(ssm: Any, name: str) -> dict[str, Any] | None:
    response = ssm.describe_parameters(
        ParameterFilters=[{"Key": "Name", "Option": "Equals", "Values": [name]}],
        MaxResults=10,
    )
    matches = [parameter for parameter in response.get("Parameters", []) if parameter.get("Name") == name]
    if not matches:
        return None
    if len(matches) != 1:
        raise RuntimeError("Parameter metadata lookup returned an ambiguous result")
    return matches[0]


def _validate_existing_parameter(metadata: dict[str, Any]) -> None:
    if metadata.get("Type") != "SecureString":
        raise RuntimeError("Existing parameter is not a SecureString")
    if metadata.get("Tier", "Standard") != "Standard":
        raise RuntimeError("Existing parameter is not standard tier")
    if metadata.get("KeyId", DEFAULT_KEY_ID) != DEFAULT_KEY_ID:
        raise RuntimeError("Existing parameter does not use alias/aws/ssm")


def _put_parameter(
    ssm: Any,
    *,
    name: str,
    description: str,
    value: str,
) -> tuple[str, int]:
    metadata = _parameter_metadata(ssm, name)
    if metadata is not None:
        _validate_existing_parameter(metadata)
        existing = ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"].get("Value")
        if existing == value:
            return "unchanged", int(metadata.get("Version", 0))

    response = ssm.put_parameter(
        Name=name,
        Description=description,
        Value=value,
        Type="SecureString",
        KeyId=DEFAULT_KEY_ID,
        Tier="Standard",
        Overwrite=metadata is not None,
    )
    return ("updated" if metadata is not None else "created"), int(response["Version"])


def _tag_parameter(ssm: Any, name: str, tags: dict[str, str]) -> None:
    ssm.add_tags_to_resource(
        ResourceType="Parameter",
        ResourceId=name,
        Tags=[{"Key": key, "Value": value} for key, value in sorted(tags.items())],
    )


def main() -> int:
    args = _parser().parse_args()
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    account_id = session.client("sts").get_caller_identity()["Account"]
    if account_id != args.expected_account_id:
        raise RuntimeError(
            f"AWS profile resolved to account {account_id}; expected {args.expected_account_id}"
        )

    ssm = session.client("ssm")
    value = _load_value(args, ssm)

    status, version = _put_parameter(
        ssm,
        name=args.parameter_name,
        description=args.description,
        value=value,
    )
    _tag_parameter(ssm, args.parameter_name, _tags(args))

    print(f"parameter={args.parameter_name} status={status} version={version}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ClientError, OSError, RuntimeError, UnicodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from None
