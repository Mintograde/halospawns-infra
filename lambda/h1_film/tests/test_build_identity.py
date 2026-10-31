import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film.build_identity import SOURCE_COMMIT_RULE, matches_profile, validate_build_matching
from h1_film.registry import load_registry, profile_for_report, select_exporter


class BuildIdentityTests(unittest.TestCase):
    def test_shared_labels_and_report_evidence(self):
        profile = load_registry()["h1-performance-beta5-p9818-wasm-v1"]
        profile = select_exporter(profile, 12)
        cases = json.loads((Path(__file__).with_name("fixtures") / "recorded-builds.json").read_text())
        for kind, labels in cases.items():
            for build in labels:
                with self.subTest(build=build):
                    film = {**profile, "build": build}
                    self.assertEqual(matches_profile(profile, film, SOURCE_COMMIT_RULE), kind == "accepted")
                    report = {"engine_profile": profile["id"], "exporter_revision": 12,
                              "envelope": film, "provenance": {"engine_source": profile["source"],
                                **{k: profile[k] for k in ("wasm_sha256", "glue_sha256")}}}
                    if kind == "accepted":
                        self.assertEqual(profile_for_report(report), profile)
                        self.assertEqual(report["envelope"]["build"], build)
                        for key in ("format", "protocol_revision", "tick_rate"):
                            self.assertFalse(matches_profile(profile, {**film, key: True}, SOURCE_COMMIT_RULE))
                    else:
                        with self.assertRaises(ValueError):
                            profile_for_report(report)

    def test_rules_reject_unknown_profiles_and_ambiguous_commit_prefixes(self):
        profile = load_registry()["h1-performance-beta5-p9818-wasm-v1"]
        other = copy.deepcopy(profile)
        other.update(id="ambiguous", build="Other")
        other["source"]["git_commit"] = "fbbfae27" + "0" * 32
        for profiles, rules in (
            ([profile], {"unknown": SOURCE_COMMIT_RULE}),
            ([profile], {profile["id"]: "any_build"}),
            ([{**profile, "source": None}], {profile["id"]: SOURCE_COMMIT_RULE}),
            ([profile, other], {profile["id"]: SOURCE_COMMIT_RULE, "ambiguous": SOURCE_COMMIT_RULE}),
            ([profile, {**other, "build": "Repack - fbbfae27"}], {profile["id"]: SOURCE_COMMIT_RULE}),
        ):
            with self.assertRaises(ValueError):
                validate_build_matching(profiles, rules)
