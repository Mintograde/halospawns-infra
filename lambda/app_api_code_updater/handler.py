import json
import logging
import os
import time
from urllib.parse import unquote_plus

import boto3


LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

LAMBDA = boto3.client("lambda")

TARGET_FUNCTION_NAME = os.environ["TARGET_FUNCTION_NAME"]
TARGET_ALIAS_NAME = os.environ.get("TARGET_ALIAS_NAME", "live")
ARTIFACT_RELEASE_PREFIX = os.environ.get("ARTIFACT_RELEASE_PREFIX", "releases/")
ARTIFACT_SUFFIX = os.environ.get("ARTIFACT_SUFFIX", ".zip")
WAIT_TIMEOUT_SECONDS = int(os.environ.get("WAIT_TIMEOUT_SECONDS", "300"))


def _wait_for_function_update(function_name):
    deadline = time.time() + WAIT_TIMEOUT_SECONDS

    while True:
        configuration = LAMBDA.get_function_configuration(FunctionName=function_name)
        status = configuration.get("LastUpdateStatus")
        state = configuration.get("State")

        if status == "Successful" and state == "Active":
            return configuration

        if status == "Failed":
            reason = configuration.get("LastUpdateStatusReason", "unknown reason")
            raise RuntimeError(f"Lambda code update failed: {reason}")

        if time.time() >= deadline:
            raise TimeoutError(f"Timed out waiting for Lambda update after {WAIT_TIMEOUT_SECONDS} seconds")

        time.sleep(2)


def _deploy_artifact(bucket, key, version_id):
    update_args = {
        "FunctionName": TARGET_FUNCTION_NAME,
        "S3Bucket": bucket,
        "S3Key": key,
        "Publish": True,
    }

    if version_id and version_id != "null":
        update_args["S3ObjectVersion"] = version_id

    response = LAMBDA.update_function_code(**update_args)
    _wait_for_function_update(TARGET_FUNCTION_NAME)

    lambda_version = response["Version"]
    LAMBDA.update_alias(
        FunctionName=TARGET_FUNCTION_NAME,
        Name=TARGET_ALIAS_NAME,
        FunctionVersion=lambda_version,
        Description=f"Deployed from s3://{bucket}/{key}",
    )

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
