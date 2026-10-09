from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import analytics as h1_film
from h1_film.registry import load_registry

PROFILE = next(iter(load_registry().values()))


class H1ProductTests(unittest.TestCase):
    def fixture(self, root):
        candidate = root / "candidate"
        candidate.mkdir()
        files = {}
        for name in (
            "analytics.30hz.json.zst",
            "replay.120hz.hsrdc",
            "replay.30hz.hsrdc",
        ):
            data = name.encode()
            (candidate / name).write_bytes(data)
            files[name] = {
                "size_bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        analytics = {
            **files["analytics.30hz.json.zst"],
            "schema": h1_film.ANALYTICS_SCHEMA,
            "ticks": 2,
            "ticks_per_second": 30,
        }
        report = {
            "schema": "halospawns.h1FilmWasmComparisonRun.v1",
            "status": "simulation_and_encoding_verified",
            "engine_profile": PROFILE["id"],
            "provenance": {
                "film_sha256": "a" * 64,
                "wasm_sha256": PROFILE["wasm_sha256"],
                "glue_sha256": PROFILE["glue_sha256"],
            },
            "envelope": {
                **{
                    k: PROFILE[k]
                    for k in ("format", "protocol_revision", "tick_rate", "build")
                },
                "ticks": 5,
                "hash_samples": 1,
            },
            "simulation": {
                "played_ticks": 5,
                "seed_mismatches": 0,
                "hash_mismatches": 0,
                "hash_checks": 1,
                "control_pushes": 20,
            },
            "analytics": analytics,
        }
        encoding = {
            "source_ticks": 5,
            "120hz": files["replay.120hz.hsrdc"],
            "30hz": files["replay.30hz.hsrdc"],
        }
        (root / "report.json").write_text(json.dumps(report))
        (candidate / "encoding.json").write_text(json.dumps(encoding))
        return report

    def test_verified_product_hashes_and_source_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            h1_film.verified_products(root, film_sha256="a" * 64)
            with self.assertRaisesRegex(ValueError, "canonical film"):
                h1_film.verified_products(root, film_sha256="b" * 64)
            path = root / "candidate" / "replay.120hz.hsrdc"
            path.write_bytes(b"X" * path.stat().st_size)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                h1_film.verified_products(root, film_sha256="a" * 64)

    def test_source_rate_only_requires_evidence_and_still_checks_viewer_and_analytics_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            path = root / "candidate/encoding.json"
            encoding = json.loads(path.read_text())
            encoding["30hz"] = None
            (root / "candidate/replay.30hz.hsrdc").unlink()
            path.write_text(json.dumps(encoding))
            with self.assertRaisesRegex(ValueError, "source-rate viewer verification"):
                h1_film.verified_products(root, film_sha256="a" * 64)
            encoding["verification"] = {"mode": "inline-lossless", "120hz": 5, "30hz": None}
            path.write_text(json.dumps(encoding))
            h1_film.verified_products(root, film_sha256="a" * 64)
            for name in ("replay.120hz.hsrdc", "analytics.30hz.json.zst"):
                product = root / "candidate" / name
                original = product.read_bytes()
                product.write_bytes(b"X" * len(original))
                with self.assertRaisesRegex(ValueError, "hash mismatch"):
                    h1_film.verified_products(root, film_sha256="a" * 64)
                product.write_bytes(original)

    def match_only_fixture(self, root, end):
        report = self.fixture(root)
        encoding_path = root / "candidate" / "encoding.json"
        encoding = json.loads(encoding_path.read_text())
        ticks = report["envelope"]["ticks"] if end is None else end + 1
        report["analytics"].update(
            analytics_revision=2,
            match_end_source_tick=end,
            statistics_source_ticks=ticks,
            ticks=(ticks + 3) // 4,
        )
        encoding["analytics_revision"] = 2
        encoding["analytics"] = {
            key: value for key, value in report["analytics"].items() if key != "sha256"
        }
        (root / "report.json").write_text(json.dumps(report))
        encoding_path.write_text(json.dumps(encoding))
        return report, encoding

    def test_match_only_products_keep_full_simulation_and_validate_shorter_analytics(self):
        for end in (None, 0, 1, 3, 4):
            with self.subTest(end=end), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                report, encoding = self.match_only_fixture(root, end)
                h1_film.verified_products(root, film_sha256="a" * 64)
                self.assertEqual(encoding["source_ticks"], 5)
                if end is not None and end < 4:
                    self.assertEqual(report["analytics"]["ticks"], 1)

    def test_match_only_products_reject_conflicting_windows_and_revisions(self):
        for field, value in (
            ("match_end_source_tick", -1),
            ("match_end_source_tick", 5),
            ("match_end_source_tick", True),
            ("match_end_source_tick", 1.5),
            ("statistics_source_ticks", 5),
            ("analytics_revision", 1),
            ("ticks", 2),
        ):
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                report, _ = self.match_only_fixture(root, 1)
                report["analytics"][field] = value
                (root / "report.json").write_text(json.dumps(report))
                with self.assertRaises(ValueError):
                    h1_film.verified_products(root, film_sha256="a" * 64)

    def test_unverified_desynced_unknown_profile_and_wrong_rate_are_rejected(self):
        for group, key, value in [
            (None, "status", "started"),
            (None, "engine_profile", "unknown"),
            ("simulation", "hash_mismatches", 1),
            ("simulation", "hash_checks", 0),
            ("analytics", "ticks_per_second", 120),
            ("analytics", "ticks", 5),
            ("provenance", "wasm_sha256", "b" * 64),
            ("provenance", "glue_sha256", "b" * 64),
            ("envelope", "build", "a later decompilation"),
            (None, "export_contract", "HSFT9999"),
        ]:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                report = self.fixture(root)
                (report[group] if group else report)[key] = value
                (root / "report.json").write_text(json.dumps(report))
                with self.assertRaises(ValueError):
                    h1_film.verified_products(root, film_sha256="a" * 64)

    def test_reference_mode_requires_actual_byte_identical_native_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            report = self.fixture(root)
            report["status"] = "simulation_verified_pending_artifact_comparison"
            (root / "report.json").write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, "native reference"):
                h1_film.verified_products(root, film_sha256="a" * 64)


