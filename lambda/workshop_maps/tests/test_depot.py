import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

auth = importlib.import_module("lambda.workshop_maps.steam_auth")
depot = importlib.import_module("lambda.workshop_maps.depot")
worker = importlib.import_module("lambda.workshop_maps.worker")
bootstrap = importlib.import_module("lambda.workshop_maps.bootstrap")
ACCOUNT_PATH = ".local/share/IsolatedStorage/fixture.abc/fixture.def/Url.fixture/AssemFiles/account.config"


class DepotTests(unittest.TestCase):
    def test_account_store_is_bounded_and_confined_to_isolated_storage(self):
        value = auth.encode_session("fixture", b"opaque-token", account_path=ACCOUNT_PATH)
        self.assertEqual(auth.decode_session("fixture", value), b"opaque-token")
        for path in ("/etc/passwd", "../account.config", ACCOUNT_PATH.replace("fixture.abc", ".."),
                     ACCOUNT_PATH.replace("account.config", "something.py"), ACCOUNT_PATH.replace("/", "\\")):
            data = {**json.loads(value), "account_path": path}
            with self.assertRaises(auth.AuthRequired):
                auth.decode_session("fixture", json.dumps(data))

    def test_session_rotation_preserves_backend_and_omits_password(self):
        value = auth.encode_session("fixture", b"old-token", account_path=ACCOUNT_PATH)
        ssm = Mock()
        ssm.get_parameter.side_effect = [
            {"Parameter": {"Value": '{"username":"fixture","password":"private"}'}},
            {"Parameter": {"Value": value, "Version": 2}},
            {"Parameter": {"Value": value, "Version": 2}}]
        credentials = auth.load_credentials(ssm, "/credentials", "/session")
        self.assertNotIn("password", credentials)
        self.assertEqual(credentials["account_config"], b"old-token")
        credentials["save_config"](b"rotated-token")
        saved = ssm.put_parameter.call_args.kwargs["Value"]
        self.assertEqual(auth.decode_session("fixture", saved), b"rotated-token")
        self.assertEqual(json.loads(saved)["account_path"], ACCOUNT_PATH)

    def test_download_uses_only_saved_token_and_requires_completed_transfer(self):
        for output, code, expected in (
            (b"Using Steam3 suggested CellID: 1\nTotal downloaded: 123 bytes", 0, True),
            (b"Using Steam3 suggested CellID: 1\nUnable to locate manifest", 0, False),
            (b"Access token was rejected (Expired)", 1, False),
        ):
            with self.subTest(output=output), tempfile.TemporaryDirectory() as temp:
                work = Path(temp)
                credentials = {"username": "fixture", "account_path": ACCOUNT_PATH,
                    "account_config": b"private-token", "save_config": Mock()}

                def popen(args, **kwargs):
                    self.assertNotIn("-password", args)
                    self.assertNotIn("private-token", " ".join(args))
                    self.assertEqual(kwargs["stdin"], depot.subprocess.DEVNULL)
                    home = Path(kwargs["env"]["HOME"])
                    self.assertEqual((home / ACCOUNT_PATH).read_bytes(), b"private-token")
                    (home / ACCOUNT_PATH).write_bytes(b"new-token")
                    (work / "package").mkdir()
                    kwargs["stdout"].write(output)
                    return Mock(pid=123, returncode=code, poll=Mock(return_value=code))

                with patch.dict(worker.os.environ, {"WORKSHOP_DOWNLOADER": "depotdownloader"}), \
                     patch.object(depot.subprocess, "Popen", side_effect=popen), \
                     patch.object(depot.os, "killpg", create=True), \
                     patch.object(depot.signal, "SIGKILL", 9, create=True):
                    if expected:
                        self.assertEqual(worker.steam_download("123", work, 1, credentials), work / "package")
                        credentials["save_config"].assert_called_once_with(b"new-token")
                    else:
                        with self.assertRaises(worker.WorkshopError):
                            worker.steam_download("123", work, 1, credentials)
                    if not auth.logged_in(output.decode()):
                        credentials["save_config"].assert_not_called()

    def test_legacy_session_requires_new_bootstrap_without_password_fallback(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(depot.subprocess, "Popen") as process:
            with self.assertRaises(worker.WorkshopError) as error:
                depot.download("123", Path(temp), 1, {"username": "fixture", "config_vdf": b"old"},
                    error_type=worker.WorkshopError, check_tree=worker.tree_size)
            self.assertEqual(error.exception.state, "auth_required")
            process.assert_not_called()

    def test_guard_and_password_are_sent_only_to_private_prompt(self):
        child = Mock()
        child.expect.side_effect = [0, 2, 1, 4]
        with patch.object(bootstrap.getpass, "getpass", return_value="AB123"):
            bootstrap.authenticate_depot(child, 'quote"back\\slash', True)
        self.assertEqual([call.args[0] for call in child.sendline.call_args_list],
                         ['quote"back\\slash', "AB123"])
        child.expect.side_effect = [0, 2]
        with self.assertRaises(auth.AuthRequired):
            bootstrap.authenticate_depot(child, "password", False)


if __name__ == "__main__":
    unittest.main()
