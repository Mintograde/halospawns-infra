"""Real packaged client conversion with versioned local storage and lost-callback replay."""
import argparse
import copy
import importlib.util
import json
import os
import shutil
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from h1_film import client_views as views, cloud, worker
from h1_film.registry import load_registry, select_exporter

spec = importlib.util.spec_from_file_location("verify_cloud", Path(__file__).with_name("verify-cloud.py"))
support = importlib.util.module_from_spec(spec)
spec.loader.exec_module(support)


def main():
    parser = argparse.ArgumentParser()
    for key in ("client", "host", "map", "host_output", "output", "manifest"):
        parser.add_argument("--" + key.replace("_", "-"), required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True)
    os.environ.update(ENVIRONMENT="dev", H1_WORKER_MODE="intake", H1_UPLOADS_BUCKET="contract-fixture-bucket",
        H1_QUEUE_ARN="arn:aws:sqs:us-east-1:283279960672:films-processing-queue",
        H1_TOPIC_ARN="arn:aws:sns:us-east-1:283279960672:films-uploaded", H1_MAX_SIZE_BYTES="536870912",
        H1_MAX_SOURCE_TICKS="432000", H1_MAX_PLAYERS="16", APP_API_BASE_URL="https://api.dev.halospawns.com",
        APP_API_TRUSTED_CLIENT_NAME="h1-film", APP_API_TRUSTED_CLIENT_HMAC_PARAMETER_NAME="/offline/not-read")
    host_job = json.loads((args.host_output / "job.json").read_text())
    final = json.loads((args.host_output / "finalization.json").read_text())
    # verify-cloud archives a callback wrapper, not a database row.
    final = final.get("payload", final)
    manifest = json.loads(args.manifest.read_text())
    upload_id, attempt_id, artifact_id, game_id = [str(uuid.uuid4()) for _ in range(4)]
    source = {"s3_bucket": "contract-fixture-bucket", "s3_key": f"{cloud.SOURCE_PREFIX}{upload_id}-anything.h1film",
        "s3_version_id": "original-client-v1", "sha256": cloud.analytics.sha256_file(args.client),
        "size_bytes": args.client.stat().st_size}
    host = {"identity": host_job["conversion"], "replay": {"game_id": game_id}, "artifact": {
        **final["viewer_artifact"], "id": artifact_id, "metadata": {"h1film": final["h1film"]},
        "tick_count": host_job["conversion"]["film"]["source_tick_count"]}}
    context = {"upload_id": upload_id, "attempt_id": attempt_id, "status": "queued", "job": None,
               "source": {k: v for k, v in source.items() if k != "s3_version_id"}, "host": host, "clock_host": host}
    original_context = copy.deepcopy(context)
    storage = support.LocalS3(args.output)
    storage.add(source, args.client, "application/octet-stream")
    storage.objects[source["s3_key"]]["Metadata"] = {"upload-id": upload_id, "source-kind": "h1film"}
    storage.add(host["identity"]["source"], args.host, "application/octet-stream")
    storage.add(host["identity"]["map_binding"]["raw_source"], args.map, "application/octet-stream")
    callbacks = []
    prepares = []
    intakes, reconciliations = [], []

    def api(method, path, payload=None):
        if method == "GET":
            assert path == views.API + "/attempts/" + attempt_id
            return {"data": copy.deepcopy(context)}
        assert method == "POST"
        if path == "/v1/ingest/h1films/intake":
            assert payload["recording_role"] == "client" and payload["source"] == source
            assert payload["upload_id"] == upload_id
            intakes.append(copy.deepcopy(payload))
            return {"data": {"recording_role": "client", "pending": False}}
        if path == "/v1/ingest/h1films/reconcile":
            assert payload == {"upload_id": upload_id} and context["status"] == "completed"
            reconciliations.append(copy.deepcopy(payload))
            if len(reconciliations) == 1:
                raise cloud.FilmError("retry_pending", retryable=True)
            return {"data": {"complete": True, "pending": False}}
        if path == views.API + "/prepare":
            views.validate_association(payload)
            prepares.append(copy.deepcopy(payload))
            recipe = next(r for r in manifest["client_view_recipes"][views.PROFILE]
                          if r["exporter_revision"] == payload["exporter_revision"])
            engine = select_exporter(load_registry()[views.PROFILE], recipe["exporter_revision"])
            import hashlib
            pin = {"release_id": manifest["release_id"], "image_digest": manifest["image_digest"],
                "manifest_sha256": hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                "policy_revision": 1, "recipe": recipe}
            identity = {"contract": views.CONTRACT, "recording_role": "client", "game_id": game_id,
                "upload_id": upload_id, "host_artifact_id": artifact_id, "source": source, "engine_profile": views.PROFILE,
                **{k: recipe[k] for k in ("exporter_revision", "viewer_revision", "analytics_revision")},
                **{k: engine[k] for k in ("wasm_sha256", "glue_sha256")},
                "map_binding_id": host["identity"]["map_binding"]["binding_id"],
                "raw_map": host["identity"]["map_binding"]["raw_source"],
                "match_id": payload["client"]["match_id"], "recorded_own_player": payload["client"]["recorded_own_player"],
                "clock_source": host["identity"]["source"], "release": pin}
            target = {k: v for k, v in host_job["viewer_artifact_target"].items()
                      if k not in {"generation_token", "request_epoch", "request_sequence"}}
            job = {"schema": views.CONTRACT, "attempt_id": attempt_id, "identity": identity, "evidence": payload,
                "requested_outputs": ["viewer_artifact"], "viewer_artifact_target": target,
                "output": {"s3_bucket": source["s3_bucket"], "prefix":
                    f"{cloud.shared_parser()._settings()['viewer_artifact_prefix'].rstrip('/')}/client-views/{upload_id}/generations/{attempt_id}/"}}
            context.update(status="prepared", job=job, source=source)
            return {"data": {"job": copy.deepcopy(job), "status": "prepared"}}
        assert path == views.API + "/complete", path
        views.validate_completion(context["job"], payload)
        callbacks.append(copy.deepcopy(payload))
        if len(callbacks) == 1:
            raise cloud.FilmError("retry_pending", retryable=True)
        context["status"] = "completed"
        return {"data": {"status": "completed", "selected": True}}

    s3_event = {"Records": [{"eventSource": "aws:s3", "eventName": "ObjectCreated:Put", "s3": {
        "bucket": {"name": source["s3_bucket"]}, "object": {"key": source["s3_key"],
        "versionId": source["s3_version_id"], "size": source["size_bytes"]}}}]}
    record = {"eventSource": "aws:sqs", "eventSourceARN": os.environ["H1_QUEUE_ARN"], "messageId": "client-1",
        "body": json.dumps({"Type": "Notification", "TopicArn": os.environ["H1_TOPIC_ARN"], "Message": json.dumps(s3_event)})}
    with patch("boto3.client"):
        shared = cloud.shared_parser()
    execute = views.execute
    def traced(*values):
        try:
            return execute(*values)
        except cloud.FilmError:
            raise
        except Exception:
            import traceback
            traceback.print_exc()
            raise
    with patch.object(shared, "S3", storage), patch.object(cloud, "api", api), patch.object(views, "execute", traced):
        lambda_context = SimpleNamespace(get_remaining_time_in_millis=lambda: 900000)
        with patch.object(views, "convert", side_effect=AssertionError("Intake simulated client")):
            assert worker.handler({"Records": [record]}, lambda_context) == {"batchItemFailures": []}
        assert len(intakes) == 1 and not callbacks and not prepares
        dispatch = {"schema": views.DISPATCH, "upload_id": upload_id, "attempt_id": attempt_id}
        record["body"] = json.dumps(dispatch)
        assert worker.handler({"Records": [record]}, lambda_context) == {"batchItemFailures": [{"itemIdentifier": "client-1"}]}
        assert len(callbacks) == 1 and len(prepares) == 1
        with patch.object(views, "convert", side_effect=AssertionError("Retry reran simulation")), patch.object(cloud, "download", side_effect=AssertionError("Retry read sources")):
            assert worker.handler({"Records": [record]}, lambda_context) == {"batchItemFailures": [{"itemIdentifier": "client-1"}]}
            assert worker.handler({"Records": [record]}, lambda_context) == {"batchItemFailures": []}
            assert worker.handler({"Records": [record]}, lambda_context) == {"batchItemFailures": []}
        assert len(callbacks) == 2 and callbacks[0] == callbacks[1]
        assert len(reconciliations) == 3
    (args.output / "intake.json").write_text(json.dumps(intakes, indent=2), encoding="utf-8")
    for name, value in (("context", original_context), ("prepare", prepares[0]), ("job", context["job"]), ("completion", callbacks[0])):
        (args.output / f"{name}.json").write_text(json.dumps(value, indent=2), encoding="utf-8")
    shutil.copyfile(args.client, args.output / "client.h1film")
    for name in ("artifact", "timeline"):
        shutil.copyfile(storage.objects[callbacks[0][name]["s3_key"]]["path"], args.output / name)
    (args.output / "verification.json").write_text(json.dumps({"status": "verified", "frame_count": callbacks[0]["frame_count"],
        "hash_checks": callbacks[0]["verified_hash_count"], "receipt_retry": True, "terminal_retry": True,
        "automatic_intake": True, "postcommit_outbox_retry": True}))
    print("Client simulation, immutable artifact/timeline, callback retry and terminal redelivery passed.")


if __name__ == "__main__":
    main()
