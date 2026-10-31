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
from h1_film.registry import load_registry, select_exporter
from replay_parser.viewer_delta import VIEWER_CONTRACT_PINS, load_pinned_contract

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
        with patch.dict(os.environ, {"H1_MAX_PLAYERS": "16"}):
            self.assertEqual(cloud.limits()["PLAYERS"], 16)
            cloud.validate_job(self.job)
        for key, value in (
            ("H1_MAX_SIZE_BYTES", "536870913"),
            ("H1_MAX_SOURCE_TICKS", "0"),
            ("H1_MAX_PLAYERS", "17"),
        ):
            with (
                patch.dict(os.environ, {key: value}),
                self.assertRaises(cloud.FilmError),
            ):
                cloud.validate_job(self.job)

    def test_pose_revision_requires_the_exact_container_and_encoding_tuple(self):
        contract = load_pinned_contract(4)
        target = self.job["viewer_artifact_target"]
        target.update(
            profile_revision=4, projection_sha256=contract.source_contract["projection_sha256"],
            manifest_schema_sha256=contract.manifest_sha256, format=contract.encoding["format"],
            container_version=2, encoding_sha256=contract.encoding_sha256,
        )
        self.assertEqual(cloud.validate_job(self.job).profile_revision, 4)
        for key, value in (("container_version", 1), ("format", "halospawns.viewerReplayDelta.v1"),
                           ("encoding_sha256", "0" * 64), ("profile_revision", 3)):
            invalid = copy.deepcopy(self.job)
            invalid["viewer_artifact_target"][key] = value
            with self.assertRaises((cloud.FilmError, self.shared.NonRetryableReplayError)):
                cloud.validate_job(invalid)

    def test_conversion_requires_inline_lossless_evidence_without_second_readback(self):
        ticks = self.job["conversion"]["film"]["source_tick_count"]
        proof = {"mode": "inline-lossless", "120hz": ticks, "30hz": None}
        for evidence in (proof, None, {**proof, "120hz": ticks - 1},
                         {**proof, "30hz": 0}, {**proof, "mode": "unverified"}):
            with self.subTest(evidence=evidence), tempfile.TemporaryDirectory() as temporary:
                work = Path(temporary)

                def converted(command, *args, **kwargs):
                    self.assertIn("--skip-readback", command)
                    self.assertIn("--source-viewer-only", command)
                    self.assertIn("--engine-permissions", command)
                    candidate = work / "conversion/candidate"
                    candidate.mkdir(parents=True)
                    (candidate / "encoding.json").write_text(json.dumps({"verification": evidence}))

                with patch.object(cloud, "download"), patch.object(cloud, "run_bounded", converted):
                    if evidence == proof:
                        self.assertEqual(cloud.convert(self.job, work / "film", work,
                                                       time.monotonic() + 900), work / "conversion")
                    else:
                        with self.assertRaises(cloud.FilmError):
                            cloud.convert(self.job, work / "film", work, time.monotonic() + 900)

    def test_revision_three_requires_a_versioned_pinned_job(self):
        for revision in (1, 2, 3):
            job = copy.deepcopy(self.job)
            job.update(schema="halospawns.h1film_job.v2", analytics_revision=revision)
            job["conversion"]["engine"]["exporter_revision"] = 1
            self.assertEqual(cloud.validate_job(job).profile_revision, 2)
            self.assertEqual(cloud.work_from_record(record(job)), job)
        for mutate in (
            lambda j: j.update(analytics_revision=3),
            lambda j: j.update(schema="halospawns.h1film_job.v2"),
            lambda j: j.update(schema="halospawns.h1film_job.v2", analytics_revision=5),
            lambda j: j["conversion"]["engine"].update(exporter_revision=1),
            lambda j: j.update(schema="halospawns.h1film_job.v2", analytics_revision=True),
        ):
            job = copy.deepcopy(self.job)
            mutate(job)
            with self.assertRaises(cloud.FilmError):
                cloud.validate_job(job)
        job = copy.deepcopy(self.job)
        job.update(schema="halospawns.h1film_job.v2", analytics_revision=3)
        job["conversion"]["engine"]["exporter_revision"] = 2
        with self.assertRaises(cloud.FilmError):
            cloud.validate_job(job)

    def test_revision_three_completion_and_retry_must_echo_exact_pins(self):
        pin = copy.deepcopy(self.job["conversion"])
        proof = {**fixture("completion")["h1film"], "analytics_revision": 3, "recording_closed": True}
        cloud.validate_proof(pin, proof, analytics_revision=3)
        for revision in (None, 1, 2):
            with self.assertRaises(cloud.FilmError):
                cloud.validate_proof(pin, proof, analytics_revision=revision)
        pin["engine"]["exporter_revision"] = 1
        with self.assertRaises(cloud.FilmError):
            cloud.validate_proof(pin, proof, analytics_revision=3)
        cloud.validate_proof(pin, {**proof, "exporter_revision": 1}, analytics_revision=3)

    def test_registered_glass_exporter_and_viewer_revision_three_are_pinned(self):
        job = copy.deepcopy(self.job)
        job.update(schema="halospawns.h1film_job.v2", analytics_revision=3)
        profile = load_registry()[job["conversion"]["film"]["engine_profile"]]
        selected = select_exporter(profile, 2)
        job["conversion"]["engine"].update({key: selected[key] for key in (
            "wasm_sha256", "glue_sha256", "exporter_revision"
        )})
        projection, manifest = VIEWER_CONTRACT_PINS[3]
        job["viewer_artifact_target"].update(
            profile_revision=3, projection_sha256=projection, manifest_schema_sha256=manifest
        )
        self.assertEqual(cloud.validate_job(job).profile_revision, 3)
        for key in ("wasm_sha256", "glue_sha256"):
            invalid = copy.deepcopy(job)
            invalid["conversion"]["engine"][key] = profile[key]
            with self.assertRaises(cloud.FilmError):
                cloud.validate_job(invalid)

    def test_prepare_requests_native_analytics_but_recovers_already_pinned_jobs(self):
        source = self.job["conversion"]["source"]
        evidence = self.job["conversion"]["film"]
        item = {"upload_id": self.job["upload_id"], "source": source}
        for retained in (None, 1, 2, 3, 4, 5):
            job = copy.deepcopy(self.job)
            if retained != 1:
                job.update(schema="halospawns.h1film_job.v2",
                           analytics_revision=4 if retained in (None, 5) else 3)
                profile = load_registry()[evidence["engine_profile"]]
                selected = select_exporter(profile, retained or 5)
                job["conversion"]["engine"].update({key: selected[key] for key in (
                    "wasm_sha256", "glue_sha256", "exporter_revision"
                )})
                contract = load_pinned_contract(4)
                job["viewer_artifact_target"].update(
                    profile_revision=4,
                    projection_sha256=contract.source_contract["projection_sha256"],
                    manifest_schema_sha256=contract.manifest_sha256,
                    format=contract.encoding["format"], container_version=2,
                    encoding_sha256=contract.encoding_sha256,
                )
            responses = [{"data": {"job": job}}]
            with (
                patch.object(cloud, "download", return_value=source),
                patch.object(cloud, "inspect_film", return_value=evidence),
                patch.object(cloud, "replay_completion", return_value=True) as retry,
                patch.object(cloud, "api", side_effect=responses) as api,
            ):
                context = MagicMock()
                context.get_remaining_time_in_millis.return_value = 600000
                cloud.execute(item, context)
                self.assertTrue(api.call_args_list[0].args[2]["use_default_release"])
                self.assertNotIn("analytics_revision", api.call_args_list[0].args[2])
                self.assertNotIn("exporter_revision", api.call_args_list[0].args[2])
                self.assertEqual(api.call_count, 1)
                self.assertEqual(retry.call_args.args[0], job)

    def test_beta4_intake_selects_finite_world_exporter_and_retained_jobs_keep_their_pins(self):
        profile = load_registry()["h1-performance-beta4-p9803-wasm-v1"]
        for revision in (6, 7, 8, 9, 10):
            job = copy.deepcopy(self.job)
            job.update(schema="halospawns.h1film_job.v2", analytics_revision=4)
            film = job["conversion"]["film"]
            film.update(engine_profile=profile["id"], player_count=8,
                        **{key: profile[key] for key in ("format", "protocol_revision", "tick_rate", "build")})
            selected = select_exporter(profile, revision)
            job["conversion"]["engine"].update({key: selected[key] for key in (
                "format", "protocol_revision", "tick_rate", "build", "wasm_sha256", "glue_sha256", "exporter_revision"
            )})
            job["conversion"]["map_binding"]["engine_profile"] = profile["id"]
            contract = load_pinned_contract(5)
            job["viewer_artifact_target"].update(
                profile_revision=5, projection_sha256=contract.source_contract["projection_sha256"],
                manifest_schema_sha256=contract.manifest_sha256, format=contract.encoding["format"],
                container_version=2, encoding_sha256=contract.encoding_sha256,
            )
            source = job["conversion"]["source"]
            responses = [{"data": {"job": job}}]
            with (
                patch.dict(os.environ, {"H1_MAX_PLAYERS": "16"}),
                patch.object(cloud, "download", return_value=source),
                patch.object(cloud, "inspect_film", return_value=film),
                patch.object(cloud, "replay_completion", return_value=True) as retry,
                patch.object(cloud, "api", side_effect=responses) as api,
            ):
                context = MagicMock()
                context.get_remaining_time_in_millis.return_value = 600000
                cloud.execute({"upload_id": job["upload_id"], "source": source}, context)
                self.assertNotIn("exporter_revision", api.call_args_list[0].args[2])
                self.assertTrue(api.call_args_list[0].args[2]["use_default_release"])
                self.assertEqual(retry.call_args.args[0], job)
                self.assertEqual(api.call_count, 1)

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
        cloud.validate_proof(self.job["conversion"], {**proof, "analytics_revision": 2})
        for mutation in (
            {"played_tick_count": 119},
            {"hash_checks": 2},
            {"wasm_sha256": "a" * 64},
            {"recording_duration_seconds": 2},
            {"match_end_source_tick": 120},
            {"analytics_revision": 3},
        ):
            with self.assertRaises(cloud.FilmError):
                cloud.validate_proof(self.job["conversion"], {**proof, **mutation})

    def test_completion_proof_preserves_the_producer_analytics_revision(self):
        pin = self.job["conversion"]
        report = {
            "map_binding": {"map_id": pin["map_binding"]["map_id"]},
            "provenance": {
                **pin["engine"],
                "map_sha256": pin["map_binding"]["raw_source"]["sha256"],
            },
            "simulation": {
                "played_ticks": pin["film"]["source_tick_count"],
                "hash_checks": pin["film"]["hash_sample_count"],
                "hash_mismatches": 0,
                "seed_mismatches": 0,
            },
        }
        for revision in (1, 2):
            encoding = {"analytics": {"match_end_source_tick": 90}}
            if revision == 2:
                encoding["analytics_revision"] = 2
            proof = cloud.completion_proof(self.job, report, encoding)
            self.assertEqual(proof["analytics_revision"], revision)
            self.assertEqual(proof["source_tick_count"], 120)
            self.assertEqual(proof["recording_duration_seconds"], 1)
            self.assertEqual(proof["match_end_source_tick"], 90)

    def test_recovered_roster_is_pinned_and_cannot_use_a_retained_exporter(self):
        pin = self.job["conversion"]
        profile = load_registry()["h1-performance-beta5-p9818-wasm-v1"]
        selected = select_exporter(profile, 12)
        pin["engine"].update({key: selected[key] for key in (
            "format", "protocol_revision", "tick_rate", "build", "wasm_sha256",
            "glue_sha256", "exporter_revision",
        )})
        recovery = {
            "schema": "halospawns.h1InitialRosterRecovery.v1", "recorded_player_count": 8,
            "initial_player_count": 9, "initial_remote_mask": 511,
            "recovered_players": [{"slot": 8, "player_handle": -327679992, "team": 9,
                "damage_record_count": 2, "first_source_tick": 1, "last_source_tick": 119}],
        }
        pin["film"].update(engine_profile=profile["id"], player_count=9,
                            roster_recovery=recovery)
        pin["film"].update({key: selected[key] for key in cloud.IDENTITY})
        pin["map_binding"]["engine_profile"] = profile["id"]
        proof = fixture("completion")["h1film"]
        proof.update(engine_profile=profile["id"], exporter_revision=12,
            wasm_sha256=selected["wasm_sha256"], glue_sha256=selected["glue_sha256"],
            roster_recovery=copy.deepcopy(recovery))
        proof["network_host"] = {"provenance": "initial_fnet_all_remote_v1", "source_tick": 0,
            "initial_player_count": 9, "local_player_count": 0,
            "remote_player_mask": 511, "host_slots": []}
        cloud.validate_proof(pin, proof)
        for mutation in ({"roster_recovery": None}, {"exporter_revision": 11}):
            with self.assertRaises(cloud.FilmError):
                cloud.validate_proof(pin, {**proof, **mutation})
        changed = copy.deepcopy(proof)
        changed["roster_recovery"]["recovered_players"][0]["damage_record_count"] += 1
        with self.assertRaises(cloud.FilmError):
            cloud.validate_proof(pin, changed)
        self.job.update(schema="halospawns.h1film_job.v2", analytics_revision=1)
        with patch.dict(os.environ, {"H1_MAX_PLAYERS": "16"}):
            cloud.validate_job(self.job)
            pin["engine"]["exporter_revision"] = 11
            with self.assertRaises(cloud.FilmError):
                cloud.validate_job(self.job)

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

    def test_unknown_job_contract_retains_attempt_for_failure_callback(self):
        item = copy.deepcopy(self.job)
        item["schema"] = "halospawns.h1film_job.v99"
        item["attempt_id"] = "00000000-0000-4000-8000-000000000099"
        with patch.object(cloud, "report_failure") as report:
            context = MagicMock()
            context.get_remaining_time_in_millis.return_value = 900000
            result = worker.handler({"Records": [record(item)]}, context)
        self.assertEqual(result, {"batchItemFailures": []})
        self.assertEqual(report.call_args.args[0]["attempt_id"], item["attempt_id"])

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

    def test_timestamp_completion_keeps_original_job_identity_and_legacy_receipts(self):
        job = copy.deepcopy(self.job)
        profile = load_registry()["h1-performance-beta4-p9803-wasm-v1"]
        pin = job["conversion"]
        pin["film"].update(engine_profile=profile["id"], **{
            key: profile[key] for key in ("format", "protocol_revision", "tick_rate", "build")
        })
        pin["engine"].update(**{key: profile[key] for key in (
            "format", "protocol_revision", "tick_rate", "build", "wasm_sha256", "glue_sha256"
        )})
        report = {
            "engine_profile": profile["id"],
            "envelope": {"created_utc": 1792540800},
            "map_binding": pin["map_binding"],
            "simulation": {"played_ticks": pin["film"]["source_tick_count"],
                           "hash_checks": pin["film"]["hash_sample_count"],
                           "hash_mismatches": 0, "seed_mismatches": 0},
            "provenance": {"wasm_sha256": profile["wasm_sha256"],
                           "glue_sha256": profile["glue_sha256"],
                           "map_sha256": pin["map_binding"]["raw_source"]["sha256"]},
        }
        original = copy.deepcopy(pin)
        encoding = {"analytics": {"match_end_source_tick": 60}}
        proof = cloud.completion_proof(job, report, encoding)
        self.assertEqual(proof["created_utc"], 1792540800)
        self.assertEqual(pin, original)
        report["envelope"].pop("created_utc")
        legacy = cloud.completion_proof(job, report, encoding)
        self.assertNotIn("created_utc", legacy)
        cloud.validate_proof(pin, legacy)
        host = {"provenance": "initial_fnet_drop_mask_v1", "source_tick": 0,
                "initial_player_count": 2, "local_player_count": 1,
                "remote_player_mask": 2, "host_slots": [0]}
        pin["film"]["player_count"] = 3
        report["envelope"].update(first_update=0, players=2, network={"host": host})
        hosted = cloud.completion_proof(job, report, encoding)
        self.assertEqual(hosted["network_host"], host)
        self.assertNotIn("network_host", legacy)
        for changes in (
            {"host_slots": [1]}, {"host_slots": [0, 0]}, {"host_slots": [False]},
            {"remote_player_mask": 0}, {"remote_player_mask": 3},
            {"local_player_count": 2}, {"source_tick": 1}, {"initial_player_count": 4},
        ):
            with self.subTest(changes=changes), self.assertRaises(cloud.FilmError):
                cloud.validate_proof(pin, {**hosted, "network_host": {**host, **changes}})
        neutral = {**host, "provenance": "initial_fnet_all_remote_v1",
                   "local_player_count": 0, "remote_player_mask": 3, "host_slots": []}
        report["envelope"]["network"]["host"] = neutral
        for mode in ("initial", "full_reparse"):
            job["mode"] = mode
            self.assertEqual(cloud.completion_proof(job, report, encoding)["network_host"], neutral)
        for changes in (
            {"provenance": "initial_fnet_drop_mask_v1"}, {"remote_player_mask": 2},
            {"remote_player_mask": 7}, {"local_player_count": 1},
            {"local_player_count": False}, {"host_slots": [0]}, {"source_tick": 1},
            {"initial_player_count": 0}, {"initial_player_count": 9},
        ):
            with self.subTest(changes=changes), self.assertRaises(cloud.FilmError):
                cloud.validate_proof(pin, {**hosted, "network_host": {**neutral, **changes}})
        job["mode"] = "viewer_rebuild"
        self.assertNotIn("network_host", cloud.completion_proof(job, report, encoding))
        pin["film"]["engine_profile"] = self.job["conversion"]["film"]["engine_profile"]
        with self.assertRaises(cloud.FilmError):
            cloud.validate_proof(pin, proof)
        with self.assertRaises(cloud.FilmError):
            cloud.validate_proof(pin, hosted)

    def test_settings_receipts_validate_identity_and_replay_without_extraction(self):
        payload = fixture("completion")
        pin = self.job["conversion"]
        payload["h1film_settings"] = {
            "schema": "halospawns.h1FilmSettings.v1", "adapter_revision": 1, "catalogue_revision": 1,
            "engine_profile": pin["film"]["engine_profile"], "film_sha256": pin["source"]["sha256"],
            "raw_map_sha256": pin["map_binding"]["raw_source"]["sha256"],
            "settings": {"variant.shields": {"status": "available", "value": False, "provenance": "recorded_variant"}},
            "recorder_profiles": [],
        }
        manifest = self.shared._completion_manifest(
            upload_id=self.job["upload_id"], generation_token=self.job["generation_token"], mode="initial",
            source_replay_sha256=pin["source"]["sha256"], callback_path="/v1/ingest/replay-uploads",
            callback_payload=payload, cleanup_object=None,
        )
        key = self.shared._completion_manifest_key(self.job["upload_id"], self.job["generation_token"])
        self.shared.S3.list_objects_v2.return_value = {"Contents": [{"Key": key}]}
        with (
            patch.object(self.shared, "_load_completion_manifest", return_value=manifest),
            patch.object(cloud, "api") as api,
            patch.object(cloud.settings, "extract") as extract,
        ):
            self.assertTrue(cloud.replay_completion(self.job))
            self.assertEqual(api.call_args.args[2]["h1film_settings"], payload["h1film_settings"])
            extract.assert_not_called()
            for field in ("film_sha256", "raw_map_sha256", "engine_profile"):
                original = payload["h1film_settings"][field]
                payload["h1film_settings"][field] = "b" * 64
                with self.assertRaises(cloud.FilmError):
                    cloud.replay_completion(self.job)
                payload["h1film_settings"][field] = original
            api.assert_called_once()


if __name__ == "__main__":
    unittest.main()

class MissingMapSizeTests(unittest.TestCase):
    def test_versioned_missing_size_is_beta5_only(self):
        from jsonschema import Draft202012Validator
        schema = json.loads((cloud.PACKAGE / 'contracts/h1film-job.v1.schema.json').read_text())['$defs']['H1FilmEvidence']
        validate = Draft202012Validator(schema).is_valid
        film = copy.deepcopy(fixture('initial-job')['conversion']['film'])
        self.assertTrue(validate(film))
        film['map_size_bytes'] = 0
        self.assertFalse(validate(film))
        film['map_size_evidence'] = 'halospawns.h1MissingMapSize.v1'
        self.assertFalse(validate(film))
        film['engine_profile'] = 'h1-performance-beta5-p9818-wasm-v1'
        self.assertTrue(validate(film))
        film['map_size_bytes'] = 100
        self.assertFalse(validate(film))
