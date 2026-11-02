import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_cloud as support
from h1_film import client_views, cloud, worker


class IntakeTests(unittest.TestCase):
    setUp = support.CloudTests.setUp
    def test_client_classification_never_runs_host_conversion(self):
        source = self.job["conversion"]["source"]
        evidence = self.job["conversion"]["film"]
        item = {"upload_id": self.job["upload_id"], "source": source}

        def inspect(_path, _work, _deadline, *, intake):
            intake.update(recording_role="client", match_id="1234567890abcdef",
                          recorded_own_player=2, first_update=50, clock_recorded_own_player=None)
            return evidence

        with patch.object(cloud, "download", return_value=source), \
             patch.object(cloud, "inspect_film", side_effect=inspect), \
             patch.object(cloud, "api", return_value={"data": {"recording_role": "client"}}) as api, \
             patch.object(cloud, "convert") as convert:
            cloud.execute(item, SimpleNamespace(get_remaining_time_in_millis=lambda: 900000))
            self.assertEqual(api.call_count, 1)
            self.assertEqual(api.call_args.args[1], "/v1/ingest/h1films/intake")
            convert.assert_not_called()

    def test_normal_upload_source_is_valid_for_pinned_client_job(self):
        from test_client_views import ClientViewTests
        job = ClientViewTests.job(self)
        uid = job["identity"]["upload_id"]
        key = f"films/unprocessed/{uid}-anything.h1film"
        job["identity"]["source"]["s3_key"] = key
        job["evidence"]["client"]["source"]["s3_key"] = key
        item = {"schema": client_views.DISPATCH, "upload_id": uid, "attempt_id": job["attempt_id"]}
        client_views.validate_job(job, item)
        changed = copy.deepcopy(job)
        changed["identity"]["source"]["s3_key"] = key.replace(uid, self.job["upload_id"])
        with self.assertRaises(cloud.FilmError):
            client_views.validate_job(changed, item)

    def test_matching_event_is_queued_and_backfill_cannot_fail_host(self):
        item = {"schema": "halospawns.h1FilmIntakeEvent.v1",
                "event_id": self.job["upload_id"], "upload_id": self.job["upload_id"]}
        with patch.object(cloud, "api", return_value={"data": {
            "dispatched": 1, "complete": True, "pending": False,
        }}) as api, patch.object(cloud, "convert") as convert:
            result = cloud.execute(item, None)
            self.assertTrue(result["complete"])
            api.assert_called_once_with("POST", "/v1/ingest/h1films/reconcile",
                                        {"event_id": item["event_id"]})
            convert.assert_not_called()
            api.reset_mock()
            cloud.report_failure({"schema": "halospawns.h1FilmInspect.v1"}, cloud.FilmError())
            api.assert_not_called()

    def test_reconciliation_pages_and_delivery_failures_use_queue_retries(self):
        target = {"event_id": self.job["upload_id"]}
        with patch.object(cloud, "api", side_effect=[
            {"data": {"complete": False, "pending": False}},
            {"data": {"complete": True, "pending": True}},
            {"data": {"complete": True, "pending": False}},
        ]) as api:
            cloud.drain_intake_events(target)
            self.assertEqual(api.call_count, 3)
            self.assertTrue(all(call.args[2] == target for call in api.call_args_list))
        with patch.object(cloud, "api", return_value={"data": {"complete": False}}):
            with self.assertRaises(cloud.FilmError) as failure:
                cloud.drain_intake_events(target)
            self.assertTrue(failure.exception.retryable)

    def test_removed_schedule_is_not_accepted(self):
        with self.assertRaises(cloud.FilmError):
            worker.handler({"schema": "halospawns.h1FilmReconcile.v1"}, None)

    def test_completed_client_retries_failed_outbox_delivery_before_acknowledging(self):
        from test_client_views import ClientViewTests
        job = ClientViewTests.job(self)
        item = {"schema": client_views.DISPATCH, "upload_id": job["identity"]["upload_id"],
                "attempt_id": job["attempt_id"]}
        context = {**item, "status": "completed", "job": job}
        with patch.object(client_views, "initial_context", return_value=context), \
             patch.object(cloud, "api", side_effect=[cloud.FilmError("retry_pending", retryable=True),
                 {"data": {"complete": True, "pending": False}}]) as api, \
             patch.object(cloud, "download") as download, patch.object(client_views, "convert") as convert:
            event = {"Records": [support.record(item)]}
            event["Records"][0]["messageId"] = "completed-client"
            timer = SimpleNamespace(get_remaining_time_in_millis=lambda: 900000)
            self.assertEqual(worker.handler(event, timer), {
                "batchItemFailures": [{"itemIdentifier": "completed-client"}]})
            self.assertEqual(worker.handler(event, timer), {"batchItemFailures": []})
            self.assertEqual(api.call_count, 2)
            download.assert_not_called()
            convert.assert_not_called()

    def test_matching_events_are_bound_to_the_trusted_queue_and_exact_shape(self):
        message = {"schema": "halospawns.h1FilmIntakeEvent.v1",
                   "event_id": self.job["upload_id"], "upload_id": self.job["upload_id"]}
        self.assertEqual(cloud.work_from_record(support.record(message)), message)
        with self.assertRaises(cloud.FilmError):
            cloud.work_from_record(support.record({**message, "source": "untrusted"}))
        record = support.record(message)
        record["eventSourceARN"] += "-wrong"
        with self.assertRaises(cloud.FilmError):
            cloud.work_from_record(record)
