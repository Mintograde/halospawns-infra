import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film.registry import REGISTRY_PATH, load_registry, profile_for_report


class RegistryTests(unittest.TestCase):
    def test_initial_supported_profile_is_retained_without_rewriting(self):
        retained = load_registry(
            Path(__file__).with_name("fixtures") / "retained-profiles.json"
        )
        current = load_registry()
        for key, profile in retained.items():
            self.assertEqual(current[key], profile)

    def test_future_build_coexists_but_duplicate_identities_are_rejected(self):
        document = json.loads(REGISTRY_PATH.read_text())
        original = document["profiles"][0]
        later = {
            **original,
            "id": "future-fixture-only",
            "protocol_revision": 46,
            "build": "Future test build",
        }
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "registry.json"
            path.write_text(json.dumps({**document, "profiles": [later, original]}))
            self.assertEqual(load_registry(path)[original["id"]], original)
            for entries in (
                [original, original],
                [original, {**original, "id": "ambiguous"}],
                [{**original, "id": "../escape"}],
                [{**original, "adapter": "unknown"}],
            ):
                path.write_text(json.dumps({**document, "profiles": entries}))
                with self.assertRaises(ValueError):
                    load_registry(path)

    def test_earlier_report_without_export_contract_still_binds_exact_binary_and_build(
        self,
    ):
        profile = next(iter(load_registry().values()))
        report = {
            "engine_profile": profile["id"],
            "envelope": profile,
            "provenance": {k: profile[k] for k in ("wasm_sha256", "glue_sha256")},
        }
        self.assertEqual(profile_for_report(report), profile)
        changed = copy.deepcopy(report)
        changed["envelope"]["build"] = "new source with old profile ID"
        with self.assertRaisesRegex(ValueError, "film identity"):
            profile_for_report(changed)


if __name__ == "__main__":
    unittest.main()
