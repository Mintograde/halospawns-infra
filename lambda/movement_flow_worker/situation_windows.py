"""Map-specific pre-spawn presence and recorded paths, on the host game clock."""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import struct
from urllib.error import HTTPError
from urllib.request import urlopen

from halo_map.reader import MapManager
import movement_paths

BUNDLE = "halospawns.situationGame.v1"
PRESENCE = "halospawns.situationPresence.v1"
_map_pads = {}


def power_item_code(manager, item):
    if item.primary_class == 0x65716970:  # eqip, equipment type after the object/item block
        offset = manager.pointer_to_offset(item.tag_data_pointer) + 0x308
        kind, = struct.unpack_from("<h", manager.data, offset)
        return {3: 1, 2: 2}.get(kind, 0)
    if item.primary_class != 0x77656170 or "rocket launcher" not in (
        item.path.lower().replace("_", " ")
    ):
        return 0
    # The HEK weapon block ends with the magazine and trigger reflexives.
    # A magazine's initial round count includes its loaded rounds. Temple
    # also places an empty launcher on a 15-minute equipment timer.
    offset = manager.pointer_to_offset(item.tag_data_pointer)
    count, pointer = struct.unpack_from("<II", manager.data, offset + 0x4F0)
    if count > 2:
        raise ValueError("Invalid weapon magazine count")
    if not count:
        return 0
    magazines = manager.pointer_to_offset(pointer)
    for i in range(count):
        initial, = struct.unpack_from("<h", manager.data, magazines + 112 * i + 6)
        if initial > 0:
            return 4
    return 0


def equipment_pads(data):
    manager = MapManager(data)
    pads = []
    for pad in manager.get_scenario().data.netgame_equipment:
        header = manager.resolve_dependency(pad.item_collection)
        if not header:
            continue
        collection = manager.read_tag(header).data
        tags = {}
        for draw in collection.permutations:
            item = manager.resolve_dependency(draw.item)
            if not item or draw.weight <= 0:
                continue
            tags[item.path] = power_item_code(manager, item)
        if any(tags.values()):
            pads.append({"position": [pad.position.x, pad.position.y, pad.position.z],
                         "types": pad.spawn_types, "tags": tags,
                         "period": pad.spawn_time or collection.default_spawn_time or 30})
    return pads


def map_config(job, stride):
    source = job.get("map_source")
    pads = None
    if source:
        digest = source["sha256"]
        if digest not in _map_pads:
            size = source["size_bytes"]
            if not 0 < size <= 512 << 20:
                raise ValueError("Invalid approved map size")
            try:
                with urlopen(source["url"], timeout=40) as response:
                    if int(response.headers["Content-Length"]) != size:
                        raise ValueError("Approved map size mismatch")
                    data = response.read(size + 1)
            except HTTPError as exc:
                raise ValueError(f"Approved map read returned HTTP {exc.code}") from None
            if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
                raise ValueError("Approved map hash mismatch")
            if len(_map_pads) >= 128:
                _map_pads.clear()
            _map_pads[digest] = equipment_pads(data)
        pads = _map_pads[digest]
        override = job.get("item_period")
        if isinstance(override, int) and override > 0:
            pads = [dict(p, period=min(override, 180)) for p in pads]
    return {"pads": pads, "births": job.get("births"), "stride": stride}


def game_product(document, source_hash, publish):
    info = {"events": document["events"], "uncertain_cycles": document["uncertain_cycles"],
            "partial": document["partial"]}
    rows = [info]
    for key, layers in document["products"].items():
        for slot, presence in layers["presence"].items():
            routes = layers["paths"].get(slot, [])
            paths = movement_paths.slot_rows(routes, f"{source_hash}/{key}/{slot}")
            rows.append([key, int(slot), presence, paths])
    return {"games": 1, "observed": 1, "groups": {"bundle": publish(rows, BUNDLE)},
            "situations": {}, "uncertain_cycles": info["uncertain_cycles"],
            "partial_games": int(info["partial"])}


class Selection:
    def __init__(self):
        self.windows = self.games = 0
        self.cells = defaultdict(int)
        self.routes = {}

    def merge(self, cells, paths):
        for x, y, z, ticks in cells:
            self.cells[x, y, z] += ticks
        movement_paths.merge(self.routes, paths)

    def publish(self, publish):
        cells = [[*pos, value] for pos, value in sorted(self.cells.items())]
        return {"windows": self.windows, "games": self.games, "ticks": sum(self.cells.values()),
                "presence": publish(cells, PRESENCE) if cells else None,
                "paths": publish(movement_paths.compact(self.routes), movement_paths.SCHEMA)
                if self.routes else None}


def merge_game(groups, game, rows):
    audiences = defaultdict(int)
    for slot, team in game["slots"]:
        audiences["all"] |= 1 << slot
        if team in (0, 1):
            audiences[f"team:{team}"] |= 1 << slot
            if game["winner"] is not None:
                audiences["winning" if team == game["winner"] else "losing"] |= 1 << slot
    hit = set()
    for _tick, condition, subjects in rows[0]["events"]:
        for name, slots in audiences.items():
            if slots & subjects:
                key = (condition, name)
                groups[key].windows += 1
                hit.add(key)
    for key in hit:
        groups[key].games += 1
    for condition, slot, presence, paths in rows[1:]:
        for name, slots in audiences.items():
            if slots & (1 << slot):
                groups[condition, name].merge(presence, paths)


def scope_product(lease, command, read_field, publish):
    groups = defaultdict(Selection)
    games = observed = uncertain = partial = 0
    after = None
    with ThreadPoolExecutor(max_workers=4) as pool:
        while True:
            page = command("inputs", lease=lease, representation="situations", after=after)
            if page.get("superseded"):
                return None
            if page.get("waiting"):
                command("retry", lease=lease, reason="waiting_for_source")
                return None
            games += len(page["games"])
            inputs = [game for game in page["games"] if game["bundle"]]
            observed += len(inputs)
            for game, rows in zip(inputs, pool.map(lambda g: read_field(g["bundle"], BUNDLE), inputs),
                                  strict=True):
                merge_game(groups, game, rows)
                uncertain += rows[0]["uncertain_cycles"]
                partial += int(rows[0]["partial"])
            after = page["next"]
            if after is None:
                break
    selections = defaultdict(dict)
    for (key, audience), group in groups.items():
        selections[key][audience] = group.publish(publish)
    return {"games": games, "observed": observed, "groups": {}, "situations": selections,
            "uncertain_cycles": uncertain, "partial_games": partial + games - observed}
