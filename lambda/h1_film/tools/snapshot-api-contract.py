"""Generate reviewed worker schema/fixture snapshots from the API-owned v1 models."""

import argparse
import hashlib
import json
import runpy
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = args.api / "src/halospawns_api/schemas/h1films.py"
    sys.path.insert(0, str(args.api / "src"))
    models = runpy.run_path(str(source))
    from halospawns_api.schemas.h1film_analytics import H1NativeAnalytics
    from halospawns_api.schemas.h1film_combat import H1NativeAnalyticsV2
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
    native = H1NativeAnalytics.model_json_schema(by_alias=True)
    native["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    native["$comment"] = "Generated from API schemas/h1film_analytics.py SHA256 " + hashlib.sha256(
        (source.parent / "h1film_analytics.py").read_bytes()
    ).hexdigest()
    (root / "contracts/h1film-native-analytics.v1.schema.json").write_text(
        json.dumps(native, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    combat = H1NativeAnalyticsV2.model_json_schema(by_alias=True)
    combat["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    combat["$comment"] = "Generated from API schemas/h1film_combat.py SHA256 " + hashlib.sha256(
        (source.parent / "h1film_combat.py").read_bytes()
    ).hexdigest()
    (root / "contracts/h1film-native-analytics.v2.schema.json").write_text(
        json.dumps(combat, indent=2, sort_keys=True) + "\n", encoding="utf-8"
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
