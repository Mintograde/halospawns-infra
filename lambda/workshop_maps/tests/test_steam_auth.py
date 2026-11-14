import base64
import importlib
import io
import json
import os
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import Mock, patch

auth = importlib.import_module("lambda.workshop_maps.steam_auth")
w = importlib.import_module("lambda.workshop_maps.worker")
bootstrap = importlib.import_module("lambda.workshop_maps.bootstrap")


class SessionTests(unittest.TestCase):
    def test_round_trip_identity_and_standard_parameter_limit(self):
        config = b'"InstallConfigStore" { "ConnectCache" { "fixture" "token" } }'
        value = auth.encode_session("fixture", config)
        self.assertEqual(auth.decode_session("fixture", value), config)
        for invalid in ("{}", "[]", "secret-not-json", value.replace('"version":1', '"version":2')):
            with self.assertRaises(auth.AuthRequired):
                auth.decode_session("fixture", invalid)
        with self.assertRaises(auth.AuthRequired):
            auth.decode_session("different-account", value)
        with self.assertRaises(auth.AuthRequired):
            auth.encode_session("fixture", os.urandom(5000))

    def test_compressed_bomb_truncation_and_trailing_bytes_rejected(self):
        for packed in (zlib.compress(b"a" * (auth.MAX_CONFIG + 1)),
                       zlib.compress(b"data")[:-1], zlib.compress(b"data") + b"trailing"):
            value = json.dumps({"version": 1, "username": "fixture",
                               "config_zlib": base64.b64encode(packed).decode()})
            with self.assertRaises(auth.AuthRequired):
                auth.decode_session("fixture", value)

    def test_empty_secret_and_command_injection_rejected(self):
        for value in (None, "", 'bad"name', "bad\\name", "bad\nquit", "bad\x00", "bad\tvalue"):
            with self.assertRaises(auth.AuthRequired):
                auth.login_value(value)
        ssm = Mock()
        ssm.get_parameter.return_value = {"Parameter": {"Value": '{"username":"","password":""}'}}
        with self.assertRaises(auth.AuthRequired):
            auth.load_credentials(ssm, "/credentials", "/session")

    def load(self, current_version=2):
        value = auth.encode_session("fixture", b"old-config")
        ssm = Mock()
        ssm.get_parameter.side_effect = [
            {"Parameter": {"Value": '{"username":"fixture","password":"never-to-SteamCMD"}'}},
            {"Parameter": {"Value": value, "Version": 2}},
            {"Parameter": {"Value": value, "Version": current_version}},
        ]
        return ssm, auth.load_credentials(ssm, "/credentials", "/session")

    def test_cached_login_omits_password_and_saves_rotated_token(self):
        ssm, credentials = self.load()
        self.assertNotIn("password", credentials)
        credentials["save_config"](b"new-config")
        request = ssm.put_parameter.call_args.kwargs
        self.assertEqual(request["Name"], "/session")
        self.assertEqual((request["Type"], request["KeyId"], request["Tier"]),
                         ("SecureString", "alias/aws/ssm", "Standard"))
        self.assertEqual(auth.decode_session("fixture", request["Value"]), b"new-config")

    def test_unchanged_session_and_concurrent_reauthorization_are_not_overwritten(self):
        ssm, credentials = self.load()
        credentials["save_config"](b"old-config")
        ssm.put_parameter.assert_not_called()
        ssm, credentials = self.load(current_version=3)
        credentials["save_config"](b"new-config")
        ssm.put_parameter.assert_not_called()

    def test_download_restores_session_without_password_or_secret_arguments(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            seed, work = base / "seed", base / "work"
            seed.mkdir()
            work.mkdir()
            save = Mock()
            credentials = {"username": "fixture", "config_vdf": b"old-config", "save_config": save}

            def popen(args, **kwargs):
                self.assertNotIn("fixture", " ".join(args))
                self.assertNotIn("old-config", " ".join(args))
                self.assertIn('login "fixture"\n', (work / "download.txt").read_text())
                config = work / "steam/config/config.vdf"
                self.assertEqual(config.read_bytes(), b"old-config")
                config.write_bytes(b"new-config")
                (work / "steam/steamapps/workshop/content/976730/123").mkdir(parents=True)
                kwargs["stdout"].write(b"Logging in using cached credentials.\nSuccess. Downloaded item 123\n")
                return Mock(pid=123, returncode=0, poll=Mock(return_value=0), wait=Mock(return_value=0))

            with patch.dict(w.os.environ, {"STEAMCMD_ROOT": str(seed)}), \
                 patch.object(w.subprocess, "Popen", side_effect=popen), \
                 patch.object(w.os, "killpg", create=True), \
                 patch.object(w.signal, "SIGKILL", 9, create=True):
                self.assertTrue(w.steam_download("123", work, 1, credentials).is_dir())
            save.assert_called_once_with(b"new-config")

    def test_entitlement_and_access_errors_do_not_claim_ownership_proof(self):
        self.assertEqual(auth.failure_reason("ERROR! Download item failed (No subscription)."), "no_subscription")
        self.assertEqual(auth.failure_reason("Access Denied"), "access_denied")
        self.assertEqual(auth.failure_reason("Invalid Password"), "authentication_required")
        self.assertEqual(auth.failure_reason("Steam Guard code required"), "authentication_required")
        self.assertEqual(auth.failure_reason("network failed"), "download_failed")

    def test_missing_secret_finishes_claim_and_preserves_maintenance(self):
        ssm, s3 = Mock(), Mock()
        ssm.get_parameter.side_effect = [
            {"Parameter": {"Value": "hmac"}}, RuntimeError("sensitive SDK error")]
        job = {"app_id": w.APP, "item_id": "123", "lease_id": "lease"}
        fake_boto = Mock(client=Mock(side_effect=[ssm, s3]))
        with patch.dict(sys.modules, {"boto3": fake_boto}), \
             patch.dict(w.os.environ, {"WORKSHOP_HMAC_PARAMETER": "/hmac",
                 "WORKSHOP_STEAM_CREDENTIALS_PARAMETER": "/credentials"}), \
             patch.object(w, "api", side_effect=[{}, {"job": job}, {}, {}]) as api:
            self.assertEqual(w.handler({"action": "poll"}, Mock())["state"], "auth_required")
        self.assertEqual(api.call_args_list[2].args[1], {
            **job, "state": "auth_required", "error": "authentication_required"})
        self.assertEqual(api.call_args_list[0].args[0], "/v1/ingest/workshop/maintain")
        self.assertEqual(api.call_args_list[-1].args[0], "/v1/ingest/workshop/maintain")

    def test_probe_has_no_api_or_s3_side_effects(self):
        with patch.object(w.steam_auth, "load_credentials", side_effect=auth.AuthRequired()), \
             patch.object(w, "api") as api, patch.object(w, "steam_download") as download:
            self.assertEqual(w.probe({"item_id": "123"}, Mock(), Mock()),
                             {"state": "auth_required", "reason": "authentication_required"})
        api.assert_not_called()
        download.assert_not_called()


class BootstrapTests(unittest.TestCase):
    def test_guard_code_is_prompted_privately_and_never_stored(self):
        child = Mock()
        child.expect.side_effect = [0, 4, 2, 1, 0, 0]
        with patch.object(bootstrap.getpass, "getpass", return_value="AB123"):
            bootstrap.authenticate(child, "fixture", "password", True)
        self.assertEqual([call.args[0] for call in child.sendline.call_args_list],
                         ['login "fixture"', "password", "AB123", "quit"])

    def test_password_quotes_and_backslashes_bypass_command_parser(self):
        password = 'fictional"quoted\\password'
        self.assertEqual(auth.password_value(password), password)
        child = Mock()
        child.expect.side_effect = [0, 4, 1, 0, 0]
        bootstrap.authenticate(child, "fixture", password, False)
        self.assertEqual([call.args[0] for call in child.sendline.call_args_list],
                         ['login "fixture"', password, "quit"])
        child.setecho.assert_called_once_with(False)
        for invalid in ("", "a\nquit", "a\r", "a\x00"):
            with self.assertRaises(auth.AuthRequired):
                auth.password_value(invalid)

    def test_noninteractive_guard_and_failed_login_do_not_create_a_session(self):
        for match in (2, 0, 6):
            child = Mock()
            child.expect.side_effect = [0, match]
            with self.assertRaises(auth.AuthRequired):
                bootstrap.authenticate(child, "fixture", "password", False)


if __name__ == "__main__":
    unittest.main()
