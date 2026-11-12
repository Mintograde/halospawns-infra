"""Cross-check derived metric counts and examples against the verified combat stream."""

from collections import Counter


def validate_gameplay(product, combat, slots, stop, *, definition_version=1, melee_required=False):
    deaths = {event["event_index"]: event for event in combat["deaths"]}
    kills = Counter(event["killer_slot"] for event in deaths.values() if event["kind"] == "kill")
    weapons = {weapon["weapon_id"]: weapon["tag_path"] for weapon in combat["weapons"]}
    categories = {weapon["weapon_id"]: weapon["category"] for weapon in combat["weapons"]}
    ids = [metric["id"] for metric in product["metrics"]]
    expected = {"pistol_three_shot_kills"}
    if melee_required:
        expected |= {"backwhack_kills", "double_melee_kills"}
    if set(ids) != expected or len(ids) != len(expected):
        raise ValueError("Gameplay metrics differ from the frozen exporter")
    for metric in product["metrics"]:
        melee = metric["id"] != "pistol_three_shot_kills"
        missing = "missing_melee_evidence" if melee else "missing_shot_evidence"
        if metric["definition_version"] != (1 if melee else definition_version):
            raise ValueError("Gameplay definition differs from the frozen exporter")
        players = metric["players"]
        if {player["slot_index"] for player in players} != set(slots) or len(players) != len(slots):
            raise ValueError("Gameplay slots differ from the verified roster")
        for player in players:
            complete = player["coverage"]["status"] == "complete"
            value, observed, unknown = player["value"], player["observed_count"], player["unknown_kills"]
            if (complete != (player["coverage"]["reason"] is None)
                    or (value != observed if complete else value is not None)
                    or (unknown and (complete or player["coverage"]["reason"] != missing))
                    or (player["coverage"]["reason"] not in (None, missing, "partial_recording"))
                    or (player["coverage"]["reason"] == missing and not unknown)
                    or observed + unknown > player["evaluated_kills"]
                    or player["evaluated_kills"] != kills[player["slot_index"]]
                    or len(player["examples"]) != observed):
                raise ValueError("Gameplay counts contradict coverage or combat kills")
            lists = [player["examples"]]
            estimates = player.get("estimates")
            if melee and estimates is not None:
                raise ValueError("Melee metrics do not admit estimates")
            if estimates is not None:
                if (estimates["count"] != len(estimates["examples"])
                        or estimates["count"] > unknown
                        or {e["kill_event_index"] for e in player["examples"]}
                        & {e["kill_event_index"] for e in estimates["examples"]}):
                    raise ValueError("Gameplay estimates contradict unresolved/verified kills")
                lists.append(estimates["examples"])
            for examples in lists:
                indices = [e["kill_event_index"] for e in examples]
                if indices != sorted(set(indices)):
                    raise ValueError("Gameplay examples must be ordered and distinct")
            for example in [e for examples in lists for e in examples]:
                death = deaths.get(example["kill_event_index"])
                if not (death and death["kind"] == "kill" and death["killer_slot"] == player["slot_index"]
                        and (melee or definition_version != 2 or death.get("headshot") is True)
                        and death["victim_slot"] == example["victim_slot"]
                        and death["source_tick"] == example["end_source_tick"]
                        and 0 <= example["start_source_tick"] <= example["end_source_tick"] < stop
                        and (categories.get(death["weapon_id"]) == "melee" if melee else
                             weapons.get(death["weapon_id"], "").replace("\\", "/").lower() == "weapons/pistol/pistol")):
                    raise ValueError("Gameplay example differs from its verified pistol kill")
                timing = example.get("melee_timing")
                if metric["id"] == "double_melee_kills":
                    if not timing or not (
                        example["start_source_tick"] <= timing["first_damage_source_tick"]
                        <= timing["grenade_source_tick"] <= timing["second_action_source_tick"]
                        <= example["end_source_tick"] < timing["cooldown_expiry_source_tick"]
                    ):
                        raise ValueError("Double melee requires ordered timing evidence")
                elif timing is not None:
                    raise ValueError("Unexpected melee timing evidence")
