"""Lambda entry point. Foundation mode remains fail-closed during adoption."""

import json
import hashlib
import logging
import os
import random
import subprocess

import boto3
from botocore.config import Config

from . import cloud
from .world_pool import delivery

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)


def retry_record(record):
    failure = {"batchItemFailures": [{"itemIdentifier": record["messageId"]}]}
    queue_url = os.environ.get("H1_QUEUE_URL")
    if not (
        queue_url and record.get("receiptHandle") and record.get("eventSource") == "aws:sqs"
        and record.get("eventSourceARN") == os.environ.get("H1_QUEUE_ARN")
    ):
        return failure
    try:
        delivery_count = int(record["attributes"]["ApproximateReceiveCount"])
        # Spread callbacks after a burst. Every new delivery starts with the
        # full lease for conversion; only the finished invocation releases it early.
        floor = 60 * 2 ** min(max(delivery_count - 1, 0), 3)
        delay = random.randint(floor, 2 * floor)
        client = boto3.client("sqs", config=Config(
            connect_timeout=2, read_timeout=3, retries={"total_max_attempts": 1},
        ))
        client.change_message_visibility(
            QueueUrl=queue_url, ReceiptHandle=record["receiptHandle"], VisibilityTimeout=delay,
        )
        LOGGER.info("h1_retry_scheduled receive_count=%d delay_seconds=%d", delivery_count, delay)
    except Exception as error:
        # Preserve the original message and redrive policy even if SQS is unavailable.
        LOGGER.warning("h1_retry_visibility_failed type=%s", type(error).__name__)
    return failure


def handler(event, context):
    mode = os.environ.get("H1_WORKER_MODE", "foundation")
    cloud.require(mode in {"foundation", "intake"})
    if event == {"schema": "halospawns.h1FilmHealth.v1", "action": "health"}:
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                'import { handler } from "./handler.mjs"; console.log(JSON.stringify(await handler({schema:"halospawns.h1FilmHealth.v1",action:"health"})));',
            ],
            cwd=cloud.NODE_ROOT,
            env={**cloud.child_environment(), "H1_WORKER_MODE": "foundation"},
            check=True,
            capture_output=True,
            # Inventory reads every retained binary. A cold Lambda image can
            # spend longer than a minute fetching this growing immutable set.
            timeout=720,
        )
        health = json.loads(result.stdout)
        health.update(mode=mode, intake_enabled=mode == "intake")
        registry = json.loads((cloud.PACKAGE / "profiles/registry.json").read_text())
        health["release"] = {
            "release_id": os.environ.get("H1_WORKER_RELEASE_ID"),
            "image_digest": os.environ.get("H1_WORKER_IMAGE_DIGEST"),
            "registry_sha256": hashlib.sha256(json.dumps(
                registry, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
            ).encode()).hexdigest(),
        }
        return health
    if mode != "intake":
        raise ValueError(
            "H1 upload intake is not implemented in foundation mode; only health is accepted"
        )
    cloud.limits()
    cloud.require(isinstance(event, dict) and set(event) == {"Records"})
    records = event["Records"]
    cloud.require(isinstance(records, list) and len(records) == 1)
    record = records[0]
    cloud.require(
        isinstance(record, dict)
        and isinstance(record.get("messageId"), str)
        and record["messageId"]
    )
    item = None
    try:
        item = cloud.work_from_record(record)
        if item is not None:
            with delivery(record):
                cloud.execute(item, context)
    except cloud.FilmError as error:
        LOGGER.warning(
            "h1_failure reason=%s retryable=%s", error.reason, error.retryable
        )
        if item is not None and not error.retryable:
            try:
                cloud.report_failure(item, error)
                return {"batchItemFailures": []}
            except Exception:
                LOGGER.warning("h1_failure_status_retry")
    except Exception as error:
        # No raw film strings, credentials, event payloads or API responses in logs.
        LOGGER.error("h1_retryable_failure type=%s", type(error).__name__)
    else:
        return {"batchItemFailures": []}
    return retry_record(record)
