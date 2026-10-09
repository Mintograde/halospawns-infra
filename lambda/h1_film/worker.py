"""Lambda entry point. Foundation mode remains fail-closed during adoption."""

import json
import logging
import os
import subprocess

from . import cloud

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)


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
            timeout=20,
        )
        health = json.loads(result.stdout)
        health.update(mode=mode, intake_enabled=mode == "intake")
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
        return {"batchItemFailures": [{"itemIdentifier": record["messageId"]}]}
    except Exception as error:
        # No raw film strings, credentials, event payloads or API responses in logs.
        LOGGER.error("h1_retryable_failure type=%s", type(error).__name__)
        return {"batchItemFailures": [{"itemIdentifier": record["messageId"]}]}
    return {"batchItemFailures": []}
