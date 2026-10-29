import copy
import hashlib
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

from jsonschema import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import settings
from h1_film.registry import load_registry


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "test.h1film"

    def film(self, port="beta4", *, variant=True, config=None):
        profile = next(profile for profile in load_registry().values() if profile["port"] == port)
        header_size, count, options_size, offsets = settings.LAYOUTS[port]
        words = [0] * 32
        words[:8] = (0x314D4C46, 2, profile["protocol_revision"], 120, options_size, 32, 4, 0)
        words[11], words[13], words[14], words[15], words[16], words[25] = 20, 120, 1, 1000, header_size, 1
        data = bytearray(header_size)
        data[128:133], data[256:260] = b"dread", b"test"
        build = profile["build"].encode()
        data[384:384 + len(build)] = build
        options = bytearray(options_size)
        for key, offset in offsets.items():
            struct.pack_into("<i", options, offset, {"shot_delay_aim_ms": 17, "input_pipeline_ticks": 4,
                                                     "aim_rate_hz": 120, "shot_aim_ahead_ticks": 0}[key])
        words[18] = len(data)
        data += options
        text = (config if config is not None else """
[lobby]
seat1_profile = 1
score = 0
online_address = private.example.invalid
[tuning]
input_pipeline_ms_30tick = 999
input_pipeline_ms_120tick = 33
magnetism_friction =
magnetism_adhesion = 0
plasma_climb = 0
bot_skill = 2
weapon_pistol_autoaim_angle = 3.5
[profile0]
name = Unused saved profile
input_delay_ms = 100
[profile1]
name = Recorder profile
input_delay_ms = auto
sensitivity = 4.5
[gametype0]
name = Unused saved variant
score_to_win = 999
""").encode()
        words[19], words[20] = len(data), len(text)
        data += text
        if variant:
            record = bytearray(128 + count * 4)
            record[:8] = b"selected"
            fields = settings.VARIANT_FIELDS if port == "beta4" else [
                field for field in settings.VARIANT_FIELDS if field != "powerup_waypoints"
            ][:count]
            if port == "beta5":
                fields = settings.BETA5_VARIANT_FIELDS
            values = {"game_rules": 0, "score_to_win": 50, "teams": 1, "shields": 0,
                      "weapon_secondary": -1, "footstep_sounds": 1, "teammate_outlines": 1,
                      "os_brightness": 70, "fov_limit": 2, "powerup_waypoints": 3}
            for index, field in enumerate(fields):
                struct.pack_into("<i", record, 128 + index * 4, values.get(field, 0))
            words[21], words[22] = len(data), len(record)
            data += record
        words[17] = len(data)
        struct.pack_into("<32I", data, 0, *words)
        self.path.write_bytes(data)
        report = {"engine_profile": profile["id"], "envelope": {
            **{key: profile[key] for key in ("format", "protocol_revision", "tick_rate", "build")},
            "ticks": 20, "map": "dread", "gametype": "test", "map_bytes": 1000,
            "first_update": 0, "end_reason": 1,
        }, "provenance": {"film_sha256": hashlib.sha256(data).hexdigest(), "map_sha256": "a" * 64,
                           "wasm_sha256": profile["wasm_sha256"], "glue_sha256": profile["glue_sha256"]}}
        if "source" in profile:
            report["provenance"]["engine_source"] = profile["source"]
        encoding = {"game_type": 2, "has_teams": True, "players": [0, 1], "source_first_clock": 0,
                    "analytics": {"match_end_source_tick": 10}}
        return report, encoding

    def extract(self, **kwargs):
        report, encoding = self.film(**kwargs)
        return settings.extract(self.path, report=report, encoding=encoding)

    def test_catalogue_and_schema_are_machine_readable_and_current(self):
        path = settings.PACKAGE / "contracts/h1film-settings-catalogue.v1.json"
        self.assertEqual(json.loads(path.read_text()), settings.CATALOGUE)
        self.assertEqual(len(settings.VARIANT_FIELDS), 61)
        settings.validate_product(self.extract())
        example = settings.PACKAGE / "tests/fixtures/settings-v1.json"
        self.assertEqual(json.loads(example.read_text()), self.extract())

    def test_profile_specific_variant_layout_does_not_shift_older_fields(self):
        for port in settings.LAYOUTS:
            with self.subTest(port=port):
                fields = self.extract(port=port)["settings"]
                self.assertEqual(fields["variant.name"]["value"], "selected")
                self.assertEqual(fields["variant.score_to_win"]["value"], 50)
                self.assertEqual(fields["variant.os_brightness"]["value"], 70)
                if port == "beta5":
                    self.assertEqual(fields["variant.footstep_sounds"]["status"], "unavailable")
                    self.assertEqual(fields["variant.kill_restores"]["status"], "unavailable")
                else:
                    self.assertIs(fields["variant.footstep_sounds"]["value"], True)
                self.assertIs(fields["variant.teammate_outlines"]["value"], True)
                self.assertEqual(fields["variant.weapon_secondary"]["value"], -1)
                self.assertEqual(fields["variant.powerup_waypoints"].get("value"), 3 if port in ("beta4", "beta5") else None)
                self.assertEqual(fields["variant.fov_limit"].get("value"), None if port == "beta3" else 2)

    def test_timing_uses_binary_ticks_and_the_recorded_tick_rate(self):
        for port in settings.LAYOUTS:
            fields = self.extract(port=port)["settings"]
            self.assertEqual(fields["timing.input_pipeline_ticks"]["value"], 4)
            self.assertEqual(fields["timing.shot_delay_aim_ms"]["value"], 17)
            self.assertEqual(fields["timing.aim_rate_hz"]["value"], 120)
            self.assertEqual(fields["timing.input_pipeline_ms"]["value"], 33)
            self.assertEqual(fields["network.input_scheduling_delay_ticks"]["status"], "unavailable")
            self.assertEqual(fields["network.ping_ms"]["status"], "unavailable")

    def test_false_zero_unstated_and_missing_remain_distinct(self):
        fields = self.extract()["settings"]
        self.assertIs(fields["variant.shields"]["value"], False)
        self.assertIs(fields["tuning.plasma_climb"]["value"], False)
        self.assertEqual(fields["lobby.score"]["value"], 0)
        self.assertEqual(fields["tuning.magnetism_adhesion"]["value"], 0)
        self.assertEqual(fields["tuning.magnetism_friction"]["reason"], "unstated")
        self.assertEqual(fields["tuning.wall_jump"]["reason"], "not_recorded")
        self.assertEqual(fields["variant.time_limit_seconds"]["reason"], "not_recorded")
        self.assertEqual(fields["observed.game_type"]["value"], "slayer")
        self.assertEqual(fields["observed.match_start_source_tick"]["value"], 0)

    def test_only_used_recorder_profiles_export_without_private_or_unused_config(self):
        product = self.extract()
        self.assertEqual(len(product["recorder_profiles"]), 1)
        profile = product["recorder_profiles"][0]
        self.assertEqual(profile["profile_index"], 1)
        self.assertEqual(profile["local_seats"], [0])
        self.assertEqual(profile["settings"]["profile.input_delay_mode"]["value"], "auto")
        self.assertEqual(profile["settings"]["profile.input_delay_ms"]["reason"], "dynamic_value_not_recorded")
        serialized = json.dumps(product)
        for text in ("private.example", "Unused saved", "Recorder profile", "999"):
            self.assertNotIn(text, serialized)

    def test_missing_variant_does_not_select_saved_variant_or_infer_defaults(self):
        fields = self.extract(variant=False)["settings"]
        self.assertEqual(fields["variant.name"]["reason"], "missing_section")
        self.assertEqual(fields["variant.score_to_win"]["reason"], "missing_section")
        self.assertEqual(fields["observed.teamplay"]["value"], True)

    def test_untrusted_source_identity_and_layout_are_rejected(self):
        for mutation in ("film_hash", "profile", "engine_hash", "layout", "overlap", "bounds", "build"):
            with self.subTest(mutation=mutation):
                report, encoding = self.film()
                data = bytearray(self.path.read_bytes())
                if mutation == "film_hash":
                    report["provenance"]["film_sha256"] = "b" * 64
                elif mutation == "profile":
                    report["engine_profile"] = "future-unknown-profile"
                elif mutation == "engine_hash":
                    report["provenance"]["wasm_sha256"] = "b" * 64
                else:
                    if mutation == "layout":
                        struct.pack_into("<I", data, 16 * 4, 448)
                    elif mutation == "overlap":
                        struct.pack_into("<I", data, 21 * 4, 480)
                    elif mutation == "bounds":
                        struct.pack_into("<I", data, 19 * 4, len(data) - 2)
                    else:
                        data[384] = 65
                    self.path.write_bytes(data)
                    report["provenance"]["film_sha256"] = hashlib.sha256(data).hexdigest()
                with self.assertRaises(ValueError):
                    settings.extract(self.path, report=report, encoding=encoding)

    def test_duplicate_settings_and_resource_budgets_fail_closed(self):
        for config in ("[tuning]\nnet_model=1\nnet_model=2", "[tuning]\n[tuning]", "not a config"):
            with self.subTest(config=config), self.assertRaises(ValueError):
                self.extract(config=config)
        with self.assertRaises(ValueError):
            settings.parse_text(b"x" * (settings.MAX_TEXT_BYTES + 1))

    def test_invalid_optional_value_does_not_invent_a_setting(self):
        fields = self.extract(config="[tuning]\nmagnetism_friction=NaN\nwall_jump=2\nplasma_climb_gain=oops")["settings"]
        for key in ("magnetism_friction", "wall_jump", "plasma_climb_gain"):
            self.assertEqual(fields[f"tuning.{key}"]["reason"], "invalid_value")

    def test_contract_rejects_null_wrong_type_and_scope_confusion(self):
        original = self.extract()
        for value in (None, 1, "false"):
            product = copy.deepcopy(original)
            product["settings"]["variant.shields"]["value"] = value
            with self.assertRaises((ValueError, ValidationError)):
                settings.validate_product(product)
        product = copy.deepcopy(original)
        product["settings"]["profile.input_delay_ms"] = settings.entry("profile.input_delay_ms", 0, "recorded_configuration")
        with self.assertRaises(ValueError):
            settings.validate_product(product)


if __name__ == "__main__":
    unittest.main()
