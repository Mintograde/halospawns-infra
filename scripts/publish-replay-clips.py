"""Publish the dev replay clip extractor with the same delta codec as the viewer."""
from node_worker_release import ROOT, package, publish


if __name__ == "__main__":
    publish("halospawns-dev-replay-clips", package(ROOT / "lambda/replay_clips", ["cut.mjs"]))
