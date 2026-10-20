"""Exercise the deployed worker against real films with local, versioned S3/API fakes.

Run in the release container with --network none; this never calls AWS or the API.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import logging
import os
import shutil
import time
import traceback
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from botocore.exceptions import ClientError
from h1_film import cloud, worker
from h1_film.registry import load_registry, select_exporter
from replay_parser import viewer_delta


class LocalS3:
    def __init__(self, output):
        self.output = output
        self.objects = {}

    def add(self, source, path, content_type):
        self.objects[source["s3_key"]] = {
            "path": path,
            "VersionId": source["s3_version_id"],
            "ContentType": content_type,
            "Metadata": {},
        }

    def head_object(self, *, Bucket, Key, VersionId=None):
        assert Bucket == "contract-fixture-bucket"
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "HeadObject")
        item = self.objects[Key]
        assert VersionId is None or VersionId == item["VersionId"]
        return {
            **{k: v for k, v in item.items() if k != "path"},
            "ContentLength": item["path"].stat().st_size,
        }

    def get_object(self, **kwargs):
        return {
            **self.head_object(**kwargs),
            "Body": self.objects[kwargs["Key"]]["path"].open("rb"),
        }

    def list_objects_v2(self, *, Bucket, Prefix, MaxKeys):
        assert Bucket == "contract-fixture-bucket"
        return {
            "Contents": [
                {"Key": k} for k in sorted(self.objects) if k.startswith(Prefix)
            ][:MaxKeys]
        }

    def put_object(
        self,
        *,
        Bucket,
        Key,
        Body,
        ContentType,
        Metadata=None,
        IfNoneMatch=None,
        **kwargs,
    ):
        assert Bucket == "contract-fixture-bucket"
        assert Key.startswith(("replays/derived/", "films/derived/"))
        if IfNoneMatch == "*" and Key in self.objects:
            raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        path = self.output / "objects" / Key
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as target:
            if hasattr(Body, "read"):
                shutil.copyfileobj(Body, target)
            else:
                target.write(Body.encode() if isinstance(Body, str) else Body)
        self.objects[Key] = {
            "path": path,
            "ContentType": ContentType,
            "Metadata": Metadata or {},
            "VersionId": "local-derived-v1",
        }
        return {"VersionId": "local-derived-v1"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--film", required=True, type=Path)
    parser.add_argument("--map", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--analytics-revision", type=int, choices=(1, 2, 3, 4), default=3)
    parser.add_argument("--exporter-revision", type=int, default=1)
    parser.add_argument("--viewer-revision", type=int, choices=(1, 2, 3, 4), default=4)
    state_mode = parser.add_mutually_exclusive_group()
    state_mode.add_argument("--generic-state", action="store_true")
    state_mode.add_argument("--verify-incremental-state", action="store_true")
    parser.add_argument("--generic-poses", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    logging.basicConfig(level=logging.INFO)
    os.environ.update(
        {
            "ENVIRONMENT": "dev",
            "H1_WORKER_MODE": "intake",
            "H1_UPLOADS_BUCKET": "contract-fixture-bucket",
            "H1_QUEUE_ARN": "arn:aws:sqs:us-east-1:283279960672:films-processing-queue",
            "H1_TOPIC_ARN": "arn:aws:sns:us-east-1:283279960672:films-uploaded",
            "H1_MAX_SIZE_BYTES": "536870912",
            "H1_MAX_SOURCE_TICKS": "432000",
            "H1_MAX_PLAYERS": "4",
            "APP_API_BASE_URL": "https://api.dev.halospawns.com",
            "APP_API_TRUSTED_CLIENT_NAME": "h1-film",
            "APP_API_TRUSTED_CLIENT_HMAC_PARAMETER_NAME": "/offline/not-read",
            "REPLAY_EXTRACTOR_MODE": "native",
        }
    )
    job = json.loads(
        (cloud.PACKAGE / "tests/fixtures/api-initial-job.json").read_text()
    )["job"]
    projection_sha, manifest_sha = viewer_delta.VIEWER_CONTRACT_PINS[args.viewer_revision]
    job["viewer_artifact_target"].update(
        profile_revision=args.viewer_revision,
        projection_sha256=projection_sha,
        manifest_schema_sha256=manifest_sha,
    )
    contract = viewer_delta.load_pinned_contract(args.viewer_revision)
    job["viewer_artifact_target"].update(
        format=contract.encoding["format"], container_version=contract.encoding["container"]["version"],
        encoding_sha256=contract.encoding_sha256,
    )
    source = job["conversion"]["source"]
    source.update(
        size_bytes=args.film.stat().st_size,
        sha256=cloud.analytics.sha256_file(args.film),
    )
    binding = job["conversion"]["map_binding"]
    binding.update(scenario=args.map.stem, game_release_key="h1_beta3_local_test")
    binding["raw_source"].update(
        size_bytes=args.map.stat().st_size,
        sha256=cloud.analytics.sha256_file(args.map),
        s3_key=f"maps/unprocessed/{args.map.name}",
    )
    storage = LocalS3(args.output)
    storage.add(source, args.film, "application/octet-stream")
    storage.add(binding["raw_source"], args.map, "application/octet-stream")
    callback = []
    converted = []
    failures = []
    real_convert, real_execute = cloud.convert, cloud.execute
    real_products = cloud.build_products
    real_run_bounded = cloud.run_bounded

    def run_bounded(command, *values, **options):
        if len(command) > 1 and command[1].endswith("convert.mjs"):
            if args.generic_state:
                command = [*command, "--generic-state"]
            if args.generic_poses:
                command = [*command, "--generic-poses"]
            if args.verify_incremental_state:
                command = [*command, "--verify-incremental-state"]
        return real_run_bounded(command, *values, **options)

    def api(method, path, payload):
        assert method == "POST"
        if path == "/v1/ingest/h1films/prepare":
            assert payload["source"] == source
            assert payload["film"]["scenario"] == binding["scenario"]
            job["conversion"]["film"] = payload["film"]
            selected = select_exporter(load_registry()[payload["film"]["engine_profile"]],
                                       args.exporter_revision)
            engine = {key: selected[key] for key in (
                "format", "protocol_revision", "tick_rate", "build", "wasm_sha256", "glue_sha256"
            )}
            if args.exporter_revision != 1:
                engine["exporter_revision"] = args.exporter_revision
            job["conversion"]["engine"] = engine
            binding.update(engine_profile=selected["id"], game_release_key=f"{selected['port']}_local_test")
            job.update(schema="halospawns.h1film_job.v2", analytics_revision=args.analytics_revision)
            return {"data": {"job": copy.deepcopy(job)}}
        assert path in {
            "/v1/ingest/replay-uploads",
            "/v1/ingest/replay-viewer-artifacts",
        }
        callback.append((path, copy.deepcopy(payload)))
        return {"data": {"ok": True}}

    def convert(*values):
        try:
            directory = real_convert(*values)
        except Exception:
            work = values[2]
            for path in work.rglob("*"):
                if path.name in {
                    "convert.log",
                    "playback.log",
                    "encode.log",
                    "report.json",
                }:
                    shutil.copyfile(path, args.output / ("failure-" + path.name))
            raise
        converted.append(str(directory))
        shutil.copyfile(directory / "report.json", args.output / "report.json")
        shutil.copyfile(
            directory / "candidate/encoding.json", args.output / "encoding.json"
        )
        if args.generic_state or args.generic_poses or args.verify_incremental_state:
            encoding = json.loads((args.output / "encoding.json").read_text())
            state = encoding["state_reuse"]
            if args.generic_state:
                assert state["enabled"] is False
            if args.verify_incremental_state:
                assert state["enabled"] is True
                assert state["verified_source_ticks"] == encoding["source_ticks"]
            if args.generic_poses:
                assert state["typed_poses"] is False
                assert state["poses_decoded"] == 0
                assert state["pose_nodes_decoded"] == 0
        return directory

    def execute(*values):
        try:
            return real_execute(*values)
        except Exception:
            failures.append(traceback.format_exc())
            raise

    def products(current, film, directory, work, deadline, metadata):
        initial = real_products(current, film, directory, work, deadline, metadata)
        for mode in ("viewer_rebuild", "full_reparse"):
            name = mode.replace("_", "-")
            retry = json.loads(
                (cloud.PACKAGE / f"tests/fixtures/api-{name}-job.json").read_text()
            )
            retry = retry.get("job", retry)
            retry["conversion"] = copy.deepcopy(current["conversion"])
            retry["viewer_artifact_target"].update({
                key: value for key, value in current["viewer_artifact_target"].items()
                if key not in {"generation_token", "request_epoch", "request_sequence"}
            })
            retry.update(schema=current["schema"], analytics_revision=current["analytics_revision"])
            generation = str(uuid.uuid5(uuid.NAMESPACE_URL, source["sha256"] + mode))
            retry.update(
                attempt_id=generation,
                generation_token=generation,
                job_id=f"h1film:{current['upload_id']}:generation:{generation}",
            )
            retry["viewer_artifact_target"]["generation_token"] = generation
            extra = work / mode
            extra.mkdir()
            path, payload = real_products(
                retry, film, directory, extra, deadline, metadata
            )
            assert payload["h1film"] == initial[1]["h1film"]
            assert (
                payload["viewer_artifact"]["sha256"]
                == initial[1]["viewer_artifact"]["sha256"]
            )
            assert path == (
                "/v1/ingest/replay-viewer-artifacts"
                if mode == "viewer_rebuild"
                else "/v1/ingest/replay-uploads"
            )
            assert ("game" in payload) == (mode == "full_reparse")
            (args.output / f"{name}-completion.json").write_text(
                json.dumps(payload, indent=2)
            )
            (args.output / f"{name}-job.json").write_text(json.dumps(retry, indent=2))
        return initial

    with patch("boto3.client"):
        shared = cloud.shared_parser()
    notification = {
        "Type": "Notification",
        "TopicArn": os.environ["H1_TOPIC_ARN"],
        "Message": json.dumps(
            {
                "Records": [
                    {
                        "eventSource": "aws:s3",
                        "eventName": "ObjectCreated:Put",
                        "s3": {
                            "bucket": {"name": source["s3_bucket"]},
                            "object": {
                                "key": source["s3_key"],
                                "versionId": source["s3_version_id"],
                                "size": source["size_bytes"],
                            },
                        },
                    }
                ]
            }
        ),
    }
    record = {
        "messageId": "offline-real-film",
        "eventSource": "aws:sqs",
        "eventSourceARN": os.environ["H1_QUEUE_ARN"],
        "body": json.dumps(notification),
    }
    context = SimpleNamespace(get_remaining_time_in_millis=lambda: 900000)
    started = time.monotonic()
    with (
        patch.object(shared, "S3", storage),
        patch.object(cloud, "api", api),
        patch.object(cloud, "convert", convert),
        patch.object(cloud, "run_bounded", run_bounded),
        patch.object(cloud, "execute", execute),
        patch.object(cloud, "build_products", products),
    ):
        for run in range(2):
            response = worker.handler({"Records": [record]}, context)
            assert response == {"batchItemFailures": []}, "\n".join(failures)
        assert len(converted) == 1 and len(callback) == 2
        assert callback[0] == callback[1], "Retry changed the immutable completion"
        # A pinned job retry must bypass download, preflight and conversion.
        record["body"] = json.dumps(job)
        with patch.object(
            cloud, "download", side_effect=AssertionError("retry downloaded source")
        ):
            assert worker.handler({"Records": [record]}, context) == {
                "batchItemFailures": []
            }
        assert callback[2] == callback[0]
    payload = callback[0][1]
    assert payload["replay_file"]["sha256"] == source["sha256"]
    assert payload["replay_file"]["s3_version_id"] == source["s3_version_id"]
    assert payload["replay_file"]["content_type"] == "application/octet-stream"
    assert payload["viewer_artifact"]["playback"] == cloud.PLAYBACK
    (args.output / "finalization.json").write_text(json.dumps(payload, indent=2))
    (args.output / "job.json").write_text(json.dumps(job, indent=2))
    result = {
        "status": "offline_cloud_worker_verified",
        "aws_access": False,
        "api_access": False,
        "film_sha256": source["sha256"],
        "source_ticks": payload["h1film"]["played_tick_count"],
        "hash_checks": payload["h1film"]["hash_checks"],
        "conversions": len(converted),
        "idempotent_callbacks": len(callback),
        "total_seconds": round(time.monotonic() - started, 3),
        "product_modes": ["initial", "viewer_rebuild", "full_reparse"],
        "viewer_bytes": payload["viewer_artifact"]["size_bytes"],
        "exporter_revision": args.exporter_revision,
        "viewer_revision": args.viewer_revision,
        "output_sha256": hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest(),
    }
    (args.output / "verification.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
