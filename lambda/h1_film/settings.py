"""Bounded, profile-specific settings evidence, independent of viewer/analytics versions."""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from pathlib import Path

from jsonschema import Draft202012Validator

from .recorded import match_start
from .registry import profile_for_report

PACKAGE = Path(__file__).parent
SCHEMA = "halospawns.h1FilmSettings.v1"
MAX_DOCUMENT_BYTES = 256 * 1024
MAX_TEXT_BYTES = 1024 * 1024
LAYOUTS = {
    "beta3": (448, 57, 10352, {"shot_delay_aim_ms": 10168, "input_pipeline_ticks": 10172, "aim_rate_hz": 10188}),
    "h1arena": (480, 60, 12340, {"shot_delay_aim_ms": 12048, "input_pipeline_ticks": 12052, "aim_rate_hz": 12072}),
    "beta4": (480, 61, 12376, {"shot_delay_aim_ms": 12080, "input_pipeline_ticks": 12084,
                            "aim_rate_hz": 12108, "shot_aim_ahead_ticks": 12088}),
}
VARIANT_FIELDS = """
game_rules score_to_win flag_pickup ball_pickup hill_order hill_move_s
ctf_assault ctf_single_flag_s ctf_flag_must_reset ctf_flag_at_home king_moving_hill
ball_type ball_count ball_random_start ball_speed ball_trait_with ball_trait_without
teams respawn_s suicide_s health_pct shields infinite_ammo fireteams infinite_grenades
frags plasmas weapon_primary weapon_secondary skip_first_draw motion_tracker
objectives_indicator friend_indicators camo_variant camo_refraction camo_falloff
camo_tint_r camo_tint_g camo_tint_b spawns_visible powerup_waypoints random_pct_visible
footstep_sounds kill_restores overshield_visible os_tint_perp_r os_tint_perp_g
os_tint_perp_b os_tint_par_r os_tint_par_g os_tint_par_b os_brightness os_type
omit_first_spawn item_spawn_s camo_drop os_assassination teammate_outlines
teammate_view teammate_respawn_timers fov_limit
""".split()
VARIANT_BOOLEANS = set("""
ctf_assault ctf_flag_must_reset ctf_flag_at_home king_moving_hill ball_random_start
teams shields fireteams infinite_grenades skip_first_draw motion_tracker
friend_indicators footstep_sounds kill_restores overshield_visible teammate_outlines
teammate_view teammate_respawn_timers
""".split())
TUNING_FIELDS = """
plasma_overheat_damage plasma_grenade_stickiness shotgun_spread_constant pistol_spread
plasma_climb plasma_climb_gain wall_jump wall_jump_window_ms wall_jump_height
wall_jump_kick wall_jump_steer wall_jump_momentum crouch_slide crouch_slide_friction
crouch_slide_gain crouch_slide_max_ms move_run_forward move_run_backward
move_run_sideways move_run_acceleration move_sneak_forward move_sneak_backward
move_sneak_sideways move_sneak_acceleration move_air_acceleration move_stun_movement
move_stun_turning move_stun_min_time move_stun_max_time
""".split()
PROFILE_FIELDS = """
invert sensitivity vert_mult vert_accel look_dz look_dz_type move_dz move_dz_type
outer_dz outer_dz_type look_curve look_curve_type look_curve_exponent look_accel
look_accel_time stick_swap trigger_behavior input_delay_ms mouse_sensitivity
mouse_vert_mult mouse_invert mouse_zoom_sensitivity mouse_advanced mouse_adv_mode
mouse_adv_input_hz mouse_adv_acceleration mouse_adv_offset mouse_adv_power
mouse_adv_cap_min mouse_adv_cap_max mouse_adv_angle mouse_adv_angle_snap
mouse_adv_speed_cap mouse_adv_prescale_x mouse_adv_prescale_y mouse_adv_postscale_x
mouse_adv_postscale_y
""".split()
WEAPONS = "pistol sniper_rifle rocket_launcher plasma_pistol assault_rifle needler plasma_rifle shotgun".split()


