import hashlib
import importlib.util
import io
import json
import os
import sys
import unittest
import zipfile
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location("code_updater", Path(__file__).resolve().parents[1] / "handler.py")
handler = importlib.util.module_from_spec(SPEC)
with patch.dict(os.environ, {"TARGET_FUNCTION_NAME": "test-api"}), patch.dict(
    sys.modules, {"boto3": SimpleNamespace(client=Mock())}
):
    SPEC.loader.exec_module(handler)


def configuration(version="158", mode="s3", code="released-code"):
    return {
        "Version": version,
        "RevisionId": "configuration-revision",
        "State": "Active",
        "LastUpdateStatus": "Successful",
        "CodeSha256": code,
        "Environment": {"Variables": {"ASSET_DELIVERY_MODE": mode, "REFERENCE": "/test/parameter"}},
        "Runtime": "python3.12",
        "Handler": "app.handler",
        "MemorySize": 512,
        "Timeout": 30,
        "TracingConfig": {"Mode": "Active"},
    }


def promotion_event(current):
    expected = {key: current[key] for key in (
        "Environment", "Runtime", "Handler", "MemorySize", "Timeout", "TracingConfig",
    )}
    payload = json.dumps(expected, sort_keys=True, separators=(",", ":"))
    return {
        "operation": "promote_configuration",
        "configuration_json": payload,
        "configuration_hash": hashlib.sha256(payload.encode()).hexdigest(),
    }


def release_event():
    return {"Records": [{
        "eventSource": "aws:s3",
        "s3": {
            "bucket": {"name": "test-artifacts"},
            "object": {"key": "releases/release%2B1.zip", "versionId": "artifact-version"},
        },
    }]}


class LambdaState:
    def __init__(self):
        self.latest = configuration("$LATEST")
        previous = configuration("157")
        previous["MemorySize"] = 256
        self.versions = {"157": previous, "158": configuration()}
        self.alias = {"FunctionVersion": "157", "RevisionId": "alias-revision", "Description": "API release"}
        self.code_updates = []
        self.publishes = []
        self.promotions = []
        self.on_list = lambda: None
        self.on_publish = lambda: None
        self.on_update = lambda: None
        self.before_alias_update = lambda: None

    def get_alias(self, **kwargs):
        return deepcopy(self.alias)

    def get_function_configuration(self, **kwargs):
        qualifier = kwargs.get("Qualifier")
        return deepcopy(self.versions[qualifier] if qualifier else self.latest)

    def get_paginator(self, name):
        assert name == "list_versions_by_function"
        self.on_list()
        return Mock(paginate=Mock(return_value=[
            {"Versions": [deepcopy(self.latest)]},
            {"Versions": deepcopy(list(self.versions.values()))},
        ]))

    def get_function(self, **kwargs):
        return {"Code": {"Location": "https://example.invalid/private-package-url"}}

    def update_function_code(self, **kwargs):
        assert kwargs["RevisionId"] == self.latest["RevisionId"]
        self.code_updates.append(kwargs)
        self.latest.update(CodeSha256="new-release-code", RevisionId="new-code-revision")
        result = deepcopy(self.latest)
        self.on_update()
        return result

    def publish_version(self, **kwargs):
        assert kwargs["CodeSha256"] == self.latest["CodeSha256"]
        assert kwargs["RevisionId"] == self.latest["RevisionId"]
        self.publishes.append(kwargs)
        version = str(max(map(int, self.versions)) + 1)
        self.versions[version] = {**deepcopy(self.latest), "Version": version}
        self.on_publish()
        return deepcopy(self.versions[version])

    def update_alias(self, **kwargs):
        self.before_alias_update()
        if kwargs["RevisionId"] != self.alias["RevisionId"]:
            raise RuntimeError("Alias revision conflict")
        self.promotions.append(kwargs)
        self.alias.update(FunctionVersion=kwargs["FunctionVersion"], RevisionId="promoted-revision")


