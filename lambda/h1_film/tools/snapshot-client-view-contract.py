"""Snapshot the API-owned wire schemas for independent worker validation."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
from halospawns_api.schemas import h1film_client_views as contract

destination = Path(__file__).resolve().parents[1] / "contracts"
for name in ("Identity", "Prepare", "Completion", "Timeline"):
    schema = getattr(contract, f"ClientView{name}").model_json_schema()
    (destination / f"h1film-client-view-{name.lower()}.v1.schema.json").write_text(
        json.dumps(schema, indent=2) + "\n", encoding="utf-8")