def catalogue() -> dict:
    definitions = {}

    def add(key, kind="integer", unit="code", scope="match", meaning="configured", **extra):
        definitions[key] = {"type": kind, "unit": unit, "scope": scope, "meaning": meaning, **extra}

    add("variant.name", "string", "text")
    for key in VARIANT_FIELDS:
        kind = "boolean" if key in VARIANT_BOOLEANS else "integer"
        unit = "boolean" if kind == "boolean" else "seconds" if key.endswith("_s") else "code"
        if key in ("health_pct", "os_brightness"):
            unit = "percent"
        if key in ("score_to_win", "frags", "plasmas", "ball_count"):
            unit = "count"
        add(f"variant.{key}", kind, unit)
    for key in TUNING_FIELDS:
        kind = "boolean" if key in ("plasma_overheat_damage", "shotgun_spread_constant", "plasma_climb",
                                   "wall_jump", "crouch_slide") else "integer"
        unit = "boolean" if kind == "boolean" else "milliseconds" if key.endswith("_ms") else "engine_setting"
        add(f"tuning.{key}", kind, unit)
    for key, unit in (("shot_delay_aim_ms", "milliseconds"), ("input_pipeline_ticks", "source_ticks"),
                      ("aim_rate_hz", "hertz"), ("shot_aim_ahead_ticks", "source_ticks")):
        add(f"timing.{key}", unit=unit, meaning="recorded_simulation_setting")
    for key in ("input_pipeline_ms", "shot_aim_ahead_ms"):
        add(f"timing.{key}", unit="milliseconds")
    for key in ("magnetism_friction", "magnetism_adhesion"):
        add(f"tuning.{key}", "number", "ratio")
    for weapon in WEAPONS:
        for field in ("autoaim_angle", "autoaim_distance", "magnetism_angle", "magnetism_distance"):
            add(f"weapon.{weapon}.{field}", "number", "degrees" if field.endswith("angle") else "world_units")
    for key in ("net_model", "shot_prediction", "max_players", "players_per_machine"):
        add(f"network.{key}", unit="count" if key in ("max_players", "players_per_machine") else "code",
            scope="recorder", meaning="configuration_snapshot")
    for key, kind in (("variant", "string"), ("gametype", "string"), ("score", "integer"),
                      ("grenades", "string"), ("teams", "string")):
        add(f"lobby.{key}", kind, "text" if kind == "string" else "count")
    for key, kind in (("bots", "integer"), ("bot_skill", "integer"), ("bot_teams", "string")):
        add(f"bots.{key}", kind, "text" if kind == "string" else "code" if key == "bot_skill" else "count")
    for key in PROFILE_FIELDS:
        kind = "string" if key in ("look_dz_type", "move_dz_type", "outer_dz_type", "look_curve",
                                    "look_curve_type", "trigger_behavior") else "number"
        if key in ("invert", "vert_accel", "stick_swap", "mouse_invert", "mouse_advanced"):
            kind = "boolean"
        if key in ("look_dz", "move_dz", "outer_dz", "input_delay_ms", "mouse_adv_mode"):
            kind = "integer"
        add(f"profile.{key}", kind, "milliseconds" if key == "input_delay_ms" else "profile_setting",
            scope="recorder_profile", meaning="configuration_snapshot")
    add("profile.input_delay_mode", "string", "code", scope="recorder_profile", meaning="configuration_snapshot")
    for key, kind, unit in (
        ("format", "integer", "code"), ("protocol_revision", "integer", "code"),
        ("build", "string", "text"), ("map", "string", "text"), ("gametype", "string", "text"),
        ("tick_rate", "integer", "hertz"), ("tick_count", "integer", "source_ticks"),
        ("first_update", "integer", "source_ticks"), ("end_reason", "integer", "code"),
        ("epoch_seed", "integer", "seed"), ("epoch_local_seed", "integer", "seed"),
        ("local_seat_count", "integer", "count"), ("map_bytes", "integer", "bytes"),
        ("created_utc", "integer", "unix_seconds"), ("networked", "boolean", "boolean"),
        ("universal", "boolean", "boolean"), ("initial_human_player_count", "integer", "count"),
        ("recorder_player_slot", "integer", "slot"), ("hash_period", "integer", "source_ticks"),
    ):
        add(f"recording.{key}", kind, unit, scope="recording", meaning="recorded")
    for key, kind, unit in (
        ("game_type", "string", "code"), ("teamplay", "boolean", "boolean"),
        ("participant_count", "integer", "count"), ("match_start_source_tick", "integer", "source_ticks"),
        ("match_end_source_tick", "integer", "source_ticks"),
    ):
        add(f"observed.{key}", kind, unit, meaning="observed")
    for key in ("records", "applications", "blocks", "participant_count", "max_player_slot"):
        add(f"network.{key}", unit="count", scope="recording", meaning="recorded")
    for key, kind, unit in (
        ("network.input_scheduling_delay_ticks", "integer", "source_ticks"),
        ("network.ping_ms", "number", "milliseconds"), ("network.jitter_ms", "number", "milliseconds"),
        ("network.packet_loss_percent", "number", "percent"), ("network.host_player_slot", "integer", "slot"),
        ("variant.time_limit_seconds", "integer", "seconds"),
        ("observed.effective_respawn_seconds", "number", "seconds"),
    ):
        add(key, kind, unit, meaning="unavailable_in_adapter_v1")
    return {"schema": "halospawns.h1FilmSettingsCatalogue.v1", "revision": 1, "definitions": definitions}


