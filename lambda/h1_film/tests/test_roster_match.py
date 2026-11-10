import hashlib
import json
import unittest
from unittest.mock import patch

from h1_film import cloud


class RosterMatchContractTests(unittest.TestCase):
    def test_new_contract_is_pinned_and_retains_original_contracts(self):
        shared = cloud.shared_parser()
        for revision in (6, 7, 8, 9, 10, 11):
            contract = shared.load_pinned_contract(revision)
            self.assertEqual(contract.revision, revision)
            self.assertEqual(contract.encoding["format"], f"halospawns.h1MatchReplay.v{revision - 5}")
            self.assertEqual(contract.encoding["container"]["version"], revision - 5)
            self.assertEqual(contract.source_contract["profile_revision"], revision)
            encoded = json.dumps(contract.encoding, sort_keys=True, ensure_ascii=False,
                                 allow_nan=False, separators=(",", ":")).encode("utf-8")
            self.assertEqual(contract.encoding_sha256, hashlib.sha256(encoded).hexdigest())
        self.assertEqual(shared.load_pinned_contract(9).encoding_sha256,
                         "acaf04c83a4155695db3f89193bc816b3e940b1cc380f22e284c245ea2980777")

    def test_new_filename_uses_canonical_version_without_changing_old_receipts(self):
        shared = cloud.shared_parser()
        with patch.object(shared, "_settings", return_value={"viewer_artifact_prefix": "replays/derived/viewer/"}):
            for revision, version in ((6, 1), (7, 1), (8, 1), (9, 4), (10, 5), (11, 6)):
                key = shared._viewer_artifact_key("upload", "generation", "a" * 64, revision)
                self.assertTrue(key.endswith(f"viewer-delta.v{version}.hsrv"))
                self.assertIn(f"frontend-default-r{revision}.", key)
