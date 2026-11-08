"""Cross-check derived metric counts and examples against the verified combat stream."""

from collections import Counter


def validate_gameplay(product, combat, slots, stop):
    deaths = {event["event_index"]: event for event in combat["deaths"]}
    kills = Counter(event["killer_slot"] for event in deaths.values() if event["kind"] == "kill")
    weapons = {weapon["weapon_id"]: weapon["tag_path"] for weapon in combat["weapons"]}
    for metric in product["metrics"]:
        players = metric["players"]
        if {player["slot_index"] for player in players} != set(slots) or len(players) != len(slots):
            raise ValueError("Gameplay slots differ from the verified roster")
        for player in players:
            complete = player["coverage"]["status"] == "complete"
            value, observed, unknown = player["value"], player["observed_count"], player["unknown_kills"]
            if (complete != (player["coverage"]["reason"] is None)
                    or (value != observed if complete else value is not None)
                    or (unknown and (complete or player["coverage"]["reason"] != "missing_shot_evidence"))
                    or (player["coverage"]["reason"] == "missing_shot_evidence" and not unknown)
                    or observed + unknown > player["evaluated_kills"]
                    or player["evaluated_kills"] != kills[player["slot_index"]]
                    or len(player["examples"]) != observed):
                raise ValueError("Gameplay counts contradict coverage or combat kills")
            last = -1
            for example in player["examples"]:
                death = deaths.get(example["kill_event_index"])
                if not (death and death["kind"] == "kill" and death["killer_slot"] == player["slot_index"]
                        and death["victim_slot"] == example["victim_slot"]
                        and death["source_tick"] == example["end_source_tick"]
                        and 0 <= example["start_source_tick"] <= example["end_source_tick"] < stop
                        and example["kill_event_index"] > last
                        and weapons.get(death["weapon_id"], "").replace("\\", "/").lower() == "weapons/pistol/pistol"):
                    raise ValueError("Gameplay example differs from its verified pistol kill")
                last = example["kill_event_index"]
