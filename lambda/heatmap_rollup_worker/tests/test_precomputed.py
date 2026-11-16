import gzip
import hashlib
import io
import json
import unittest
from dataclasses import replace
from unittest.mock import patch

from test_handler import _claim, _settings, handler


class PrecomputedTests(unittest.TestCase):
    def test_backfill_verifies_source_without_claiming_or_changing_generations(self):
        document = handler.RollupAccumulator(_claim()).document()
        payload = gzip.compress(json.dumps(document).encode())
        event = {"operation": "precompute", "key": "replays/derived/heatmap-rollups/existing.gz",
                 "sha256": hashlib.sha256(payload).hexdigest()}
        settings = replace(_settings(), precomputed_enabled=True)
        with (
            patch.object(handler, "_settings", return_value=settings),
            patch.object(handler.S3, "get_object", return_value={"Body": io.BytesIO(payload)}),
            patch.object(handler, "_publish_precomputed", return_value={"variants": 192}) as publish,
            patch.object(handler, "_claim_scopes") as claim,
            patch.object(handler, "_complete_scope") as complete,
        ):
            self.assertEqual(handler.lambda_handler(event, None), {"variants": 192})
        publish.assert_called_once_with(settings, event["sha256"], document)
        claim.assert_not_called()
        complete.assert_not_called()

    def test_backfill_rejects_unrelated_objects_and_bad_hashes(self):
        settings = replace(_settings(), precomputed_enabled=True)
        with patch.object(handler, "_publish_precomputed") as publish:
            for event in ({"key": "films/raw", "sha256": "a" * 64},
                          {"key": settings.output_prefix + "a.gz", "sha256": "invalid"}):
                with self.assertRaises(ValueError):
                    handler._precompute_existing(settings, event)
            with patch.object(handler.S3, "get_object", return_value={"Body": io.BytesIO(b"bad")}):
                with self.assertRaises(ValueError):
                    handler._precompute_existing(settings, {
                        "key": settings.output_prefix + "a.gz", "sha256": "a" * 64,
                    })
        publish.assert_not_called()
