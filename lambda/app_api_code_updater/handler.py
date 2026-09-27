import hashlib
import json
import logging
import os
import shutil
import tempfile
import time
import zipfile
from urllib.parse import unquote_plus
from urllib.request import urlopen

import boto3


LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

LAMBDA = boto3.client("lambda")

TARGET_FUNCTION_NAME = os.environ["TARGET_FUNCTION_NAME"]
TARGET_ALIAS_NAME = os.environ.get("TARGET_ALIAS_NAME", "live")
ARTIFACT_RELEASE_PREFIX = os.environ.get("ARTIFACT_RELEASE_PREFIX", "releases/")
ARTIFACT_SUFFIX = os.environ.get("ARTIFACT_SUFFIX", ".zip")
WAIT_TIMEOUT_SECONDS = int(os.environ.get("WAIT_TIMEOUT_SECONDS", "300"))
EXPECTED_CONFIGURATION_HASH = os.environ.get("EXPECTED_CONFIGURATION_HASH")


def _get_alias():
    alias = LAMBDA.get_alias(FunctionName=TARGET_FUNCTION_NAME, Name=TARGET_ALIAS_NAME)
    if alias.get("RoutingConfig", {}).get("AdditionalVersionWeights"):
        raise RuntimeError("Weighted aliases are not supported by this updater")
    return alias


def _configuration_snapshot(configuration):
    # Compare versioned settings, excluding version IDs and deployment descriptions.
    fields = (
        "Architectures", "CodeSha256", "DeadLetterConfig", "EphemeralStorage",
        "FileSystemConfigs", "Handler", "KMSKeyArn", "LoggingConfig", "MemorySize",
        "PackageType", "Role", "Runtime", "Timeout", "TracingConfig", "VpcConfig",
    )
    snapshot = {field: configuration.get(field) for field in fields}
    snapshot["Environment"] = configuration.get("Environment", {}).get("Variables", {})
    snapshot["Layers"] = [layer["Arn"] for layer in configuration.get("Layers", [])]
    snapshot["SnapStart"] = configuration.get("SnapStart", {}).get("ApplyOn", "None")
    snapshot["ImageConfig"] = configuration.get("ImageConfigResponse", {}).get("ImageConfig", {})
    return snapshot


def _assert_ready(configuration):
    if (
        configuration.get("State") != "Active"
        or configuration.get("LastUpdateStatus", "Successful") != "Successful"
        or configuration.get("Environment", {}).get("Error")
    ):
        raise RuntimeError("Lambda configuration is not ready for promotion")


def _assert_unchanged(alias, configuration):
    current_alias = _get_alias()
    current = LAMBDA.get_function_configuration(FunctionName=TARGET_FUNCTION_NAME)
    _assert_ready(current)
    if (
        current_alias["RevisionId"] != alias["RevisionId"]
        or current["RevisionId"] != configuration["RevisionId"]
        or _configuration_snapshot(current) != _configuration_snapshot(configuration)
    ):
        raise RuntimeError("A release or configuration changed during promotion; retry after it finishes")


def _assert_asset_package_support(configuration):
    if not EXPECTED_CONFIGURATION_HASH:
        return
    mode = configuration.get("Environment", {}).get("Variables", {}).get("ASSET_DELIVERY_MODE", "s3")
    if mode == "s3":
        return
    if mode not in ("cloudfront", "cloudfront_signed"):
        raise RuntimeError("Invalid asset delivery mode")
    package = LAMBDA.get_function(FunctionName=TARGET_FUNCTION_NAME, Qualifier=configuration["Version"])
    try:
        # Keep the presigned package URL and download diagnostics out of logs.
        with urlopen(package["Code"]["Location"], timeout=30) as response, tempfile.TemporaryFile() as archive:
            shutil.copyfileobj(response, archive)
            archive.seek(0)
            with zipfile.ZipFile(archive) as contents:
                supported = "halospawns_api/aws/asset_delivery.py" in contents.namelist()
    except Exception:
        raise RuntimeError("Cannot inspect the API package for asset delivery support") from None
    if not supported:
        raise RuntimeError("Publish a compatible API artifact before enabling CDN delivery")


def _promote_version(alias, configuration, version, description):
    candidate = _wait_for_function_update(TARGET_FUNCTION_NAME, version)
    _assert_ready(candidate)
    if _configuration_snapshot(candidate) != _configuration_snapshot(configuration):
        raise RuntimeError("Published version does not match the expected code and configuration")
    _assert_asset_package_support(candidate)
    _assert_unchanged(alias, configuration)
    LAMBDA.update_alias(
        FunctionName=TARGET_FUNCTION_NAME,
        Name=TARGET_ALIAS_NAME,
        FunctionVersion=version,
        Description=description,
        RevisionId=alias["RevisionId"],
    )
    if _get_alias()["FunctionVersion"] != version:
        raise RuntimeError("Live alias changed after promotion")