class ConfigurationPromotionTests(unittest.TestCase):
    def setUp(self):
        self.aws = LambdaState()
        self.event = promotion_event(self.aws.latest)
        self.addCleanup(patch.stopall)
        patch.object(handler, "LAMBDA", self.aws).start()
        patch.object(handler, "EXPECTED_CONFIGURATION_HASH", self.event["configuration_hash"]).start()

    def test_promotes_terraform_configuration_without_deploying_code(self):
        result = handler.handler(self.event, None)
        self.assertEqual(result["lambda_version"], "158")
        self.assertEqual(result["configuration_hash"], self.event["configuration_hash"])
        self.assertEqual(self.aws.alias["FunctionVersion"], "158")
        self.assertEqual(self.aws.promotions[0]["Description"], "API release")
        self.assertEqual(self.aws.code_updates, [])
        self.assertEqual(self.aws.publishes, [])

    def test_retry_is_idempotent(self):
        handler.handler(self.event, None)
        result = handler.handler(self.event, None)
        self.assertEqual(result["status"], "already_current")
        self.assertEqual(len(self.aws.promotions), 1)

    def test_later_self_release_is_preserved_by_configuration_retry(self):
        handler.handler(self.event, None)
        handler.handler(release_event(), None)
        result = handler.handler(self.event, None)
        self.assertEqual(result["status"], "already_current")
        self.assertEqual(result["lambda_version"], "159")
        self.assertEqual(len(self.aws.promotions), 2)

    def test_stale_or_tampered_requests_do_not_reach_aws(self):
        for changes in ({"configuration_hash": "stale"}, {"configuration_json": "{}"}):
            with self.subTest(changes=changes), patch.object(handler, "LAMBDA") as aws:
                with self.assertRaisesRegex(RuntimeError, "stale"):
                    handler.handler({**self.event, **changes}, None)
                self.assertEqual(aws.mock_calls, [])

    def test_configuration_promotion_is_opt_in(self):
        handler.EXPECTED_CONFIGURATION_HASH = None
        with self.assertRaisesRegex(RuntimeError, "disabled"):
            handler.handler(self.event, None)

    def test_rejects_configuration_that_was_not_applied(self):
        self.aws.latest["MemorySize"] = 1024
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            handler.handler(self.event, None)
        self.assertEqual(self.aws.promotions, [])

    def test_does_not_release_staged_code_or_undo_a_code_rollback(self):
        self.aws.latest["CodeSha256"] = "unreleased-or-rolled-back-code"
        with self.assertRaisesRegex(RuntimeError, "LATEST differs from live code"):
            handler.handler(self.event, None)
        self.assertEqual(self.aws.promotions, [])

    def test_requires_a_matching_published_version(self):
        self.aws.versions["158"]["MemorySize"] = 1024
        with self.assertRaisesRegex(RuntimeError, "No published version"):
            handler.handler(self.event, None)

    def test_rejects_versions_with_different_unrequested_settings(self):
        self.aws.versions["158"]["Layers"] = [{"Arn": "unexpected-layer"}]
        with self.assertRaisesRegex(RuntimeError, "No published version"):
            handler.handler(self.event, None)

    def test_checks_all_pages_and_orders_versions_numerically(self):
        self.aws.versions["99"] = configuration("99")
        result = handler.handler(self.event, None)
        self.assertEqual(result["lambda_version"], "158")

    def test_rejects_alias_change_during_version_selection(self):
        self.aws.on_list = lambda: self.aws.alias.update(RevisionId="other-release")
        with self.assertRaisesRegex(RuntimeError, "changed during promotion"):
            handler.handler(self.event, None)
        self.assertEqual(self.aws.promotions, [])

    def test_rejects_latest_change_during_version_selection(self):
        self.aws.on_list = lambda: self.aws.latest.update(RevisionId="other-configuration")
        with self.assertRaisesRegex(RuntimeError, "changed during promotion"):
            handler.handler(self.event, None)
        self.assertEqual(self.aws.promotions, [])

    def test_alias_revision_guard_closes_final_promotion_race(self):
        self.aws.before_alias_update = lambda: self.aws.alias.update(RevisionId="last-moment-release")
        with self.assertRaisesRegex(RuntimeError, "revision conflict"):
            handler.handler(self.event, None)
        self.assertEqual(self.aws.promotions, [])

    def test_rejects_weighted_alias(self):
        self.aws.alias["RoutingConfig"] = {"AdditionalVersionWeights": {"158": 0.1}}
        with self.assertRaisesRegex(RuntimeError, "Weighted"):
            handler.handler(self.event, None)

    def test_rejects_inactive_candidate(self):
        self.aws.versions["158"]["State"] = "Failed"
        with self.assertRaisesRegex(RuntimeError, "update failed"):
            handler.handler(self.event, None)

    def test_waits_for_published_version_to_become_active(self):
        self.aws.versions["158"]["State"] = "Pending"
        with patch.object(handler.time, "sleep", side_effect=lambda _: self.aws.versions["158"].update(State="Active")):
            result = handler.handler(self.event, None)
        self.assertEqual(result["status"], "promoted")

    def test_configuration_errors_do_not_echo_values(self):
        self.aws.latest["Environment"]["Error"] = {"Message": "sensitive diagnostic"}
        with self.assertRaisesRegex(RuntimeError, "not ready") as caught:
            handler.handler(self.event, None)
        self.assertNotIn("sensitive", str(caught.exception))


