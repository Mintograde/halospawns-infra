"""Semantic checks for the bounded, simulation-derived native combat product."""

from collections import Counter
import json
import math


def participant_counters(encoding, combat=None):
    result = {slot: dict(counters) for slot, counters in encoding.get("final_counters", {}).items()}
    if encoding.get("analytics_revision") != 4:
        return result
    if combat is None:
        combat = encoding["native_analytics"]["combat"]
    if combat["death_coverage"]["status"] != "complete":
        return result
    suicides = Counter(event["victim_slot"] for event in combat["deaths"] if event["kind"] == "suicide")
    betrayals = Counter(event["killer_slot"] for event in combat["deaths"] if event["kind"] == "betrayal")
    for slot, counters in result.items():
        raw = counters.get("team_kills")
        if raw is not None:
            if raw != betrayals[int(slot)] + suicides[int(slot)]:
                raise ValueError("Native friendly-fire counter does not reconcile with deaths")
            counters["team_kills"] = raw - suicides[int(slot)]
    return result


def validate_combat_product(combat, *, encoding, report, attribution=None):
    slots = set(encoding["players"])
    weapons = [row["weapon_id"] for row in combat["weapons"]]
    if len(weapons) != len(set(weapons)):
        raise ValueError("Duplicate combat weapon")
    if len(json.dumps(combat, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()) > 1024**2:
        raise ValueError("Combat exceeds its byte budget")
    stop = report["analytics"].get("match_end_source_tick")
    stop = report["envelope"]["ticks"] if stop is None else stop + 1

    def slot(value):
        if value is not None and (type(value) is not int or value not in slots):
            raise ValueError("Unknown combat slot")

    def count(value):
        if type(value) is not int or not 0 <= value <= 2**31 - 1:
            raise ValueError("Invalid combat counter")

    for section, limit in (("shots", 256), ("damage", 2048), ("deaths", 8192), ("awards", 4)):
        coverage = combat[{"shots": "shot", "damage": "damage", "deaths": "death", "awards": "award"}[section] + "_coverage"]
        if (
            len(combat[section]) > limit
            or (coverage["status"] == "unavailable" and combat[section])
            or ((coverage["status"] == "complete") != (coverage.get("reason") is None))
        ):
            raise ValueError("Inconsistent combat coverage")
        for row in combat[section]:
            for name in ("slot_index", "attacker_slot", "victim_slot", "killer_slot"):
                if name in row:
                    slot(row[name])
            if row.get("weapon_id") is not None and row["weapon_id"] not in weapons:
                raise ValueError("Unknown combat weapon")
    for section, fields in (
        ("shots", ("slot_index", "weapon_id")),
        ("damage", ("attacker_slot", "victim_slot", "weapon_id", "relationship")),
        ("awards", ("slot_index",)),
    ):
        keys = [tuple(row[field] for field in fields) for row in combat[section]]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate combat summary")
    for row in combat["shots"]:
        count(row["shots_fired"])
        count(row["shots_hit"])
        if row["shots_hit"] > row["shots_fired"]:
            raise ValueError("Connected discharges exceed discharges")
    for row in combat["damage"]:
        attacker, victim, relationship = row["attacker_slot"], row["victim_slot"], row["relationship"]
        if (
            (relationship == "environment" and attacker is not None)
            or (relationship == "self" and attacker != victim)
            or (relationship in ("opponent", "friendly") and (attacker is None or attacker == victim))
        ):
            raise ValueError("Invalid damage relationship")
        for field in ("shield_damage", "health_damage"):
            value = row[field]
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 2**53 - 1:
                raise ValueError("Invalid applied damage")
    counters = {field: Counter() for field in ("kills", "deaths", "team_kills")}
    previous_index, previous_tick = -1, -1
    simulated = Counter()
    for event in combat["deaths"]:
        index, tick = event["event_index"], event["source_tick"]
        count(index)
        count(tick)
        if index <= previous_index or tick < previous_tick or tick >= stop:
            raise ValueError("Combat death order/window mismatch")
        previous_index, previous_tick = index, tick
        killer, victim, kind = event["killer_slot"], event["victim_slot"], event["kind"]
        if (
            (kind in ("kill", "betrayal") and (killer is None or killer == victim))
            or (kind == "suicide" and killer != victim)
            or (kind == "environment" and killer is not None)
            or (killer is None and event["killer_position"] is not None)
            or (event["headshot"] is not None and type(event["headshot"]) is not bool)
            or (event["headshot"] is True and (kind != "kill" or event["weapon_id"] is None))
        ):
            raise ValueError("Invalid combat death attribution")
        for field in ("killer_position", "victim_position"):
            position = event[field]
            if position is not None and (len(position) != 3 or any(
                type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e6
                for value in position
            )):
                raise ValueError("Invalid combat callback position")
        counters["deaths"][victim] += 1
        if kind == "kill":
            counters["kills"][killer] += 1
            simulated[tick, killer, victim] += 1
        elif kind == "betrayal":
            counters["team_kills"][killer] += 1
    normalized = participant_counters(encoding, combat)
    for player in slots:
        suicides = normalized[str(player)].get("suicides")
        deaths = normalized[str(player)].get("deaths")
        if suicides is not None and deaths is not None and suicides > deaths:
            raise ValueError("Native suicide counter exceeds deaths")
        for name, counts in counters.items():
            total = normalized[str(player)].get(name)
            if total is not None and (
                counts[player] > total
                or (combat["death_coverage"]["status"] == "complete" and counts[player] != total)
            ):
                raise ValueError("Combat deaths contradict final counters")
    if attribution is not None:
        recorded = Counter((row["source_tick"], row["killer_slot"], row["victim_slot"])
                           for row in attribution["events"])
        if (
            (combat["death_coverage"]["status"] == "complete" and recorded - simulated)
            or (attribution["coverage"] == "complete" and simulated - recorded)
        ):
            raise ValueError("Combat deaths contradict recorded EVT1")
    for row in combat["awards"]:
        for name in ("longest_kill_streak", "double_kills", "triple_kills", "overkills"):
            count(row[name])
        kills = normalized[str(row["slot_index"])].get("kills")
        if kills is not None and row["longest_kill_streak"] > kills:
            raise ValueError("Combat streak exceeds kills")
    if combat["award_coverage"]["status"] == "complete" and {row["slot_index"] for row in combat["awards"]} != slots:
        raise ValueError("Complete awards require every roster slot")