def _find_configuration_version(configuration):
    versions = []
    pages = LAMBDA.get_paginator("list_versions_by_function").paginate(FunctionName=TARGET_FUNCTION_NAME)
    for page in pages:
        versions.extend(
            version["Version"] for version in page["Versions"]
            if version["Version"].isdigit() and version.get("CodeSha256") == configuration["CodeSha256"]
        )
    for version in sorted(versions, key=int, reverse=True):
        candidate = LAMBDA.get_function_configuration(FunctionName=TARGET_FUNCTION_NAME, Qualifier=version)
        if _configuration_snapshot(candidate) == _configuration_snapshot(configuration):
            return version
    raise RuntimeError("No published version matches the configuration; apply the Lambda configuration first")


def _promote_configuration(event):
    configuration_json = event.get("configuration_json", "")
    configuration_hash = event.get("configuration_hash")
    if (
        not EXPECTED_CONFIGURATION_HASH
        or configuration_hash != EXPECTED_CONFIGURATION_HASH
        or not isinstance(configuration_json, str)
        or hashlib.sha256(configuration_json.encode("utf-8")).hexdigest() != configuration_hash
    ):
        raise RuntimeError("Configuration promotion is disabled or the request is stale")
    expected = json.loads(configuration_json)
    if not isinstance(expected, dict) or not expected:
        raise RuntimeError("Expected a non-empty configuration object")
    alias = _get_alias()
    latest = _wait_for_function_update(TARGET_FUNCTION_NAME)
    _assert_ready(latest)
    if any(latest.get(key) != value for key, value in expected.items()):
        raise RuntimeError("Applied Lambda configuration does not match the promotion request")
    live = LAMBDA.get_function_configuration(FunctionName=TARGET_FUNCTION_NAME, Qualifier=alias["FunctionVersion"])
    if live["CodeSha256"] != latest["CodeSha256"]:
        raise RuntimeError("LATEST differs from live code; finish the release or restore the rolled-back artifact first")
    if _configuration_snapshot(live) == _configuration_snapshot(latest):
        _assert_asset_package_support(live)
        _assert_unchanged(alias, latest)
        version = alias["FunctionVersion"]
        status = "already_current"
    else:
        version = _find_configuration_version(latest)
        _promote_version(alias, latest, version, alias.get("Description", ""))
        status = "promoted"
    result = {"status": status, "configuration_hash": configuration_hash, "lambda_version": version}
    LOGGER.info("API configuration promotion: %s", json.dumps(result, sort_keys=True))
    return result


def _wait_for_function_update(function_name, qualifier=None):
    deadline = time.time() + WAIT_TIMEOUT_SECONDS
    arguments = {"FunctionName": function_name}
    if qualifier:
        arguments["Qualifier"] = qualifier

    while True:
        configuration = LAMBDA.get_function_configuration(**arguments)
        status = configuration.get("LastUpdateStatus", "Successful")
        state = configuration.get("State")

        if status == "Successful" and state == "Active":
            return configuration

        if status == "Failed" or state == "Failed":
            raise RuntimeError("Lambda update failed; inspect its update status")

        if time.time() >= deadline:
            raise TimeoutError(f"Timed out waiting for Lambda update after {WAIT_TIMEOUT_SECONDS} seconds")

        time.sleep(2)


def _deploy_artifact(bucket, key, version_id):
    alias = _get_alias()
    previous = _wait_for_function_update(TARGET_FUNCTION_NAME)
    deployment_description = f"Deployed from s3://{bucket}/{key}"
    update_args = {
        "FunctionName": TARGET_FUNCTION_NAME,
        "S3Bucket": bucket,
        "S3Key": key,
        "RevisionId": previous["RevisionId"],
    }

    if version_id and version_id != "null":
        update_args["S3ObjectVersion"] = version_id

    response = LAMBDA.update_function_code(**update_args)
    configuration = _wait_for_function_update(TARGET_FUNCTION_NAME)
    if configuration["CodeSha256"] != response["CodeSha256"]:
        raise RuntimeError("Another release changed the staged code")
    _assert_unchanged(alias, configuration)

    publish_args = {
        "FunctionName": TARGET_FUNCTION_NAME,
        "Description": deployment_description,
        "CodeSha256": response["CodeSha256"],
        "RevisionId": configuration["RevisionId"],
    }

    version_response = LAMBDA.publish_version(**publish_args)
    lambda_version = version_response["Version"]

    _promote_version(alias, configuration, lambda_version, deployment_description)

    deployment = {
        "bucket": bucket,
        "key": key,
        "object_version": version_id,
        "lambda_version": lambda_version,
        "alias": TARGET_ALIAS_NAME,
    }
    LOGGER.info("Deployed app API artifact: %s", json.dumps(deployment, sort_keys=True))
    return deployment


def handler(event, context):
    if event.get("operation") == "promote_configuration":
        return _promote_configuration(event)
    if "operation" in event:
        raise RuntimeError("Unsupported updater operation")
    deployments = []

    for record in event.get("Records", []):
        if record.get("eventSource") != "aws:s3":
            LOGGER.info("Skipping non-S3 event record")
            continue

        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])
        version_id = record["s3"]["object"].get("versionId")

        if not key.startswith(ARTIFACT_RELEASE_PREFIX) or not key.endswith(ARTIFACT_SUFFIX):
            LOGGER.info("Skipping object outside release filter: s3://%s/%s", bucket, key)
            continue

        deployments.append(_deploy_artifact(bucket, key, version_id))

    return {
        "statusCode": 200,
        "body": json.dumps({"deployments": deployments}),
    }
