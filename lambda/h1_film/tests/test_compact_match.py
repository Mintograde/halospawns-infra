import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film.cloud import shared_parser
from jsonschema import Draft202012Validator


class CompactMatchContractTests(unittest.TestCase):
    def test_frozen_wire_schemas_accept_every_registered_recipe(self):
        root = Path(__file__).resolve().parents[1]
        registry = json.loads((root / "profiles/registry.json").read_text())
        recipes = [recipe for group in ("recipes", "client_view_recipes")
                   for items in registry["processing"].get(group, {}).values()
                   for recipe in items]
        checked = []
        for path in (root / "contracts").glob("*.schema.json"):
            schema = json.loads(path.read_text())
            recipe_schema = schema.get("$defs", {}).get("H1FilmRecipe")
            if recipe_schema:
                checked.append(path.name)
                for recipe in recipes:
                    with self.subTest(schema=path.name, recipe=recipe):
                        Draft202012Validator(recipe_schema).validate(recipe)
        self.assertIn("h1film-job.v1.schema.json", checked)
        self.assertIn("h1film-completion.v1.schema.json", checked)

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
