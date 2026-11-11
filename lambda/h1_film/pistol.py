"""Validate native PGCR pistol counters without interpreting combat lineage."""


def validate_pistol(product, *, encoding, report):
    if (product is not None) != ((report.get("exporter_revision") or 1) >= 28):
        raise ValueError("Pistol counter contract differs from exporter recipe")
    if product is None:
        return
    if product.get("schema") != "halospawns.h1PistolAccuracy.v1" or (
        product.get("method") != "pgcr_player_latch"
        or product.get("boundary_policy") != "pre_end_snapshot"
    ):
        raise ValueError("Invalid pistol counter definition")
    rows = product["players"]
    slots = [p["slot_index"] for p in rows]
    if len(slots) != len(set(slots)) or set(slots) != set(encoding["players"]):
        raise ValueError("Pistol counter roster differs")
    end = report["analytics"].get("match_end_source_tick")
    for player in rows:
        fired, hit = player["shots_fired"], player["shots_hit"]
        if (fired is None) != (hit is None):
            raise ValueError("Pistol counters require paired availability")
        if fired is None:
            continue
        if any(type(n) is not int or not 0 <= n <= 2**53 - 1 for n in (fired, hit)) or hit > fired:
            raise ValueError("Invalid pistol counter value")
        overall = encoding["final_counters"][str(player["slot_index"])]
        if end == 0 or any(overall.get(k) is None or player[k] > overall[k]
                           for k in ("shots_fired", "shots_hit")):
            raise ValueError("Pistol counters exceed overall counters/coverage")
