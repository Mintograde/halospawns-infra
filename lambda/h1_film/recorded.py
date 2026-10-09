"""Bounded Beta 3 film evidence; never infer player identities from display names."""

from __future__ import annotations

import struct
from collections import Counter
from pathlib import Path


def match_start(report: dict, encoding: dict) -> int | None:
    # Both clocks must start at the engine's map-time origin, with an active
    # first snapshot. An observed end or a closed file alone cannot prove start.
    if (
        report["envelope"].get("first_update") == 0
        and encoding.get("source_first_clock") == 0
        and encoding["analytics"].get("match_end_source_tick") != 0
    ):
        return 0
    return None


def resolved_variant(path: Path, *, encoding: dict) -> dict | None:
    # Beta 3's resolved custom record is a 128-byte name followed by 57 LE i32s.
    # Only these reviewed fields are independent of map loadout clamps. Do not
    # infer bare built-in variants, map-granted grenades or a time limit.
    with path.open("rb") as source:
        header = source.read(448)
        if len(header) != 448:
            raise ValueError("Truncated recorded variant header")
        words = struct.unpack_from("<32I", header)
        if words[:4] != (0x314D4C46, 2, 45, 120):
            raise ValueError("Unsupported recorded variant adapter")
        offset, size = words[21:23]
        if size != 356:
            return None
        if offset < 448 or offset + size > words[17]:
            raise ValueError("Invalid resolved variant bounds")
        source.seek(offset)
        raw = source.read(size)
    if len(raw) != size:
        raise ValueError("Truncated resolved variant")
    fields = struct.unpack_from("<57i", raw, 128)
    mode = {0: (2, "slayer"), 1: (1, "ctf"), 3: (3, "oddball"), 4: (4, "king")}.get(fields[0])
    if mode is None or mode[0] != encoding["game_type"] or type(encoding["has_teams"]) is not bool:
        return None
    return {
        "provenance": "recorded_resolved_variant", "game_type": mode[1],
        "teamplay": encoding["has_teams"],
        "score_to_win": fields[1] if 0 <= fields[1] <= 9999 else None,
        "respawn_seconds": fields[18] if 0 <= fields[18] <= 3600 else None,
        "suicide_penalty_seconds": fields[19] if 0 <= fields[19] <= 3600 else None,
        "shields_enabled": bool(fields[21]) if fields[21] in (0, 1) else None,
        "motion_tracker": "all" if fields[30] == 1 else "off"
        if fields[30] == 0 and fields[31] in (1, 2) else None,
        "starting_grenades": None, "time_limit_seconds": None,
    }


def kill_attribution(path: Path, *, report: dict, encoding: dict) -> dict:
    def unavailable(reason):
        return {"provenance": "recorded_evt1", "coverage": "unavailable", "reason": reason, "events": []}

    envelope = report["envelope"]
    origin = encoding.get("source_first_clock")
    if (
        type(origin) is not int or origin != envelope.get("first_update")
        or encoding.get("source_last_clock") != origin + envelope["ticks"] - 1
    ):
        return unavailable("unverified_clock")
    with path.open("rb") as source:
        raw = source.read(448)
        if len(raw) != 448:
            raise ValueError("Truncated recorded film header")
        words = struct.unpack_from("<32I", raw)
        if words[:4] != (0x314D4C46, 2, 45, 120):
            raise ValueError("Unsupported recorded event adapter")
        offset, size = words[28:30]
        if not size:
            return unavailable("missing_section")
        if size < 32 or size > 32 + 65536 * 64 or offset < words[12] + 8 or offset + size > path.stat().st_size:
            raise ValueError("Invalid recorded event section bounds")
        source.seek(offset)
        section = source.read(size)
    if len(section) != size:
        raise ValueError("Truncated recorded events")
    magic, version, header, stride, count, flags, _, _ = struct.unpack_from("<8I", section)
    if magic != 0x31545645 or version != 1 or header != 32 or stride != 16 or flags & ~3:
        return unavailable("unverified_clock")
    if count > 65536 or header + count * stride != size:
        raise ValueError("Invalid recorded event count")
    if flags & 2:
        return unavailable("missing_section")
    slots = set(encoding["players"])
    end = encoding["analytics"].get("match_end_source_tick")
    stop = envelope["ticks"] if end is None else end + 1
    events, observed = [], Counter()
    previous = -1
    for index in range(count):
        tick, kind, _, _, killer, victim = struct.unpack_from("<iBbbBB", section, header + index * stride)
        if tick < previous or kind > 4:
            return unavailable("unverified_clock")
        previous = tick
        tick -= origin
        if kind != 0 or tick < 0 or tick >= stop:
            continue
        if killer not in slots or victim not in slots or killer == victim:
            return unavailable("unverified_clock")
        observed[killer, tick] += 1
        if observed[killer, tick] > encoding.get("kill_ticks", {}).get(str(killer), {}).get(str(tick), 0):
            return unavailable("unverified_clock")
        events.append({"source_tick": tick, "killer_slot": killer, "victim_slot": victim})
    capped = bool(flags & 1) or len(events) > 8192
    events = events[:8192]
    kills, deaths = Counter(event["killer_slot"] for event in events), Counter(event["victim_slot"] for event in events)
    final = encoding["final_counters"]
    if any(deaths[slot] > final[str(slot)].get("deaths", 0) for slot in slots):
        return unavailable("unverified_clock")
    complete = not capped and all(kills[slot] == final[str(slot)].get("kills") for slot in slots)
    return {
        "provenance": "recorded_evt1", "coverage": "complete" if complete else "partial",
        "reason": None if complete else "capped_section" if capped else "partial_recording", "events": events,
    }
