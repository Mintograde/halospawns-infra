import copy
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from h1_film import cloud, world_pool as pool


class WorldPoolTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.work = Path(tmp.name)
        self.event = {
            "job": {"upload_id": "upload", "generation_token": "generation",
                    "conversion": {"film": {"format": 3, "source_tick_count": 65536, "hash_sample_count": 512}}},
            "index": 0, "nonce": "1" * 32, "image_digest": "sha256:" + "2" * 64,
        }
        self.s3 = Mock()
        self.objects = {}
        self.s3.put_object.side_effect = self.put
        self.s3.get_object.side_effect = self.get
        env = patch.dict(os.environ, {"H1_WORLD_BUCKET": "scratch", "H1_WORLD_FUNCTION": "worker:1"})
        env.start()
        self.addCleanup(env.stop)

    def put(self, *, Bucket, Key, Body, IfNoneMatch, **kwargs):
        self.assertEqual((Bucket, IfNoneMatch), ("scratch", "*"))
        self.assertNotIn(Key, self.objects)
        self.objects[Key] = Body.read()
        return {"VersionId": "exact-version"}

    def get(self, *, Bucket, Key, VersionId):
        self.assertEqual((Bucket, VersionId), ("scratch", "exact-version"))
        body = self.objects[Key]
        return {"Body": io.BytesIO(body), "ContentLength": len(body), "VersionId": VersionId}

    def publish(self):
        result = self.work / "result"
        files = {"track.json": b"{}", "client-0.h1film": b"restored", "client-0.partial/sniper-prefix.json": b"proof",
                 "client-0-recovered/candidate/replay.source.hsrdc": b"world", "client-0.partial/verified-sniper.ndjson": b""}
        for name, body in files.items():
            path = result / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
        return files, pool.publish(self.event, self.work, self.s3)

    def test_versioned_fragment_round_trip_including_recovery_and_empty_evidence(self):
        files, receipt = self.publish()
        dest = self.work / "received"
        pool.receive(self.event, receipt, dest, self.s3)
        self.assertEqual({str(p.relative_to(dest).as_posix()): p.read_bytes()
                          for p in dest.rglob("*") if p.is_file()}, files)

    def test_full_clients_can_reuse_the_original_film_bytes_at_the_parent(self):
        result = self.work / "result"
        result.mkdir()
        (result / "track.json").write_text("{}")
        receipt = pool.publish(self.event, self.work, self.s3)
        self.assertEqual(receipt["files"], [("track.json", 2)])
        dest = self.work / "received"
        pool.receive(self.event, receipt, dest, self.s3)
        self.assertEqual([p.name for p in dest.iterdir()], ["track.json"])

    def test_rejects_other_generation_image_part_and_truncated_or_changed_body(self):
        _, receipt = self.publish()
        dest = self.work / "received"
        for field, change in (("index", 1), ("image_digest", "other"), ("nonce", "3" * 32)):
            with self.assertRaises(cloud.FilmError):
                pool.receive({**self.event, field: change}, receipt, dest, self.s3)
        old = copy.deepcopy(self.event)
        old["job"]["generation_token"] = "other"
        with self.assertRaises(cloud.FilmError):
            pool.receive(old, receipt, dest, self.s3)
        self.s3.get_object.assert_not_called()
        key = pool.fragment_key(self.event)
        original = self.objects[key]
        for i, body in enumerate((original[:-1], b"x" + original[1:])):
            self.objects[key] = body
            with self.assertRaises(cloud.FilmError):
                pool.receive(self.event, receipt, self.work / str(i), self.s3)

    def test_bounded_members_and_no_duplicate_or_other_client_paths(self):
        _, receipt = self.publish()
        for extra in (["track.json", 0], ["client-1.h1film", 1], ["../output", 1],
                      ["client-0/playback.log", 9 * pool.MIB], ["bad", -1]):
            with self.assertRaises(cloud.FilmError):
                pool.receive(self.event, {**receipt, "files": receipt["files"] + [extra]}, self.work / "bad", self.s3)
        self.s3.get_object.assert_not_called()

    def test_empty_label_dispatch_requires_the_complete_host_simulation(self):
        proof = {"played_ticks": 65536, "hash_checks": 512, "hash_mismatches": 0, "seed_mismatches": 0}
        pool.validate_dispatch(0, proof, self.event["job"])
        pool.validate_dispatch(0, None, self.event["job"])
        for invalid in ({"played_ticks": 65535}, {"hash_checks": 0}, {"hash_checks": 511},
                        {"hash_mismatches": 1}, {"seed_mismatches": 1}):
            with self.assertRaises(cloud.FilmError):
                pool.validate_dispatch(0, {**proof, **invalid}, self.event["job"])

    def test_expired_fragment_is_rejected_before_upload(self):
        self.event["expires"] = 1
        with self.assertRaises(cloud.FilmError):
            self.publish()
        self.s3.put_object.assert_not_called()

    def test_redelivery_and_short_films_use_the_parent(self):
        job = self.event["job"]
        film = self.work / "test.h1film"
        header = bytearray(536)
        header[64:68] = (536).to_bytes(4, "little")
        header[524:528] = (3).to_bytes(4, "little")
        film.write_bytes(header)
        with pool.delivery({"attributes": {"ApproximateReceiveCount": "2"}}):
            with pool.world_pool(job, film, self.work, 1000) as args:
                self.assertEqual(args, [])
        job["conversion"]["film"]["source_tick_count"] = 1200
        with pool.world_pool(job, film, self.work, 1000) as args:
            self.assertEqual(args, [])
        self.assertFalse((self.work / "world-pool").exists())
