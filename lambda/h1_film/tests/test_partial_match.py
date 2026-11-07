import unittest

from test_cloud import load_pinned_contract


class PartialMatchContracts(unittest.TestCase):
    def test_contract_versions_retain_distinct_immutable_pins(self):
        old = load_pinned_contract(6)
        new = load_pinned_contract(7)
        self.assertEqual(old.encoding["format"], "halospawns.h1MatchReplay.v1")
        self.assertEqual(new.encoding["format"], "halospawns.h1MatchReplay.v2")
        self.assertEqual(new.encoding["container"]["version"], 2)
        self.assertNotEqual(new.encoding_sha256, old.encoding_sha256)
        self.assertNotEqual(new.manifest_sha256, old.manifest_sha256)
