import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film.spawns import validate_spawns


def product():
    return {"schema": "halospawns.h1SpawnMetrics.v1", "definition_version": 1,
            "probability_model": "independent_uniform_squared_ratings_v1", "boundary_policy": "pre_end_snapshot",
            "threshold": {"maximum_ratio": 0.5, "minimum_gap": 0.1}, "coverage": "complete",
            "observed_spawns": 1, "measured_spawns": 1, "unknown_spawns": 0,
            "improbable_count": 1, "non_highest_count": 1, "events": [{
                "source_tick": 10, "slot_index": 0, "unit_handle": 1234, "spawn_index": 2,
                "chosen_probability": 0.125, "highest_probability": 0.875,
                "probability_ratio": 1/7, "probability_gap": 0.75,
                "non_highest": True, "improbable": True}]}


class SpawnTests(unittest.TestCase):
    def test_node_products_match_worker_validation_and_api_schema(self):
        from jsonschema import Draft202012Validator

        root = Path(__file__).resolve().parents[1]
        runtime = root / "runtime/spawn-metrics.mjs"
        if not runtime.exists():
            runtime = root.parent / "runtime/spawn-metrics.mjs"
        script = """
import {deriveSpawnMetrics} from RUNTIME_MODULE;
const encoding = {players:[0],source_ticks:20,source_first_clock:0,analytics:{match_end_source_tick:19}};
const cases = [[1,2],[0.5,1,2],[0.5,2],[0.1,1,1.01],[1,Math.sqrt(1.5)],
  [1,Math.sqrt(1.5)+1e-6],[1,...Array(100).fill(1.01)],[1,1],null];
console.log(JSON.stringify([1,2].flatMap(version => cases.map(ratings => deriveSpawnMetrics([
  {source_tick:1,events:[{slot_index:0,unit_handle:1234,spawn_index:0,ratings}]}
],encoding,version)))));
"""
        script = script.replace("RUNTIME_MODULE", json.dumps(runtime.as_uri()))
        generated = subprocess.run(["node", "--input-type=module", "-e", script],
                                   cwd=root, capture_output=True, text=True, check=True)
        products = json.loads(generated.stdout)
        for version in (1, 2, 3):
            schema = json.loads((root / f"contracts/h1film-native-analytics.v{version}.schema.json").read_text())
            validator = Draft202012Validator({"$defs": schema["$defs"], **schema["properties"]["spawn_metrics"]})
            for p in products:
                with self.subTest(native_version=version, definition=p["definition_version"], event=p["events"][0]):
                    validator.validate(p)
                    self.validate(p, revision=34 if p["definition_version"] == 2 else 32)
                    if p["events"][0]["improbable"] is not None:
                        forged = copy.deepcopy(p)
                        forged["events"][0]["improbable"] = not p["events"][0]["improbable"]
                        forged["improbable_count"] = int(forged["events"][0]["improbable"])
                        with self.assertRaises(ValueError):
                            self.validate(forged, revision=34 if p["definition_version"] == 2 else 32)

    def validate(self, value, revision=32, full=True):
        validate_spawns(value, exporter_revision=revision, slots={0}, stop=20, full_match=full)

    def test_recipe_and_valid_product(self):
        self.validate(product())
        self.validate(None, 30)
        with self.assertRaises(ValueError):
            self.validate(None)
        with self.assertRaises(ValueError):
            self.validate(product(), 30)

    def test_mutated_evidence_and_totals_reject(self):
        for key, value in [("source_tick",20),("slot_index",1),("chosen_probability",float("nan")),
                           ("probability_ratio",0.5),("probability_gap",0.1),("improbable",False)]:
            p=product()
            p["events"][0][key]=value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(p)
        p=product(); p["events"].append(copy.deepcopy(p["events"][0]))
        with self.assertRaises(ValueError): self.validate(p)
        p=product(); p["improbable_count"]=0
        with self.assertRaises(ValueError): self.validate(p)

    def test_unknown_and_partial_are_not_complete(self):
        p=product()
        p["coverage"]="partial"
        self.validate(p, full=False)
        p["coverage"]="complete"
        with self.assertRaises(ValueError): self.validate(p, full=False)