CATALOGUE = catalogue()


def unavailable(reason, provenance="none"):
    return {"status": "unavailable", "reason": reason, "provenance": provenance}


def entry(key, value, provenance):
    definition = CATALOGUE["definitions"][key]
    kind = definition["type"]
    if kind == "boolean" and type(value) is int and value in (0, 1):
        value = bool(value)
    if kind == "boolean":
        valid = type(value) is bool
    elif kind == "integer":
        valid = type(value) is int and abs(value) <= 2**53 - 1
    elif kind == "number":
        valid = type(value) in (int, float) and math.isfinite(value) and abs(value) <= 2**53 - 1
    else:
        valid = isinstance(value, str) and len(value) <= 256 and all(ord(char) >= 32 for char in value)
    if not valid:
        return unavailable("invalid_value", provenance)
    return {"status": "available", "value": value, "provenance": provenance}


def text_value(key, value, provenance="recorded_configuration"):
    if value is None:
        return unavailable("not_recorded", provenance)
    if not value or value == "-1":
        return unavailable("unstated", provenance)
    kind = CATALOGUE["definitions"][key]["type"]
    try:
        if kind in ("integer", "boolean"):
            if not re.fullmatch(r"-?[0-9]{1,16}", value):
                raise ValueError()
            value = int(value)
        elif kind == "number":
            value = float(value)
    except (ValueError, OverflowError):
        return unavailable("invalid_value", provenance)
    return entry(key, value, provenance)


def parse_text(raw):
    if len(raw) > MAX_TEXT_BYTES:
        raise ValueError("Recorded settings text exceeds its budget")
    sections, section = {}, None
    for line in raw.decode("utf-8", errors="strict").splitlines():
        line = line.strip()
        if not line or line.startswith(("#", ";")):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].lower()
            if not re.fullmatch(r"[a-z0-9_]{1,64}", section) or section in sections:
                raise ValueError("Ambiguous recorded settings section")
            sections[section] = {}
        else:
            if section is None or "=" not in line or len(line) > 4096:
                raise ValueError("Invalid recorded settings line")
            key, value = (part.strip() for part in line.split("=", 1))
            key = key.lower()
            if not re.fullmatch(r"[a-z0-9_]{1,96}", key) or key in sections[section]:
                raise ValueError("Ambiguous recorded settings key")
            sections[section][key] = value
        if sum(len(fields) for fields in sections.values()) > 4096:
            raise ValueError("Too many recorded settings fields")
    return sections


