import copy
import io
import json
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import test_cloud as support
from test_cloud import record
from h1_film import client_views as views, cloud, worker


class ClientViewTests(unittest.TestCase):
    setUp = support.CloudTests.setUp

    def job(self):
        return json.loads((Path(__file__).parent / "fixtures/api-client-view-job.json").read_text())

    def test_registered_client_job_rejects_changed_role_recipe_version_and_generation(self):
        # setUp also has a host fixture named job; use the class method explicitly.
        job = ClientViewTests.job(self)
        dispatch = {"schema": views.DISPATCH, "upload_id": job["identity"]["upload_id"], "attempt_id": job["attempt_id"]}
        views.validate_job(job, dispatch)
        for mutate in (
            lambda j: j["identity"].update(recording_role="host"),
            lambda j: j["identity"]["source"].update(s3_version_id="null"),
            lambda j: j["identity"].update(exporter_revision=12),
            lambda j: j["identity"].update(analytics_revision=4),
            lambda j: j["identity"].update(clock_source=j["identity"]["source"]),
            lambda j: j["output"].update(prefix="replays/derived/viewer/other/"),
            lambda j: j["viewer_artifact_target"].update(encoding_sha256="f" * 64),
            lambda j: j.update(requested_outputs=["game", "stats"]),
        ):
            invalid = copy.deepcopy(job)
            mutate(invalid)
            with self.assertRaises((cloud.FilmError, self.shared.NonRetryableReplayError)):
                views.validate_job(invalid, dispatch)

    def test_dispatch_is_closed_and_cannot_enter_host_callbacks(self):
        job = ClientViewTests.job(self)
        dispatch = {"schema": views.DISPATCH, "upload_id": job["identity"]["upload_id"], "attempt_id": job["attempt_id"]}
        self.assertEqual(cloud.work_from_record(record(dispatch)), dispatch)
        with self.assertRaises(cloud.FilmError):
            cloud.work_from_record(record({**dispatch, "job": job}))
        with patch.object(views, "execute") as execute:
            cloud.execute(dispatch, None)
            execute.assert_called_once_with(dispatch, None)

    def test_frozen_source_survives_newer_object_and_retry_never_heads_latest(self):
        job = ClientViewTests.job(self)
        source = job["identity"]["source"]
        item = {"upload_id": job["identity"]["upload_id"], "source": {**source, "s3_version_id": "later", "size_bytes": 123}}
        self.assertEqual(views.source_for(item, {"source": source}), source)
        self.shared.S3.head_object.assert_not_called()

    def test_wrong_clock_recorder_match_or_host_proof_is_rejected(self):
        job = ClientViewTests.job(self)
        independent = copy.deepcopy(job["evidence"])
        independent["host"]["source"].update(s3_key="films/unprocessed/another-host.h1film", sha256="f" * 64,
                                             s3_version_id="other-machine-v1")
        independent["host"]["recorded_own_player"] = 1
        views.validate_association(independent)
        for field, value in (("match_id", "1111111111111111"), ("recorded_own_player", 15), ("recording_role", "client")):
            evidence = copy.deepcopy(job["evidence"])
            evidence["clock_host"][field] = value
            with self.assertRaises(cloud.FilmError):
                views.validate_association(evidence)
        context = json.loads((Path(__file__).parent / "fixtures/api-client-view-context.json").read_text())
        views.verify_host(job["evidence"]["host"], context["host"])
        context["host"]["artifact"]["metadata"]["h1film"]["seed_mismatches"] = 1
        with self.assertRaises(cloud.FilmError):
            views.verify_host(job["evidence"]["host"], context["host"])

    def test_terminal_delivery_does_not_prepare_download_or_simulate(self):
        job = ClientViewTests.job(self)
        dispatch = {"schema": views.DISPATCH, "upload_id": job["identity"]["upload_id"], "attempt_id": job["attempt_id"]}
        for status in views.TERMINAL:
            with patch.object(cloud, "api", return_value={"data": {**dispatch, "status": status, "job": job}}) as api, \
                 patch.object(cloud, "download") as download, patch.object(views, "convert") as convert:
                views.execute(copy.deepcopy(dispatch), SimpleNamespace(get_remaining_time_in_millis=lambda: 900000))
                self.assertEqual(api.call_count, 2)
                self.assertEqual(api.call_args.args[1:], (
                    "/v1/ingest/h1films/reconcile", {"upload_id": dispatch["upload_id"]}))
                download.assert_not_called()
                convert.assert_not_called()

    def test_untrusted_metadata_cannot_fail_another_attempt(self):
        with patch.object(cloud, "api") as api:
            with self.assertRaises(cloud.FilmError):
                views.report_failure({"attempt_id": "arbitrary"}, cloud.FilmError("invalid_source"))
            api.assert_not_called()
            views.report_failure({"attempt_id": "authorized", "_authorized_attempt": True}, cloud.FilmError("verification_failed"))
            api.assert_called_once_with("POST", views.API + "/failed", {"attempt_id": "authorized", "code": "verification_failed"})

    def test_timeline_preserves_partial_coverage_repeats_and_original_order(self):
        job = ClientViewTests.job(self)
        client = {**job["evidence"]["client"], "clocks": [{"frame": 0, "game_tick": 34009}, {"frame": 400, "game_tick": 34009}]}
        clock = {"alignment_rows": [[34010, 34046], [34009, 34045]]}
        self.assertEqual(views.timeline(job, client, clock)["alignment_rows"], clock["alignment_rows"])
        for clocks in ([], [{"frame": 1, "game_tick": 1}], [{"frame": 0, "game_tick": 1}, {"frame": 0, "game_tick": 2}]):
            with self.assertRaises(cloud.FilmError):
                views.timeline(job, {**client, "clocks": clocks}, clock)