class ArtifactReleaseTests(unittest.TestCase):
    def setUp(self):
        self.aws = LambdaState()
        self.addCleanup(patch.stopall)
        patch.object(handler, "LAMBDA", self.aws).start()
        patch.object(handler, "EXPECTED_CONFIGURATION_HASH", None).start()

    def test_artifact_release_keeps_existing_contract_with_revision_guards(self):
        result = handler.handler(release_event(), None)
        deployment = json.loads(result["body"])["deployments"][0]
        self.assertEqual(deployment["lambda_version"], "159")
        self.assertEqual(self.aws.code_updates[0]["S3ObjectVersion"], "artifact-version")
        self.assertEqual(self.aws.code_updates[0]["S3Key"], "releases/release+1.zip")
        self.assertEqual(self.aws.publishes[0]["RevisionId"], "new-code-revision")
        self.assertEqual(self.aws.promotions[0]["RevisionId"], "alias-revision")
        self.assertEqual(self.aws.alias["FunctionVersion"], "159")

    def test_changed_code_is_not_published(self):
        self.aws.on_update = lambda: self.aws.latest.update(CodeSha256="competing-code")
        with self.assertRaisesRegex(RuntimeError, "changed the staged code"):
            handler.handler(release_event(), None)
        self.assertEqual(self.aws.publishes, [])
        self.assertEqual(self.aws.promotions, [])

    def test_concurrent_configuration_apply_prevents_promotion(self):
        self.aws.on_publish = lambda: self.aws.latest.update(RevisionId="terraform-update", MemorySize=1024)
        with self.assertRaisesRegex(RuntimeError, "changed during promotion"):
            handler.handler(release_event(), None)
        self.assertEqual(self.aws.promotions, [])

    def test_filtered_events_do_not_deploy(self):
        event = release_event()
        event["Records"][0]["s3"]["object"]["key"] = "not-a-release.zip"
        event["Records"].append({"eventSource": "aws:sqs"})
        self.assertEqual(json.loads(handler.handler(event, None)["body"])["deployments"], [])
        self.assertEqual(self.aws.code_updates, [])

    def test_unknown_operations_fail(self):
        with self.assertRaisesRegex(RuntimeError, "Unsupported"):
            handler.handler({"operation": "incorrect"}, None)


class PackageReadinessTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(handler, "EXPECTED_CONFIGURATION_HASH", "configured").start()
        patch.object(handler, "LAMBDA", LambdaState()).start()

    def package(self, supported):
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w") as archive:
            archive.writestr("halospawns_api/aws/asset_delivery.py" if supported else "app.py", "")
        content.seek(0)
        return content

    def test_cdn_modes_require_the_delivery_resolver(self):
        for mode in ("cloudfront", "cloudfront_signed"):
            with self.subTest(mode=mode), patch.object(handler, "urlopen", return_value=self.package(False)):
                with self.assertRaisesRegex(RuntimeError, "compatible API artifact"):
                    handler._assert_asset_package_support(configuration(mode=mode))

    def test_compatible_package_is_accepted(self):
        with patch.object(handler, "urlopen", return_value=self.package(True)):
            handler._assert_asset_package_support(configuration(mode="cloudfront_signed"))

    def test_s3_mode_does_not_download_the_package(self):
        with patch.object(handler, "urlopen") as download:
            handler._assert_asset_package_support(configuration())
            download.assert_not_called()

    def test_download_failures_do_not_expose_package_url(self):
        with patch.object(handler, "urlopen", side_effect=RuntimeError("secret-url")):
            with self.assertRaisesRegex(RuntimeError, "Cannot inspect") as caught:
                handler._assert_asset_package_support(configuration(mode="cloudfront"))
        self.assertNotIn("secret-url", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
