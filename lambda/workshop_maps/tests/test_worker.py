import importlib
import io
import json
import struct
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

w = importlib.import_module("lambda.workshop_maps.worker")
film = importlib.import_module("lambda.h1_film.workshop")


def map_file(root, name="halo1/maps/test.map", payload=b"a"):
    path = root / name
    path.parent.mkdir(parents=True,exist_ok=True)
    head = bytearray(2048)
    head[:4] = b"daeh"
    struct.pack_into("<I",head,4,13)
    head[32:36] = b"test"
    struct.pack_into("<H",head,96,1)
    path.write_bytes(head+payload)
    return path


class WorkerTests(unittest.TestCase):
    def test_metadata_identity_and_bounds(self):
        good = {"publishedfileid": "123","result": 1,"consumer_app_id": w.APP,
                "file_type": 0,"time_updated": 10,"file_size": "2049"}
        for update in [{},{"consumer_app_id": 1},{"publishedfileid": "124"},
                       {"result": 9},{"file_type": 2},{"file_size": str(w.MAX_PACKAGE+1)}]:
            with patch.object(w,"http_json",return_value={"response": {
                "publishedfiledetails": [{**good,**update}]}}):
                if update:
                    with self.assertRaises(w.WorkshopError):
                        w.metadata("123")
                else:
                    self.assertEqual(w.metadata("123"),good)

    def test_daily_refresh_and_timestamp_regression(self):
        now = datetime.now(UTC)
        job = {"time_updated": 10,"last_downloaded_at": now.isoformat()}
        self.assertFalse(w.needs_download(job,{"time_updated": 10},now))
        self.assertTrue(w.needs_download(job,{"time_updated": 9},now))
        self.assertTrue(w.needs_download(job,{"time_updated": 10},now+timedelta(days=1)))

    def test_candidates_are_content_identified_not_filename_identified(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            map_file(root,"halo1/maps/1.map")
            map_file(root,"halo1/maps/2.map")
            (root/"halo3.map").write_bytes(b"unknown")
            maps = w.package_maps(root)
            self.assertEqual(len(maps),2)
            self.assertEqual(maps[0]["scenario"],"test")
            self.assertEqual(maps[0]["sha256"],maps[1]["sha256"])
            map_file(root,"halo1/maps/2.map",b"b")
            self.assertNotEqual(w.package_maps(root)[0]["sha256"],w.package_maps(root)[1]["sha256"])

    def test_update_during_download_cannot_publish(self):
        job = {"app_id": w.APP,"item_id": "123","lease_id": "lease"}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            map_file(root)
            s3 = Mock()
            receipt = w.process(job,s3=s3,bucket="bucket",deadline=100,
                download=lambda *args: root,fetch=Mock(side_effect=[{"time_updated": 1},
                                                                  {"time_updated": 2}]))
            self.assertEqual(receipt["error"],"revision_changed")
            s3.put_object.assert_not_called()

    def test_download_then_snapshot_and_auth_failure(self):
        job = {"app_id": w.APP,"item_id": "123","lease_id": "lease"}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            map_file(root)
            s3 = Mock()
            s3.put_object.return_value = {"VersionId": "version"}
            receipt = w.process(job,s3=s3,bucket="bucket",deadline=100,
                download=lambda *args: root,fetch=lambda *args: {"time_updated": 1})
            self.assertEqual(receipt["maps"][0]["source"]["s3_version_id"],"version")
            self.assertEqual(s3.put_object.call_args.kwargs["IfNoneMatch"],"*")
            failed = w.process(job,s3=s3,bucket="bucket",deadline=100,
                download=Mock(side_effect=w.WorkshopError("authentication_required","auth_required")),
                fetch=lambda *args: {"time_updated": 1})
            self.assertEqual(failed["state"],"auth_required")
            self.assertNotIn("maps",failed)

    def test_film_provenance_uses_map_size_and_rebased_offsets(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"film"
            for header in (504,536):
                data = bytearray(header+24)
                for at,value in [(0,0x314d4c46),(4,3),(28,128),(60,123456),
                                 (64,header),(72,header+24)]:
                    struct.pack_into("<I",data,at,value)
                data[128:132] = b"test"
                struct.pack_into("<IIIIQ",data,header,0x3150414d,1,24,w.APP,2**64-1)
                path.write_bytes(data)
                self.assertEqual(film.read_source(path), {"app_id": w.APP,
                    "item_id": str(2**64-1),"scenario": "test","size_bytes": 123456})
                path.write_bytes(data[:-1])
                self.assertIsNone(film.read_source(path))

    def test_http_response_is_bounded(self):
        response = io.BytesIO(b"x"*(1024**2+1))
        opener = Mock()
        opener.open.return_value = response
        with patch.object(w.urllib.request,"build_opener",return_value=opener):
            with self.assertRaises(w.WorkshopError):
                w.http_json("url")

    def test_hmac_matches_api_canonical_contract(self):
        with patch.dict(w.os.environ,{"APP_API_BASE_URL": "https://api.dev.halospawns.com"}), \
             patch.object(w,"http_json",return_value={"data": {}}) as send, \
             patch.object(w.time,"time",return_value=123):
            w.api("/v1/ingest/workshop/claim",{},"secret")
            request = send.call_args.args[0]
            expected = "\n".join(["HALOSPAWNS-HMAC-SHA256","workshop-maps","123","POST",
                "/v1/ingest/workshop/claim","",w.hashlib.sha256(b"{}").hexdigest()])
            self.assertEqual(request.get_header("X-halospawns-signature"),
                w.hmac.new(b"secret",expected.encode(),w.hashlib.sha256).hexdigest())


if __name__ == "__main__":
    unittest.main()
