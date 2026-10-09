import copy
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import cloud, worker

FIXTURES = Path(__file__).with_name("fixtures")
ENV = {
    "ENVIRONMENT": "dev",
    "H1_WORKER_MODE": "intake",
    "H1_UPLOADS_BUCKET": "contract-fixture-bucket",
    "H1_QUEUE_ARN": "arn:aws:sqs:us-east-1:283279960672:films-processing-queue",
    "H1_TOPIC_ARN": "arn:aws:sns:us-east-1:283279960672:films-uploaded",
    "H1_MAX_SIZE_BYTES": "536870912",
    "H1_MAX_SOURCE_TICKS": "432000",
    "H1_MAX_PLAYERS": "4",
    "APP_API_BASE_URL": "https://api.dev.halospawns.com",
    "APP_API_TRUSTED_CLIENT_NAME": "h1-film",
    "APP_API_TRUSTED_CLIENT_HMAC_PARAMETER_NAME": "/fixture/hmac",
}


def fixture(name):
    value = json.loads((FIXTURES / f"api-{name}.json").read_text())
    return value.get("job", value)


def record(payload):
    return {
        "messageId": "message-1",
        "eventSource": "aws:sqs",
        "eventSourceARN": ENV["H1_QUEUE_ARN"],
        "body": json.dumps(payload),
    }


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.addCleanup(self.env.stop)
        with patch("boto3.client"):
            self.shared = cloud.shared_parser()
        self.s3 = patch.object(self.shared, "S3", MagicMock())
        self.s3.start()
        self.addCleanup(self.s3.stop)
        self.job = fixture("initial-job")

    def test_api_job_fixtures_and_target_fences(self):
        for name in ("initial-job", "viewer-rebuild-job", "full-reparse-job"):
            with self.subTest(name=name):
                request = cloud.validate_job(fixture(name))
                self.assertEqual(request.profile_revision, 2)
        for mutate in (
            lambda j: j.update(environment="prod"),
            lambda j: j.update(generation_token="77777777-7777-4777-8777-777777777777"),
            lambda j: j["conversion"]["engine"].update(wasm_sha256="b" * 64),
            lambda j: j["conversion"]["source"].update(s3_bucket="other-bucket"),
            lambda j: j["conversion"]["source"].update(s3_version_id="null"),
            lambda j: j["conversion"]["map_binding"]["raw_source"].update(
                s3_key="maps/unprocessed/../private.map"
            ),
            lambda j: j["conversion"]["map_binding"].update(scenario="different"),
            lambda j: j["viewer_artifact_target"].update(request_sequence=True),
            lambda j: j.update(command="arbitrary"),
            lambda j: j.update(requested_outputs=["viewer_artifact"]),
        ):
            value = copy.deepcopy(self.job)
            mutate(value)
            with self.assertRaises(
                (cloud.FilmError, self.shared.NonRetryableReplayError)
            ):
                cloud.validate_job(value)

    def test_limits_require_explicit_configuration(self):
        for key, value in (
            ("H1_MAX_SIZE_BYTES", "536870913"),
            ("H1_MAX_SOURCE_TICKS", "0"),
            ("H1_MAX_PLAYERS", "5"),
        ):
            with (
                patch.dict(os.environ, {key: value}),
                self.assertRaises(cloud.FilmError),
            ):
                cloud.validate_job(self.job)

    def test_sqs_job_routing_and_exact_origin(self):
        self.assertEqual(cloud.work_from_record(record(self.job)), self.job)
        bad = record(self.job)
        bad["eventSourceARN"] = "xbox-queue"
        with self.assertRaises(cloud.FilmError):
            cloud.work_from_record(bad)
        with self.assertRaises(cloud.FilmError):
            cloud.work_from_record(
                record({"schema": "halospawns.replay_reprocess_job.v1"})
            )

    def test_bootstrap_requires_version_and_disjoint_prefix(self):
        source = self.job["conversion"]["source"]
        event = {
            "Records": [
                {
                    "eventSource": "aws:s3",
                    "eventName": "ObjectCreated:Put",
                    "s3": {
                        "bucket": {"name": source["s3_bucket"]},
                        "object": {
                            "key": source["s3_key"],
                            "size": source["size_bytes"],
                            "versionId": source["s3_version_id"],
                        },
                    },
                }
            ]
        }
        payload = {
            "Type": "Notification",
            "TopicArn": ENV["H1_TOPIC_ARN"],
            "Message": json.dumps(event),
        }
        self.assertEqual(
            cloud.work_from_record(record(payload))["upload_id"], self.job["upload_id"]
        )
        for key in (
            "replays/unprocessed/file.h1film",
            "films/unprocessed/../../file.h1film",
        ):
            event["Records"][0]["s3"]["object"]["key"] = key
            payload["Message"] = json.dumps(event)
            with self.assertRaises(cloud.FilmError):
                cloud.work_from_record(record(payload))
        event["Records"][0]["s3"]["object"].update(key=source["s3_key"], versionId=None)
        payload["Message"] = json.dumps(event)
        with self.assertRaises(cloud.FilmError):
            cloud.work_from_record(record(payload))

    def test_only_exact_s3_setup_event_is_ignored(self):
        payload = {
            "Type": "Notification",
            "TopicArn": ENV["H1_TOPIC_ARN"],
            "Message": json.dumps(
                {
                    "Service": "Amazon S3",
                    "Event": "s3:TestEvent",
                    "Bucket": ENV["H1_UPLOADS_BUCKET"],
                }
            ),
        }
        self.assertIsNone(cloud.work_from_record(record(payload)))
        payload["TopicArn"] = "untrusted-topic"
        with self.assertRaises(cloud.FilmError):
            cloud.work_from_record(record(payload))

    def test_download_checks_actual_version_size_and_hash(self):
        source = copy.deepcopy(self.job["conversion"]["source"])
        data = b"bounded-film"
        source.update(
            size_bytes=len(data), sha256=cloud.hashlib.sha256(data).hexdigest()
        )
        self.shared.S3.head_object.return_value = {
            "ContentLength": len(data),
            "VersionId": source["s3_version_id"],
            "ContentType": "application/octet-stream",
        }
        self.shared.S3.get_object.side_effect = lambda **kw: {
            "ContentLength": len(data),
            "VersionId": source["s3_version_id"],
            "Body": io.BytesIO(data),
        }
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(cloud.download(source, Path(temp) / "source"), source)
            source["sha256"] = "a" * 64
            with self.assertRaises(cloud.FilmError):
                cloud.download(source, Path(temp) / "tampered")
        self.assertEqual(
            self.shared.S3.get_object.call_args.kwargs["VersionId"],
            source["s3_version_id"],
        )

    def test_child_environment_has_no_credentials_or_preload_hooks(self):
        sensitive = {
            "AWS_ACCESS_KEY_ID": "private",
            "AWS_SECRET_ACCESS_KEY": "private",
            "AWS_SESSION_TOKEN": "private",
            "NODE_OPTIONS": "--import=hostile.mjs",
            "PYTHONPATH": "private",
            "APP_API_TRUSTED_CLIENT_HMAC_PARAMETER_NAME": "/private",
        }
        with patch.dict(os.environ, sensitive):
            env = cloud.child_environment()
            self.assertFalse(set(sensitive) & set(env))

    def test_subprocess_deadline_and_log_limit_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            with self.assertRaisesRegex(cloud.FilmError, "conversion_failed"):
                cloud.run_bounded(
                    [sys.executable, "-c", "import time; time.sleep(30)"],
                    work,
                    time.monotonic() + 0.5,
                )
            (work / "oversized.log").write_bytes(b"x" * (8 * 1024**2))
            with self.assertRaisesRegex(cloud.FilmError, "conversion_failed"):
                cloud.work_bytes(work)

    def test_completion_proof_checks_semantics_not_only_json_shape(self):
        proof = fixture("completion")["h1film"]
        cloud.validate_proof(self.job["conversion"], proof)
        for mutation in (
            {"played_tick_count": 119},
            {"hash_checks": 2},
            {"wasm_sha256": "a" * 64},
            {"recording_duration_seconds": 2},
            {"match_end_source_tick": 120},
        ):
            with self.assertRaises(cloud.FilmError):
                cloud.validate_proof(self.job["conversion"], {**proof, **mutation})

    def test_foundation_rejects_jobs_and_extra_health_fields(self):
        with patch.dict(os.environ, {"H1_WORKER_MODE": "foundation"}):
            for event in (
                {"Records": []},
                {
                    "schema": "halospawns.h1FilmHealth.v1",
                    "action": "health",
                    "path": "/tmp",
                },
            ):
                with self.assertRaisesRegex(ValueError, "foundation"):
                    worker.handler(event, None)

    def test_terminal_failures_are_acknowledged_only_after_status(self):
        item = {
            "upload_id": self.job["upload_id"],
            "source": self.job["conversion"]["source"],
        }
        with (
            patch.object(cloud, "work_from_record", return_value=item),
            patch.object(
                cloud, "execute", side_effect=cloud.FilmError("unsupported_build")
            ),
            patch.object(cloud, "report_failure") as report,
        ):
            event = {"Records": [record({})]}
            self.assertEqual(worker.handler(event, None), {"batchItemFailures": []})
            report.side_effect = RuntimeError("callback failed")
            self.assertEqual(
                worker.handler(event, None),
                {"batchItemFailures": [{"itemIdentifier": "message-1"}]},
            )

    def test_configuration_and_transient_failures_retry_without_public_raw_error(self):
        with (
            patch.object(cloud, "work_from_record", return_value=self.job),
            patch.object(
                cloud,
                "execute",
                side_effect=cloud.FilmError("retry_pending", retryable=True),
            ),
            patch.object(cloud, "report_failure") as report,
        ):
            self.assertEqual(
                worker.handler({"Records": [record({})]}, None),
                {"batchItemFailures": [{"itemIdentifier": "message-1"}]},
            )
            report.assert_not_called()

    def test_persisted_completion_pin_and_callback_are_rechecked(self):
        payload = fixture("completion")
        manifest = self.shared._completion_manifest(
            upload_id=self.job["upload_id"],
            generation_token=self.job["generation_token"],
            mode="initial",
            source_replay_sha256="a" * 64,
            callback_path="/v1/ingest/replay-uploads",
            callback_payload=payload,
            cleanup_object=None,
        )
        key = self.shared._completion_manifest_key(
            self.job["upload_id"], self.job["generation_token"]
        )
        self.shared.S3.list_objects_v2.return_value = {"Contents": [{"Key": key}]}
        with (
            patch.object(
                self.shared, "_load_completion_manifest", return_value=manifest
            ),
            patch.object(cloud, "api") as api,
        ):
            self.assertTrue(cloud.replay_completion(self.job))
            api.assert_called_once()
            manifest["callback"]["path"] = "/v1/ingest/map-uploads"
            with self.assertRaises(cloud.FilmError):
                cloud.replay_completion(self.job)
            api.assert_called_once()


if __name__ == "__main__":
    unittest.main()
