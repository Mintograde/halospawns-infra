"""Export settings from a retained film and its verified local conversion."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import analytics, settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--film", type=Path, required=True)
    parser.add_argument("--conversion", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report, encoding, _ = analytics.verified_products(
        args.conversion, film_sha256=analytics.sha256_file(args.film)
    )
    product = settings.extract(args.film, report=report, encoding=encoding)
    with args.output.open("x", encoding="utf-8") as output:
        output.write(json.dumps(product, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"schema": product["schema"], "settings": len(product["settings"]),
                      "recorder_profiles": len(product["recorder_profiles"]), "output": str(args.output)}))


if __name__ == "__main__":
    main()