def validate_product(product):
    schema = json.loads((PACKAGE / "contracts/h1film-settings.v1.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(product)
    if len(json.dumps(product, allow_nan=False).encode()) > MAX_DOCUMENT_BYTES:
        raise ValueError("Settings product exceeds its budget")
    for subject in [product["settings"], *(profile["settings"] for profile in product["recorder_profiles"])]:
        for key, field in subject.items():
            if key not in CATALOGUE["definitions"]:
                raise ValueError("Unregistered settings key")
            if field["status"] == "available":
                normalized = entry(key, field["value"], field["provenance"])
                if normalized != field or type(normalized.get("value")) is not type(field["value"]):
                    raise ValueError("Settings value does not match its catalogue type")
    indices = [profile["profile_index"] for profile in product["recorder_profiles"]]
    seats = [seat for profile in product["recorder_profiles"] for seat in profile["local_seats"]]
    if len(set(indices)) != len(indices) or len(set(seats)) != len(seats):
        raise ValueError("Ambiguous recorder profile mapping")
    for key in product["settings"]:
        if CATALOGUE["definitions"][key]["scope"] == "recorder_profile":
            raise ValueError("Recorder profile setting used as a match setting")
    for profile in product["recorder_profiles"]:
        if any(CATALOGUE["definitions"][key]["scope"] != "recorder_profile" for key in profile["settings"]):
            raise ValueError("Match setting used as a recorder profile setting")


def extract(path: Path, *, report: dict, encoding: dict) -> dict:
    profile = profile_for_report(report)
    header_size, field_count, options_size, offsets = LAYOUTS[profile["port"]]
    size = path.stat().st_size
    if not header_size <= size <= 512 * 1024 * 1024:
        raise ValueError("Settings film size outside bounds")
    with path.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != report["provenance"]["film_sha256"]:
            raise ValueError("Settings source differs from verified film")
        source.seek(0)
        header = source.read(header_size)
        if len(header) != header_size:
            raise ValueError("Truncated settings header")
        words = struct.unpack_from("<32I", header)
        if words[:4] != (0x314D4C46, profile["format"], profile["protocol_revision"], profile["tick_rate"]):
            raise ValueError("Settings header differs from engine profile")
        if words[16] != header_size or words[4] not in (
            options_size, options_size + 4 if profile["port"] == "beta4" else options_size
        ):
            raise ValueError("Unsupported recorded settings layout")
        if not header_size <= words[17] <= size:
            raise ValueError("Recorded settings stream outside bounds")
        spans = []

        def read_section(offset, length, maximum, before_stream=True):
            if not length:
                if offset:
                    raise ValueError("Empty settings section has an offset")
                return b""
            if length > maximum or offset < header_size or offset + length > (words[17] if before_stream else size):
                raise ValueError("Recorded settings section outside bounds")
            if any(offset < stop and start < offset + length for start, stop in spans):
                raise ValueError("Overlapping recorded settings sections")
            spans.append((offset, offset + length))
            source.seek(offset)
            data = source.read(length)
            if len(data) != length:
                raise ValueError("Truncated recorded settings section")
            return data

        options = read_section(words[18], words[4], options_size + 4)
        config = parse_text(read_section(words[19], words[20], MAX_TEXT_BYTES))
        variant = read_section(words[21], words[22], 128 + field_count * 4)
        read_section(words[23], words[24], MAX_TEXT_BYTES)
    if variant and len(variant) != 128 + field_count * 4:
        raise ValueError("Unsupported recorded variant layout")
    fields = {key: unavailable("not_recorded") for key, definition in CATALOGUE["definitions"].items()
              if definition["scope"] != "recorder_profile"}
    if variant:
        name = variant[:128].split(b"\0", 1)[0].decode("utf-8", errors="replace")
        fields["variant.name"] = entry("variant.name", name, "recorded_variant")
        variant_fields = VARIANT_FIELDS if profile["port"] == "beta4" else [
            key for key in VARIANT_FIELDS if key != "powerup_waypoints"
        ][:field_count]
        for key in VARIANT_FIELDS:
            fields[f"variant.{key}"] = unavailable("not_supported")
        for index, key in enumerate(variant_fields):
            fields[f"variant.{key}"] = entry(f"variant.{key}", struct.unpack_from("<i", variant, 128 + index * 4)[0],
                                              "recorded_variant")
    else:
        for key in ("name", *VARIANT_FIELDS):
            fields[f"variant.{key}"] = unavailable("missing_section", "recorded_variant")
    tuning, lobby = config.get("tuning", {}), config.get("lobby", {})
    for key in fields:
        group, name = key.split(".", 1)
        if group in ("tuning", "network", "bots") and name in (*TUNING_FIELDS, "magnetism_friction",
                "magnetism_adhesion", "net_model", "shot_prediction", "max_players", "players_per_machine",
                "bots", "bot_skill", "bot_teams"):
            fields[key] = text_value(key, tuning.get(name))
        elif group == "weapon":
            fields[key] = text_value(key, tuning.get("weapon_" + name.replace(".", "_")))
        elif group == "lobby":
            fields[key] = text_value(key, lobby.get(name))
    for name, offset in offsets.items():
        value = struct.unpack_from("<i", options, offset)[0]
        fields[f"timing.{name}"] = entry(f"timing.{name}", value, "recorded_options") if value >= 0 else unavailable("unstated", "recorded_options")
    for name in ("input_pipeline_ms", "shot_aim_ahead_ms"):
        value = tuning.get(f"{name}_{profile['tick_rate']}tick", tuning.get(name))
        fields[f"timing.{name}"] = text_value(f"timing.{name}", value)
    if "shot_aim_ahead_ticks" not in offsets:
        fields["timing.shot_aim_ahead_ticks"] = unavailable("not_supported")
    header_fields = {"format": words[1], "protocol_revision": words[2], "tick_rate": words[3],
                     "epoch_seed": words[8], "epoch_local_seed": words[9], "first_update": words[10],
                     "tick_count": words[11], "hash_period": words[13], "end_reason": words[14],
                     "map_bytes": words[15], "local_seat_count": words[25], "networked": bool(words[7] & 2),
                     "universal": bool(words[7] & 8)}
    for name, start, stop in (("map", 128, 256), ("gametype", 256, 384), ("build", 384, 448)):
        header_fields[name] = header[start:stop].split(b"\0", 1)[0].decode("utf-8", errors="replace")
    for name in ("format", "protocol_revision", "tick_rate", "map", "gametype", "build", "map_bytes", "first_update", "end_reason"):
        if header_fields[name] != report["envelope"][name]:
            raise ValueError("Settings header differs from verified envelope")
    if header_fields["tick_count"] != report["envelope"]["ticks"]:
        raise ValueError("Settings tick count differs from verified envelope")
    if words[7] & 2:
        header_fields.update(initial_human_player_count=words[31] & 255, recorder_player_slot=(words[31] >> 8) & 255)
    else:
        header_fields["initial_human_player_count"] = words[25]
    if profile["port"] == "beta4":
        created = struct.unpack_from("<Q", header, 464)[0]
        if created:
            header_fields["created_utc"] = created
    for key, value in header_fields.items():
        fields[f"recording.{key}"] = entry(f"recording.{key}", value, "recorded_header")
    for key, value in report["envelope"].get("network", {}).items():
        if f"network.{key}" in fields:
            fields[f"network.{key}"] = entry(f"network.{key}", value, "verified_envelope")
    observed = {"game_type": {1: "ctf", 2: "slayer", 3: "oddball", 4: "king", 5: "race"}.get(encoding.get("game_type")),
                "teamplay": encoding.get("has_teams"), "participant_count": len(encoding["players"]),
                "match_end_source_tick": encoding["analytics"].get("match_end_source_tick")}
    observed["match_start_source_tick"] = match_start(report, encoding)
    for key, value in observed.items():
        fields[f"observed.{key}"] = entry(f"observed.{key}", value, "verified_simulation") if value is not None else unavailable("not_observed", "verified_simulation")
    fields["observed.effective_respawn_seconds"] = unavailable("not_exported")
    profiles = []
    for index in range(8):
        section = config.get(f"profile{index}")
        local_seats = [seat for seat in range(min(words[25], 4)) if lobby.get(f"seat{seat + 1}_profile") == str(index)]
        if section is None or not local_seats:
            continue
        values = {f"profile.{key}": text_value(f"profile.{key}", section.get(key)) for key in PROFILE_FIELDS}
        delay = section.get("input_delay_ms")
        mode = "auto" if delay == "auto" else "fixed" if values["profile.input_delay_ms"]["status"] == "available" else None
        values["profile.input_delay_mode"] = entry("profile.input_delay_mode", mode, "recorded_configuration") if mode else unavailable("not_recorded")
        if mode == "auto":
            values["profile.input_delay_ms"] = unavailable("dynamic_value_not_recorded", "recorded_configuration")
        profiles.append({"profile_index": index, "local_seats": local_seats, "settings": values})
    product = {"schema": SCHEMA, "adapter_revision": 1, "catalogue_revision": 1,
               "engine_profile": profile["id"], "film_sha256": report["provenance"]["film_sha256"],
               "raw_map_sha256": report["provenance"]["map_sha256"], "settings": fields,
               "recorder_profiles": profiles}
    validate_product(product)
    return product
