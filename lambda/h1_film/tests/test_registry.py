import copy
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film.registry import REGISTRY_PATH, load_registry, profile_for_report, select_exporter


class RegistryTests(unittest.TestCase):
    def test_beta4_network_exporter_retains_bot_pin_and_source_identity(self):
        profile = load_registry()["h1-performance-beta4-p9803-wasm-v1"]
        network = select_exporter(profile, 8)
        retained = select_exporter(profile, 7)
        self.assertEqual(network["wasm_sha256"],
                         "97faa72b6116ad254ec3b87dbb203c0a482665c1eadec73b8516b89323785761")
        self.assertEqual(retained["wasm_sha256"],
                         "14d516e3f8c48968f43800c115dbc995d8c03a722f4901e1ddd23fc9fb136f95")
        for field in ("id", "build", "format", "protocol_revision", "tick_rate", "source", "glue_sha256"):
            self.assertEqual(network[field], retained[field])

    def test_combat_exporters_preserve_both_profile_identities_and_old_pins(self):
        for profile in load_registry().values():
            combat = select_exporter(profile, 5)
            if profile["port"] == "beta4":
                with self.assertRaisesRegex(ValueError, "exporter"):
                    select_exporter(profile, 4)
            else:
                old = select_exporter(profile, 4)
                self.assertNotEqual(old["wasm_sha256"], combat["wasm_sha256"])
            self.assertEqual(combat["export_contract"], "HSFT0001")
            for field in ("id", "build", "format", "protocol_revision", "tick_rate", "source"):
                self.assertEqual(combat.get(field), profile.get(field))
            self.assertEqual(select_exporter(profile, None), profile)

    def test_h1arena_requires_full_commit_and_source_fingerprint(self):
        document = json.loads(REGISTRY_PATH.read_text())
        original = document["profiles"][0]
        source = {"project": "h1arena", "git_commit": "1" * 40,
                  "git_date": "2026-10-14", "algorithm": "halospawns.sourceTreeSha256.v1",
                  "files": 12339, "sha256": "2" * 64}
        profile = {**original, "id": "h1arena-fixture", "port": "h1arena",
                   "adapter": "h1arena-v2-120-v1", "protocol_revision": 9111,
                   "build": "UNIVERSAL Only - 2026-10-14 - 11111111", "source": source}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "registry.json"
            path.write_text(json.dumps({**document, "profiles": [original, profile]}))
            loaded = load_registry(path)
            self.assertEqual(loaded[original["id"]], original)
            self.assertEqual(loaded[profile["id"]]["source"], source)
            report = {"engine_profile": profile["id"], "envelope": profile,
                      "provenance": {"engine_source": source,
                                     **{key: profile[key] for key in ("wasm_sha256", "glue_sha256")}}}
            with patch("h1_film.registry.load_registry", return_value=loaded):
                self.assertEqual(profile_for_report(report)["source"], source)
                for invalid in (None, {**source, "git_commit": "3" * 40}):
                    changed = {**report, "provenance": {**report["provenance"], "engine_source": invalid}}
                    with self.assertRaisesRegex(ValueError, "source provenance mismatch"):
                        profile_for_report(changed)
            for invalid in (None, {**source, "git_commit": "short"}, {**source, "sha256": "wrong"}):
                path.write_text(json.dumps({**document, "profiles": [{**profile, "source": invalid}]}))
                with self.assertRaisesRegex(ValueError, "source provenance"):
                    load_registry(path)

    def test_transport_selection_retains_legacy_and_rejects_unknown_contracts(self):
        document = json.loads(REGISTRY_PATH.read_text())
        profile = document["profiles"][0]
        self.assertEqual(select_exporter(profile, None), profile)
        self.assertEqual(select_exporter(profile, 1)["wasm_sha256"], profile["wasm_sha256"])
        exporter = next(entry for entry in document["exporters"] if entry["revision"] == 4)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "registry.json"
            for transport in ("HSFT0001", "HSFT0002", "HSFT9999"):
                path.write_text(json.dumps({**document, "exporters": [
                    {**exporter, "transport_contract": transport}
                ]}))
                if transport == "HSFT9999":
                    with self.assertRaisesRegex(ValueError, "transport"):
                        select_exporter(profile, 4, path)
                else:
                    selected = select_exporter(profile, 4, path)
                    self.assertEqual(selected["wasm_sha256"], exporter["wasm_sha256"])
                    self.assertEqual(selected["export_contract"], "HSFT0001")

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
