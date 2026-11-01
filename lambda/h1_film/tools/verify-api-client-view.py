"""Validate archived real client callbacks against the exact deployed API service."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from halospawns_api.schemas import h1film_client_views as models
from halospawns_api.services import h1film_client_views as service
from halospawns_api.errors import ConflictError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", required=True, type=Path)
    parser.add_argument("--catalog", required=True, type=Path)
    args = parser.parse_args()
    root = args.case
    values = {k: json.loads((root / f"{k}.json").read_text()) for k in ("context", "prepare", "job", "completion")}
    job, context = values["job"], values["context"]
    data = json.loads(args.catalog.read_text())
    manifest = next(m for m in data["manifests"] if m["release_id"] == job["identity"]["release"]["release_id"])
    data["policy"] = {"release_id": manifest["release_id"], "revision": job["identity"]["release"]["policy_revision"],
                      "worker_image_digest": manifest["image_digest"]}
    for name in ("Identity", "Prepare", "Completion", "Timeline"):
        snapshot = json.loads((Path(__file__).resolve().parents[1] / "contracts" / f"h1film-client-view-{name.lower()}.v1.schema.json").read_text())
        assert snapshot == getattr(models, f"ClientView{name}").model_json_schema()
    upload = {"id": context["upload_id"], "host_artifact_id": job["identity"]["host_artifact_id"],
        "source": None, "request": {k: context["source"][k] for k in ("sha256", "size_bytes")},
        **{k: context["source"][k] for k in ("s3_bucket", "s3_key")}}

    class Repository:
        def prepare(self, request, build):
            prepared, track = build(None, upload, context["host"], context["clock_host"])
            assert prepared == job
            assert track["source_film_sha256"] == context["host"]["identity"]["source"]["sha256"]
            return prepared

        def complete(self, request, validate):
            validate(None, upload, {"job": job})
            return request.model_dump(mode="json")

    objects = {job["identity"]["source"]["s3_key"]: (job["identity"]["source"], root / "client.h1film")}
    for key in ("artifact", "timeline"):
        objects[values["completion"][key]["s3_key"]] = (values["completion"][key], root / key)

    class Reader:
        def versioned_object_bytes(self, *, bucket, key, version_id, max_bytes):
            descriptor, path = objects[key]
            assert bucket == descriptor["s3_bucket"] and version_id == descriptor["s3_version_id"]
            data = path.read_bytes()
            assert len(data) <= max_bytes
            return data

        def object_sha256(self, *, deadline, **kwargs):
            raw = self.versioned_object_bytes(**kwargs)
            return {"sha256": hashlib.sha256(raw).hexdigest(), "size_bytes": len(raw), "s3_version_id": kwargs["version_id"]}

    instance = service.ClientViewService(repository=Repository(), reader=Reader(),
        artifact_settings_factory=lambda: SimpleNamespace(bucket=job["output"]["s3_bucket"],
            prefix=job["output"]["prefix"].split("/client-views/")[0]))
    settings = SimpleNamespace(max_size_bytes=536870912, max_source_ticks=432000, max_players=16)
    with patch.object(instance, "_processing", return_value=settings), patch.object(service, "enabled", return_value=True), \
         patch.object(service, "require_active_engine"), patch.object(service, "resolve_map", return_value=context["host"]["identity"]["map_binding"]), \
         patch.object(service, "read_catalog", return_value=data):
        instance.prepare(models.ClientViewPrepare.model_validate(values["prepare"]), None)
        assert instance.complete(models.ClientViewCompletion.model_validate(values["completion"]), None) == values["completion"]
        for kind in ("artifact", "timeline"):
            invalid = copy.deepcopy(values["completion"])
            invalid[kind]["s3_key"] = invalid[kind]["s3_key"].replace("/generations/", "/other-generation/")
            try:
                instance.complete(models.ClientViewCompletion.model_validate(invalid), None)
            except ConflictError:
                pass
            else:
                raise AssertionError("Cross-generation object accepted")
    print(json.dumps({"status": "deployed_api_client_view_verified", "frame_count": values["completion"]["frame_count"],
        "hash_checks": values["completion"]["verified_hash_count"], "schemas": 4, "prepare": True, "complete": True,
        "source_bytes": True, "world_bytes": True, "timeline_bytes": True, "cross_generation_rejected": True}))


if __name__ == "__main__":
    main()
