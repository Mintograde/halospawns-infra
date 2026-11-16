import gzip
import hashlib
import io
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from test_handler import _claim, _settings, handler


class PrecomputedTests(unittest.TestCase):
    def test_normal_build_uses_frozen_source_and_publishes_before_activation(self):
        document = handler.RollupAccumulator(_claim()).document()
        payload = gzip.compress(json.dumps(document, sort_keys=True).encode())
        for fail in (False, True):
            with self.subTest(failure=fail):
                with tempfile.NamedTemporaryFile(delete=False) as target:
                    target.write(payload)
                    path = Path(target.name)
                generated = handler.GeneratedArtifact(
                    path=path, bucket="uploads", key="rollup", size_bytes=len(payload),
                    sha256=hashlib.sha256(payload).hexdigest(), cell_count=0, summary={},
                )
                stages = []

                def publish(settings, digest, frozen):
                    stages.append("published")
                    self.assertEqual(digest, generated.sha256)
                    self.assertEqual(list(frozen["metrics"]), sorted(document["metrics"]))
                    self.assertEqual(frozen, document)
                    if fail:
                        raise OSError("upload failed")

                def complete(*args):
                    stages.append("activated")
                    return {"activated": True}

                try:
                    with (
                        patch.object(handler, "_list_inputs", return_value={"games": [], "next_cursor": None}),
                        patch.object(handler, "_write_rollup_artifact", return_value=generated),
                        patch.object(handler, "_publish_precomputed", side_effect=publish),
                        patch.object(handler, "_complete_scope", side_effect=complete),
                        patch.object(handler, "_mark_artifact_active"),
                        patch.object(handler, "_delete_generated_artifact"),
                        patch.object(handler, "_fail_scope") as failed,
                    ):
                        result = handler._process_claim(replace(_settings(), precomputed_enabled=True), _claim())
                    self.assertEqual(result.status, "failed" if fail else "completed")
                    self.assertEqual(stages, ["published"] if fail else ["published", "activated"])
                    self.assertEqual(failed.call_count, int(fail))
                finally:
                    path.unlink(missing_ok=True)

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
