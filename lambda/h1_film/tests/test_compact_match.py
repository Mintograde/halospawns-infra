import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film.cloud import shared_parser


class CompactMatchContractTests(unittest.TestCase):
    def test_all_match_generations_keep_their_exact_pinned_resources(self):
        shared = shared_parser()
        for revision in (6, 7, 8):
            with self.subTest(revision=revision):
                contract = shared.load_pinned_contract(revision)
                self.assertEqual(contract.source_contract["profile_revision"], revision)
                self.assertEqual(contract.encoding["format"],
                                 f"halospawns.h1MatchReplay.v{revision - 5}")
                self.assertEqual(contract.manifest_schema["properties"]["schema"]["const"],
                                 contract.encoding["format"])
                self.assertEqual("storage" in contract.manifest_schema["properties"]["entries"]
                                 ["items"]["required"], revision == 8)
