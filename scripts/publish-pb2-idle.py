"""Publish the dev PB2 audit reader."""
from node_worker_release import ROOT, package as package_worker, publish


def package():
    return package_worker(ROOT / "lambda/pb2_idle_worker", ["audit.mjs", "profiles.mjs"])


if __name__ == "__main__":
    publish("halospawns-dev-pb2-idle", package())
