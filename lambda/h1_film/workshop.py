"""Optional Beta 8 provenance discovery, independent of frozen conversion identities."""
import re
import struct


def read_source(path):
    with path.open("rb") as stream:
        head = stream.read(504)
        if len(head) != 504:
            return None
        u = lambda offset: struct.unpack_from("<I",head,offset)[0]
        if u(0) != 0x314D4C46 or u(4) != 3 or not u(28) & 128:
            return None
        header, options = u(64), u(72)
        if header not in (504,536) or options-24 < header or options > path.stat().st_size:
            return None
        stream.seek(options-24)
        block = stream.read(24)
        if len(block) != 24:
            return None
        magic, version, size, app, item = struct.unpack("<IIIIQ",block)
        if (magic,version,size,app) != (0x3150414D,1,24,976730) or not item:
            return None
        scenario = head[128:256].split(b"\0",1)[0].decode("ascii",errors="replace")
        scenario = scenario.replace("\\","/").split("/")[-1].lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,159}",scenario):
            return None
        return {"app_id": app,"item_id": str(item),"scenario": scenario,"size_bytes": u(60)}


def discover(path, source, upload_id, api):
    locator = read_source(path)
    if locator is None:
        return False, False
    result = api("POST","/v1/ingest/workshop/observe",{
        **locator,"source": source,"upload_id": upload_id})["data"]
    ready = any(m.get("map_id") and m.get("scenario") == locator["scenario"] and (
        not locator["size_bytes"] or m["size_bytes"] == locator["size_bytes"]
    ) for m in result["maps"])
    return True, not ready
