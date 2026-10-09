"""Generate reviewed worker schema/fixture snapshots from the API-owned v1 models."""

import argparse
import hashlib
import json
import runpy
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = args.api / "src/halospawns_api/schemas/h1films.py"
    models = runpy.run_path(str(source))
    provenance = (
        "Generated from API schemas/h1films.py SHA256 "
        + hashlib.sha256(source.read_bytes()).hexdigest()
    )
    outputs = {
        "contracts/h1film-job.v1.schema.json": models["H1FilmJob"].model_json_schema(
            by_alias=True
        ),
        "contracts/h1film-completion.v1.schema.json": models[
            "H1FilmCompletion"
        ].model_json_schema(by_alias=True),
    }
    for name, document in outputs.items():
        document["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        document["$comment"] = provenance
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    for name in (
        "initial-job",
        "viewer-rebuild-job",
        "full-reparse-job",
        "prepare",
        "completion",
    ):
        value = json.loads(
            (args.api / f"tests/fixtures/h1film/{name}.json").read_text(
                encoding="utf-8"
            )
        )
        path = root / f"tests/fixtures/api-{name}.json"
        path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    print(provenance)


if __name__ == "__main__":
    main()
