#!/usr/bin/env python3
"""Provision dev Steam credential slots without printing or overwriting secrets."""
import argparse
import json

import boto3
from botocore.exceptions import ClientError

ACCOUNT = "283279960672"
PREFIX = "/halospawns/dev/workshop-maps/"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "status"))
    parser.add_argument("--profile", default="halospawns-dev")
    args = parser.parse_args()
    session = boto3.Session(profile_name=args.profile, region_name="us-east-1")
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise RuntimeError("Expected the Halospawns dev AWS account")
    ssm = session.client("ssm")
    for suffix, value, description in (
        ("steam-credentials", {"username": "", "password": ""},
         "Dedicated MCC Workshop Steam account. Populate username/password privately; empty means not configured."),
        ("steam-session", {},
         "SteamCMD cached authentication, managed by the Workshop bootstrap tool and worker. Do not edit manually."),
    ):
        name = PREFIX + suffix
        if args.action == "init":
            try:
                ssm.put_parameter(Name=name, Description=description,
                    Value=json.dumps(value), Type="SecureString", KeyId="alias/aws/ssm",
                    Tier="Standard", Overwrite=False, Tags=[
                        {"Key": "Project", "Value": "halospawns"},
                        {"Key": "Environment", "Value": "dev"},
                        {"Key": "ManagedBy", "Value": "halospawns-infra"},
                        {"Key": "SecretBackend", "Value": "ssm-parameter-store"},
                    ])
                print(f"{name}: created empty slot")
            except ClientError as error:
                if error.response["Error"]["Code"] != "ParameterAlreadyExists":
                    raise
                print(f"{name}: already exists; unchanged")
        result = ssm.describe_parameters(ParameterFilters=[
            {"Key": "Name", "Option": "Equals", "Values": [name]}])
        for parameter in result["Parameters"]:
            if parameter["Type"] != "SecureString" or parameter.get("KeyId") not in (
                "alias/aws/ssm", None,
            ):
                raise RuntimeError("Unexpected parameter encryption configuration")
            print(f"{name}: type={parameter['Type']} version={parameter['Version']}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # SDK errors can contain request data. Never print exception bodies.
        raise SystemExit("Steam parameter operation failed; check AWS account, session and permissions.") from None
