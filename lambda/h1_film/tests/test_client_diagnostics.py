import copy
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import client_diagnostics as diagnostics


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.proof = {"engine_profile": diagnostics.PROFILE, "exporter_revision": 11,
                      "raw_map_sha256": "b" * 64, "source_tick_count": 120}
        self.viewer = {"source_replay_sha256": "a" * 64, "s3_bucket": "bucket",
                       "s3_key": "replays/derived/viewer/upload/generations/attempt/viewer.hsrv",
                       "generation_token": "attempt"}
        self.data = b"bounded diagnostic fixture" * 4
        self.descriptor = {"schema": diagnostics.SCHEMA, "content_type": diagnostics.MEDIA_TYPE,
                           "compression": "identity", "size_bytes": len(self.data),
                           "sha256": hashlib.sha256(self.data).hexdigest(), "manifest_sha256": "c" * 64,
                           "source_replay_sha256": "a" * 64, "raw_map_sha256": "b" * 64,
                           "engine_profile": diagnostics.PROFILE, "source_tick_count": 120}

    def test_publish_and_receipt_keep_source_generation_and_version(self):
        shared = Mock()
        shared._put_immutable_file.return_value = "exact-version"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "candidate").mkdir()
            (root / "candidate/client-diagnostics.h1diag").write_bytes(self.data)
            diagnostics.publish(shared, {"client_diagnostics": self.descriptor}, root,
                                self.proof, self.viewer)
        value = self.viewer["h1_diagnostics"]
        self.assertEqual(value["s3_version_id"], "exact-version")
        diagnostics.validate(value, self.proof, self.viewer)
        for key, bad in (("s3_key", "replays/other.h1diag"), ("s3_bucket", "other"),
                         ("source_replay_sha256", "d" * 64), ("raw_map_sha256", "d" * 64),
                         ("source_tick_count", 121), ("size_bytes", True), ("s3_version_id", "null")):
            broken = {**value, key: bad}
            with self.subTest(key=key), self.assertRaises(ValueError):
                diagnostics.validate(broken, self.proof, self.viewer)
        with self.assertRaises(ValueError):
            diagnostics.validate(None, self.proof, self.viewer)

    def test_old_recipe_omits_companion_and_changed_bytes_never_publish(self):
        old = {**self.proof, "exporter_revision": 10}
        diagnostics.validate(None, old, self.viewer)
        with self.assertRaises(ValueError):
            diagnostics.validate(self.descriptor, old, self.viewer, stored=False)
        shared = Mock()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "candidate").mkdir()
            (root / "candidate/client-diagnostics.h1diag").write_bytes(b"X" * len(self.data))
            with self.assertRaisesRegex(ValueError, "digest"):
                diagnostics.publish(shared, {"client_diagnostics": copy.deepcopy(self.descriptor)},
                                    root, self.proof, self.viewer)
        shared._put_immutable_file.assert_not_called()
