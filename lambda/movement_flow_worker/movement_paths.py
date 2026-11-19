"""Merge measured visits while keeping an actual timed trajectory for each neighborhood."""
import base64
import hashlib
import math
from collections import defaultdict

SCHEMA = "halospawns.movementPaths.v1"
MAX_ROUTES = 8192


def pack_geometry(values):
    encoded = bytearray()
    for value in values:
        number = (value << 1) ^ (value >> 31)
        while number >= 128:
            encoded.append((number & 127) | 128)
            number >>= 7
        encoded.append(number)
    return base64.b64encode(encoded).decode("ascii")


def samples(routes, source_slot):
    for index, route in enumerate(routes):
        # A distance-weighted reservoir. The minimum priority merges exactly
        # across slots, games and pages, independent of arrival order.
        digest = hashlib.blake2b(f"{source_slot}/{index}".encode(), digest_size=6).digest()
        uniform = (1 + int.from_bytes(digest, "big")) / ((1 << 48) + 1)
        priority = round(-math.log(uniform) * (1 << 40) / route["distance"])
        yield [*route["key"], 1, route["ticks"], route["distance"], priority,
               route["lead"], pack_geometry(route["geometry"])]


def combine(target, source):
    target[6] += source[6]
    target[7] += source[7]
    target[8] += source[8]
    if source[9:] < target[9:]:
        target[:6] = source[:6]
        target[9:] = source[9:]


def merge(cells, rows):
    for row in rows:
        if len(row) != 12:
            raise ValueError("Invalid movement path row")
        key = tuple(row[:6])
        if key in cells:
            combine(cells[key], row)
        else:
            cells[key] = list(row)


def compact(cells, limit=MAX_ROUTES):
    rows = list(cells.values())
    level = 0
    while len(rows) > limit:
        level += 1
        regions = defaultdict(list)
        for row in rows:
            x, y, z, incoming, outgoing, span = row[:6]
            # Keep reciprocal flows and vertical motion distinct. Preserve the
            # fine height bands for the first two levels of horizontal pooling.
            def sector(heading):
                return heading // 2 if level >= 3 and heading < 16 else heading
            key = (x >> level, y >> max(0, level-2), z >> level,
                   sector(incoming), sector(outgoing), span)
            regions[key].append(row)
        if level > 32:
            raise ValueError("Path selection exceeds spatial diversity limit")
        excess = len(rows) - limit
        result = []
        for key, region in sorted(regions.items(), key=lambda pair: (-len(pair[1]), pair[0])):
            if excess > 0 and len(region) > 1:
                # Keep as many independent representatives as the budget allows.
                region.sort(key=lambda row: (row[9], row[:6]))
                count = min(excess+1, len(region))
                representative = list(region[0])
                for row in region[1:count]:
                    combine(representative, row)
                result.append(representative)
                result.extend(region[count:])
                excess -= count-1
            else:
                result.extend(region)
        rows = result
    return sorted(rows, key=lambda row: row[:6])


def slot_rows(routes, source_slot):
    cells = {}
    merge(cells, samples(routes, source_slot))
    return compact(cells)