@dataclass(frozen=True)
class Parsed:
    metadata: dict
    participants: list
    game: dict
    facts: dict


class H1AdaptationTests(unittest.TestCase):
    def test_one_sample_graph_baseline_is_not_replaced_with_final_score(self):
        parsed = Parsed(
            metadata={
                "tick_count": 1,
                "graph_context": {"players": {"0": {"baselines": {"kills": 1}}}},
            },
            participants=[],
            game={},
            facts={},
        )
        result = h1_film.adapt_parsed_replay(
            parsed,
            report={
                "analytics": {"ticks": 1},
                "engine_profile": PROFILE["id"],
                "provenance": {"film_sha256": "a" * 64, "map_sha256": "b" * 64},
            },
            encoding={
                "initial_counters": {"0": {"kills": 0, "deaths": 0, "assists": 0}}
            },
        )
        self.assertEqual(
            result.metadata["graph_context"]["players"]["0"]["baselines"]["kills"], 0
        )
        self.assertEqual(
            parsed.metadata["graph_context"]["players"]["0"]["baselines"]["kills"], 1
        )

    def test_exact_map_binding_and_missing_fields_remain_explicit(self):
        counters = {
            "kills": 2,
            "deaths": 1,
            "assists": 0,
            "suicides": 0,
            "team_kills": 0,
            "score": 0,
            "shots_hit": 3,
        }
        parsed = Parsed(
            metadata={"tick_count": 2},
            participants=[
                {
                    "slot_index": 0,
                    "metadata": {"local_player": None},
                    "stats": {
                        "kills": 2,
                        "deaths": 1,
                        "assists": 0,
                        "suicides": 0,
                        "betrayals": 0,
                        "score": None,
                    },
                }
            ],
            game={},
            facts={"game": {"game.host_style": "neutral"}},
        )
        binding = {
            "engine_profile": PROFILE["id"],
            "scenario": "dread",
            "size_bytes": 1,
            "sha256": "b" * 64,
            "map_id": "11111111-1111-4111-8111-111111111111",
        }
        report = {
            "analytics": {"ticks": 2},
            "engine_profile": PROFILE["id"],
            "envelope": {"map": "dread", "map_bytes": 1},
            "map_binding": binding,
            "provenance": {"film_sha256": "a" * 64, "map_sha256": "b" * 64},
        }
        result = h1_film.adapt_parsed_replay(
            parsed, report=report, encoding={"final_counters": {"0": counters}, "analytics_revision": 2}
        )
        self.assertEqual(result.game["map_id"], binding["map_id"])
        self.assertEqual(result.participants[0]["stats"]["score"], 0)
        self.assertEqual(result.participants[0]["stats"]["shots_hit"], 3)
        self.assertNotIn("game.host_style", result.facts["game"])
        self.assertEqual(result.metadata["h1_film"]["analytics_tick_rate"], 30)
        self.assertEqual(result.metadata["h1_film"]["analytics_revision"], 2)
        self.assertEqual(
            result.metadata["h1_film"]["postgame"],
            "retained_in_viewer_excluded_from_statistics",
        )
        self.assertEqual(parsed.participants[0]["stats"]["score"], None)
        report["map_binding"]["sha256"] = "c" * 64
        with self.assertRaisesRegex(ValueError, "simulated map"):
            h1_film.adapt_parsed_replay(
                parsed, report=report, encoding={"final_counters": {"0": counters}}
            )


if __name__ == "__main__":
    unittest.main()
