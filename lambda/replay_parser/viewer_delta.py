from __future__ import annotations

import hashlib
import json
import math
import struct
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import ijson
import zstandard


VIEWER_SCHEMA = "halospawns.viewerReplay.v1"
VIEWER_PROFILE = "frontend-default"
VIEWER_PROFILE_REVISION = 1
VIEWER_PROJECTION_SHA256 = "573da0d397c796d686354b7269094409984304961f8c55ab03bb2e46180d21ec"
VIEWER_ARTIFACT_KIND = "viewer_replay_delta"
VIEWER_DELTA_FORMAT = "halospawns.viewerReplayDelta.v1"
VIEWER_CONTAINER_VERSION = 1
VIEWER_MANIFEST_SCHEMA_SHA256 = "bdb2d119b7a44f59aad813d53de244acb504c811858d0b44f63e2e81242af5d1"
VIEWER_ENCODING_SHA256 = "674d32449c4c9a116fe0da1ee7ca5d7a46367f4f8cdeceee5c8c817bdbc833cb"
VIEWER_MEDIA_TYPE = "application/vnd.halospawns.replay-delta"
VIEWER_OUTER_COMPRESSION = "identity"
VIEWER_KEYFRAME_INTERVAL = 2048
VIEWER_MAX_TICKS = 432_000
VIEWER_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024
VIEWER_MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
VIEWER_MAX_JSON_DEPTH = 32
VIEWER_MAX_STRING_CHARACTERS = 64 * 1024 * 1024
VIEWER_CONTAINER_HEADER_BYTES = 32
VIEWER_CONTAINER_MAGIC = b"HSRDC001"
VIEWER_CHUNK_MAGIC = b"HSRD"
VIEWER_PARTS_SCHEMA = "halospawns.viewerReplayDeltaParts.v1"
SAFE_INTEGER_MAX = (1 << 53) - 1

VALUE_NULL = 0
VALUE_FALSE = 1
VALUE_TRUE = 2
VALUE_INTEGER = 3
VALUE_FLOAT32 = 4
VALUE_FLOAT64 = 5
VALUE_STRING = 6
VALUE_ARRAY = 7
VALUE_OBJECT = 8

DELTA_SAME = 0
DELTA_REPLACE = 1
DELTA_OBJECT = 2
DELTA_ARRAY = 3
DELTA_NUMBER_XOR = 4
DELTA_FLOAT32_XOR = 5
DELTA_INTEGER_DIFFERENCE = 6
DELTA_DENSE_ARRAY = 7
DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY = 8
DELTA_FLOAT32_DIFFERENCE = 9
DELTA_DENSE_FLOAT32_XOR_ARRAY = 10
DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY = 11
DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY = 12
DELTA_FLOAT32_BIT_PREDICTION = 13
DELTA_FLOAT32_VALUE_PREDICTION = 14
DELTA_DENSE_FLOAT32_BITPACKED_ARRAY = 15

FLOAT32_MODE_XOR = 0
FLOAT32_MODE_DIFFERENCE = 1
FLOAT32_MODE_BIT_PREDICTION = 2
FLOAT32_MODE_VALUE_PREDICTION = 3

_SKIP = object()


class ViewerDeltaError(ValueError):
    """The source, pinned contract, or encoded artifact is invalid."""


@dataclass(frozen=True)
class PinnedViewerContract:
    projection: dict[str, Any]
    schema: dict[str, Any]
    encoding: dict[str, Any]
    manifest_schema: dict[str, Any]

    @property
    def source_contract(self) -> dict[str, Any]:
        return {
            "schema": VIEWER_SCHEMA,
            "profile": VIEWER_PROFILE,
            "profile_revision": VIEWER_PROFILE_REVISION,
            "projection_sha256": VIEWER_PROJECTION_SHA256,
        }


@dataclass(frozen=True)
class ViewerChunkPart:
    index: int
    first_tick: int
    tick_count: int
    raw_path: Path
    raw_bytes: int


@dataclass(frozen=True)
class ViewerParts:
    directory: Path
    tick_count: int
    replay: dict[str, Any]
    chunks: tuple[ViewerChunkPart, ...]
    producer: str
    projection_duration_ms: int
    encode_duration_ms: int


@dataclass(frozen=True)
class ViewerContainer:
    path: Path
    sha256: str
    size_bytes: int
    uncompressed_size_bytes: int
    tick_count: int
    chunk_count: int
    manifest: dict[str, Any]
    metrics: dict[str, int | float]


def canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ViewerDeltaError("Contract JSON is not canonicalizable") from error


def _load_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ViewerDeltaError(f"Unable to load contract resource {path.name}") from error
    if not isinstance(value, dict):
        raise ViewerDeltaError(f"Contract resource {path.name} must contain an object")
    return value


def load_pinned_contract() -> PinnedViewerContract:
    directory = Path(__file__).resolve().parent / "contracts" / "replays"
    registry = _load_json_object(directory / "supported-contracts.json")
    projection = _load_json_object(directory / "frontend-default.v1.projection.json")
    schema = _load_json_object(directory / "halospawns.viewerReplay.v1.schema.json")
    encoding = _load_json_object(directory / "viewer-delta.v1.encoding.json")
    manifest_schema = _load_json_object(
        directory / "halospawns.viewerReplayDelta.v1.manifest.schema.json"
    )

    projection_hash = hashlib.sha256(canonical_json_bytes(projection)).hexdigest()
    encoding_hash = hashlib.sha256(canonical_json_bytes(encoding)).hexdigest()
    manifest_hash = hashlib.sha256(canonical_json_bytes(manifest_schema)).hexdigest()
    selected_contract = registry.get("selected_contract")
    selected_encoding = registry.get("selected_encoding")
    expected_contract = {
        "schema": VIEWER_SCHEMA,
        "profile": VIEWER_PROFILE,
        "profile_revision": VIEWER_PROFILE_REVISION,
        "projection_sha256": VIEWER_PROJECTION_SHA256,
    }
    expected_encoding = {
        "artifact_kind": VIEWER_ARTIFACT_KIND,
        "format": VIEWER_DELTA_FORMAT,
        "container_version": VIEWER_CONTAINER_VERSION,
        "manifest_schema_sha256": VIEWER_MANIFEST_SCHEMA_SHA256,
        "encoding_sha256": VIEWER_ENCODING_SHA256,
    }
    if selected_contract != expected_contract:
        raise ViewerDeltaError("Selected viewer replay contract is not the pinned v1 contract")
    if selected_encoding != expected_encoding:
        raise ViewerDeltaError("Selected viewer delta encoding is not the pinned v1 encoding")
    if projection_hash != VIEWER_PROJECTION_SHA256:
        raise ViewerDeltaError("Pinned viewer projection hash mismatch")
    if encoding_hash != VIEWER_ENCODING_SHA256:
        raise ViewerDeltaError("Pinned viewer delta encoding hash mismatch")
    if manifest_hash != VIEWER_MANIFEST_SCHEMA_SHA256:
        raise ViewerDeltaError("Pinned viewer manifest schema hash mismatch")
    runtime_encoding = {
        "media_type": encoding.get("media_type"),
        "outer_compression": encoding.get("outer_compression"),
        "keyframe_interval": encoding.get("keyframe_interval"),
        "container": {
            "magic_ascii": (encoding.get("container") or {}).get("magic_ascii"),
            "header_bytes": (encoding.get("container") or {}).get("header_bytes"),
            "version": (encoding.get("container") or {}).get("version"),
            "byte_order": (encoding.get("container") or {}).get("byte_order"),
            "manifest_compression": (encoding.get("container") or {}).get(
                "manifest_compression"
            ),
        },
        "chunk": {
            "magic_ascii": (encoding.get("chunk") or {}).get("magic_ascii"),
            "version": (encoding.get("chunk") or {}).get("version"),
            "byte_order": (encoding.get("chunk") or {}).get("byte_order"),
            "compression": (encoding.get("chunk") or {}).get("compression"),
            "value_tags": (encoding.get("chunk") or {}).get("value_tags"),
            "delta_tags": (encoding.get("chunk") or {}).get("delta_tags"),
            "float32_modes": (encoding.get("chunk") or {}).get("float32_modes"),
        },
    }
    expected_runtime_encoding = {
        "media_type": VIEWER_MEDIA_TYPE,
        "outer_compression": VIEWER_OUTER_COMPRESSION,
        "keyframe_interval": VIEWER_KEYFRAME_INTERVAL,
        "container": {
            "magic_ascii": VIEWER_CONTAINER_MAGIC.decode("ascii"),
            "header_bytes": VIEWER_CONTAINER_HEADER_BYTES,
            "version": VIEWER_CONTAINER_VERSION,
            "byte_order": "little_endian",
            "manifest_compression": {
                "code": 1,
                "name": "zstd",
                "level": 19,
                "checksum": True,
            },
        },
        "chunk": {
            "magic_ascii": VIEWER_CHUNK_MAGIC.decode("ascii"),
            "version": 1,
            "byte_order": "little_endian",
            "compression": {
                "name": "zstd",
                "level": 19,
                "checksum": True,
                "independent_frames": True,
            },
            "value_tags": {
                "null": VALUE_NULL,
                "false": VALUE_FALSE,
                "true": VALUE_TRUE,
                "integer": VALUE_INTEGER,
                "float32": VALUE_FLOAT32,
                "float64": VALUE_FLOAT64,
                "string": VALUE_STRING,
                "array": VALUE_ARRAY,
                "object": VALUE_OBJECT,
            },
            "delta_tags": {
                "same": DELTA_SAME,
                "replace": DELTA_REPLACE,
                "object": DELTA_OBJECT,
                "array": DELTA_ARRAY,
                "number_xor": DELTA_NUMBER_XOR,
                "float32_xor": DELTA_FLOAT32_XOR,
                "integer_difference": DELTA_INTEGER_DIFFERENCE,
                "dense_array": DELTA_DENSE_ARRAY,
                "dense_float32_difference_array": DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY,
                "float32_difference": DELTA_FLOAT32_DIFFERENCE,
                "dense_float32_xor_array": DELTA_DENSE_FLOAT32_XOR_ARRAY,
                "dense_float32_bit_prediction_array": DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY,
                "dense_float32_value_prediction_array": DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY,
                "float32_bit_prediction": DELTA_FLOAT32_BIT_PREDICTION,
                "float32_value_prediction": DELTA_FLOAT32_VALUE_PREDICTION,
                "dense_float32_bitpacked_array": DELTA_DENSE_FLOAT32_BITPACKED_ARRAY,
            },
            "float32_modes": {
                "xor": FLOAT32_MODE_XOR,
                "difference": FLOAT32_MODE_DIFFERENCE,
                "bit_prediction": FLOAT32_MODE_BIT_PREDICTION,
                "value_prediction": FLOAT32_MODE_VALUE_PREDICTION,
            },
        },
    }
    if runtime_encoding != expected_runtime_encoding:
        raise ViewerDeltaError("Pinned viewer encoding constants do not match runtime")
    return PinnedViewerContract(
        projection=projection,
        schema=schema,
        encoding=encoding,
        manifest_schema=manifest_schema,
    )


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_negative_zero(value: Any) -> bool:
    return isinstance(value, float) and value == 0.0 and math.copysign(1.0, value) < 0


def _same_value(left: Any, right: Any) -> bool:
    if _is_number(left) and _is_number(right):
        if math.isnan(float(left)) and math.isnan(float(right)):
            return True
        if float(left) == 0.0 and float(right) == 0.0:
            return _is_negative_zero(left) == _is_negative_zero(right)
        return float(left) == float(right)
    if isinstance(left, (list, dict)) or isinstance(right, (list, dict)):
        return left is right
    return type(left) is type(right) and left == right


def _number_to_bits(value: int | float) -> int:
    return struct.unpack("<Q", struct.pack("<d", float(value)))[0]


def _bits_to_number(value: int) -> float:
    return struct.unpack("<d", struct.pack("<Q", value & 0xFFFFFFFFFFFFFFFF))[0]


def _number_to_float32_bits(value: int | float) -> int:
    return struct.unpack("<I", struct.pack("<f", float(value)))[0]


def _float32_bits_to_number(value: int) -> float:
    return struct.unpack("<f", struct.pack("<I", value & 0xFFFFFFFF))[0]


def _is_exact_float32(value: Any) -> bool:
    if not _is_number(value) or not math.isfinite(float(value)):
        return False
    rounded = _float32_bits_to_number(_number_to_float32_bits(value))
    return _same_value(rounded, value)


def _varuint_length(value: int) -> int:
    if value < 0:
        raise ViewerDeltaError("varuint values must be non-negative")
    return max(1, (value.bit_length() + 6) // 7)


def _signed_uint32_difference(previous_bits: int, next_bits: int) -> int:
    difference = next_bits - previous_bits
    if difference > 0x7FFFFFFF:
        difference -= 0x100000000
    if difference < -0x80000000:
        difference += 0x100000000
    return difference


def _signed_float32_bit_difference(previous: Any, next_value: Any) -> int:
    return _signed_uint32_difference(
        _number_to_float32_bits(previous), _number_to_float32_bits(next_value)
    )


def _predict_float32_bits(before_previous: Any, previous: Any) -> int:
    return (
        (2 * _number_to_float32_bits(previous))
        - _number_to_float32_bits(before_previous)
    ) & 0xFFFFFFFF


def _predict_float32_value_bits(before_previous: Any, previous: Any) -> int:
    predicted = _float32_bits_to_number(
        _number_to_float32_bits((2 * float(previous)) - float(before_previous))
    )
    return _number_to_float32_bits(predicted)


def _encode_signed_difference(value: int) -> int:
    return value * 2 if value >= 0 else (-value * 2) - 1


def _decode_signed_difference(value: int) -> int:
    return value // 2 if value % 2 == 0 else -((value + 1) // 2)


class BinaryWriter:
    def __init__(self) -> None:
        self.bytes = bytearray()
        self.strings: dict[str, int] = {}

    def write_byte(self, value: int) -> None:
        if not 0 <= value <= 255:
            raise ViewerDeltaError(f"byte value is out of range: {value}")
        self.bytes.append(value)

    def write_bytes(self, value: bytes | bytearray) -> None:
        self.bytes.extend(value)

    def write_varuint(self, value: int) -> None:
        if not isinstance(value, int) or value < 0 or value > SAFE_INTEGER_MAX:
            raise ViewerDeltaError(f"Expected a non-negative safe integer, received {value}")
        remaining = value
        while remaining >= 128:
            self.write_byte((remaining % 128) + 128)
            remaining //= 128
        self.write_byte(remaining)

    def write_string(self, value: str) -> None:
        existing = self.strings.get(value)
        if existing is not None:
            self.write_varuint(existing * 2)
            return
        encoded = value.encode("utf-8")
        self.write_varuint((len(encoded) * 2) + 1)
        self.write_bytes(encoded)
        self.strings[value] = len(self.strings)

    def finish(self) -> bytes:
        return bytes(self.bytes)


class BinaryReader:
    def __init__(self, value: bytes | bytearray) -> None:
        self.bytes = memoryview(value)
        self.offset = 0
        self.strings: list[str] = []

    def read_byte(self) -> int:
        if self.offset >= len(self.bytes):
            raise ViewerDeltaError("Unexpected end of replay delta chunk")
        value = self.bytes[self.offset]
        self.offset += 1
        return int(value)

    def read_bytes(self, length: int) -> bytes:
        end = self.offset + length
        if end > len(self.bytes):
            raise ViewerDeltaError("Unexpected end of replay delta chunk")
        value = bytes(self.bytes[self.offset:end])
        self.offset = end
        return value

    def read_varuint(self) -> int:
        value = 0
        factor = 1
        for _ in range(8):
            byte = self.read_byte()
            value += (byte & 0x7F) * factor
            if byte < 128:
                if value > SAFE_INTEGER_MAX:
                    raise ViewerDeltaError("Replay delta integer exceeds the safe range")
                return value
            factor *= 128
        raise ViewerDeltaError("Replay delta integer is malformed")

    def read_string(self) -> str:
        token = self.read_varuint()
        if token % 2 == 0:
            index = token // 2
            if index >= len(self.strings):
                raise ViewerDeltaError("Replay delta string reference is malformed")
            return self.strings[index]
        length = (token - 1) // 2
        try:
            value = self.read_bytes(length).decode("utf-8")
        except UnicodeDecodeError as error:
            raise ViewerDeltaError("Replay delta string is not UTF-8") from error
        self.strings.append(value)
        return value


def _write_number(writer: BinaryWriter, value: int | float) -> None:
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ViewerDeltaError("Replay delta values must contain finite numbers")
    if (
        numeric.is_integer()
        and abs(numeric) <= SAFE_INTEGER_MAX
        and not _is_negative_zero(value)
    ):
        integer = int(numeric)
        writer.write_byte(VALUE_INTEGER)
        writer.write_byte(1 if integer < 0 else 0)
        writer.write_varuint(abs(integer))
    elif _is_exact_float32(value) and not _is_negative_zero(value):
        writer.write_byte(VALUE_FLOAT32)
        writer.write_bytes(struct.pack("<f", numeric))
    else:
        writer.write_byte(VALUE_FLOAT64)
        writer.write_bytes(struct.pack("<d", numeric))


def _write_value(writer: BinaryWriter, value: Any) -> None:
    if value is None:
        writer.write_byte(VALUE_NULL)
    elif value is False:
        writer.write_byte(VALUE_FALSE)
    elif value is True:
        writer.write_byte(VALUE_TRUE)
    elif _is_number(value):
        _write_number(writer, value)
    elif isinstance(value, str):
        writer.write_byte(VALUE_STRING)
        writer.write_string(value)
    elif isinstance(value, list):
        writer.write_byte(VALUE_ARRAY)
        writer.write_varuint(len(value))
        for item in value:
            _write_value(writer, item)
    elif isinstance(value, dict):
        writer.write_byte(VALUE_OBJECT)
        writer.write_varuint(len(value))
        for key, item in value.items():
            writer.write_string(str(key))
            _write_value(writer, item)
    else:
        raise ViewerDeltaError(f"Unsupported replay delta value type: {type(value).__name__}")


def _read_value(reader: BinaryReader) -> Any:
    tag = reader.read_byte()
    if tag == VALUE_NULL:
        return None
    if tag == VALUE_FALSE:
        return False
    if tag == VALUE_TRUE:
        return True
    if tag == VALUE_INTEGER:
        sign = reader.read_byte()
        if sign not in (0, 1):
            raise ViewerDeltaError("Replay delta integer sign is malformed")
        magnitude = reader.read_varuint()
        return -magnitude if sign else magnitude
    if tag == VALUE_FLOAT32:
        return struct.unpack("<f", reader.read_bytes(4))[0]
    if tag == VALUE_FLOAT64:
        return struct.unpack("<d", reader.read_bytes(8))[0]
    if tag == VALUE_STRING:
        return reader.read_string()
    if tag == VALUE_ARRAY:
        return [_read_value(reader) for _ in range(reader.read_varuint())]
    if tag == VALUE_OBJECT:
        output: dict[str, Any] = {}
        for _ in range(reader.read_varuint()):
            key = reader.read_string()
            output[key] = _read_value(reader)
        return output
    raise ViewerDeltaError(f"Unknown replay delta value tag {tag}")


def _float32_candidate(kind: int, mode: int, residuals: list[int]) -> dict[str, Any]:
    varint_bytes = sum(_varuint_length(value) for value in residuals)
    bit_width = max((value.bit_length() for value in residuals), default=0)
    bitpacked_bytes = 2 + math.ceil((bit_width * len(residuals)) / 8)
    if bitpacked_bytes <= varint_bytes * 0.75:
        return {
            "kind": DELTA_DENSE_FLOAT32_BITPACKED_ARRAY,
            "mode": mode,
            "bit_width": bit_width,
            "residuals": residuals,
            "bytes": bitpacked_bytes,
        }
    return {"kind": kind, "residuals": residuals, "bytes": varint_bytes}


def create_replay_delta(previous: Any, next_value: Any, before_previous: Any = _SKIP) -> Any:
    if _same_value(previous, next_value):
        return None
    if _is_number(previous) and _is_number(next_value):
        return {"kind": DELTA_NUMBER_XOR, "value": next_value}
    if isinstance(previous, list) and isinstance(next_value, list):
        if (
            len(previous) == len(next_value)
            and next_value
            and all(_is_exact_float32(value) for value in previous)
            and all(_is_exact_float32(value) for value in next_value)
        ):
            if all(_same_value(value, previous[index]) for index, value in enumerate(next_value)):
                return None
            candidates = [
                _float32_candidate(
                    DELTA_DENSE_FLOAT32_XOR_ARRAY,
                    FLOAT32_MODE_XOR,
                    [
                        _number_to_float32_bits(previous[index])
                        ^ _number_to_float32_bits(value)
                        for index, value in enumerate(next_value)
                    ],
                ),
                _float32_candidate(
                    DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY,
                    FLOAT32_MODE_DIFFERENCE,
                    [
                        _encode_signed_difference(
                            _signed_float32_bit_difference(previous[index], value)
                        )
                        for index, value in enumerate(next_value)
                    ],
                ),
            ]
            if (
                isinstance(before_previous, list)
                and len(before_previous) == len(previous)
                and all(_is_exact_float32(value) for value in before_previous)
            ):
                candidates.extend(
                    [
                        _float32_candidate(
                            DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY,
                            FLOAT32_MODE_BIT_PREDICTION,
                            [
                                _encode_signed_difference(
                                    _signed_uint32_difference(
                                        _predict_float32_bits(
                                            before_previous[index], previous[index]
                                        ),
                                        _number_to_float32_bits(value),
                                    )
                                )
                                for index, value in enumerate(next_value)
                            ],
                        ),
                        _float32_candidate(
                            DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY,
                            FLOAT32_MODE_VALUE_PREDICTION,
                            [
                                _encode_signed_difference(
                                    _signed_uint32_difference(
                                        _predict_float32_value_bits(
                                            before_previous[index], previous[index]
                                        ),
                                        _number_to_float32_bits(value),
                                    )
                                )
                                for index, value in enumerate(next_value)
                            ],
                        ),
                    ]
                )
            candidates.sort(key=lambda candidate: candidate["bytes"])
            selected = candidates[0]
            return {
                "kind": selected["kind"],
                "values": next_value,
                "mode": selected.get("mode"),
                "bit_width": selected.get("bit_width"),
                "residuals": selected["residuals"],
            }

        deltas: list[Any] = []
        changes: list[tuple[int, Any]] = []
        for index, item in enumerate(next_value):
            delta = create_replay_delta(
                previous[index] if index < len(previous) else _SKIP,
                item,
                before_previous[index]
                if isinstance(before_previous, list) and index < len(before_previous)
                else _SKIP,
            )
            deltas.append(delta)
            if delta is not None:
                changes.append((index, delta))
        if len(previous) == len(next_value) and not changes:
            return None
        if len(previous) == len(next_value) and len(changes) > len(next_value) / 2:
            return {"kind": DELTA_DENSE_ARRAY, "deltas": deltas}
        return {"kind": DELTA_ARRAY, "length": len(next_value), "changes": changes}

    if isinstance(previous, dict) and isinstance(next_value, dict):
        deletions = [key for key in previous if key not in next_value]
        changes = []
        for key, item in next_value.items():
            delta = create_replay_delta(
                previous.get(key, _SKIP),
                item,
                before_previous.get(key, _SKIP)
                if isinstance(before_previous, dict)
                else _SKIP,
            )
            if delta is not None:
                changes.append((key, delta))
        if not deletions and not changes:
            return None
        return {"kind": DELTA_OBJECT, "deletions": deletions, "changes": changes}
    return {"kind": DELTA_REPLACE, "value": next_value}


def _write_number_xor(writer: BinaryWriter, previous: Any, next_value: Any) -> None:
    xor = _number_to_bits(previous) ^ _number_to_bits(next_value)
    if xor == 0:
        raise ViewerDeltaError("Replay number XOR delta must not be empty")
    trailing_bytes = 0
    significant = xor
    while trailing_bytes < 7 and significant & 0xFF == 0:
        significant >>= 8
        trailing_bytes += 1
    significant_bytes = max(1, (significant.bit_length() + 7) // 8)
    writer.write_byte((trailing_bytes << 4) | (significant_bytes - 1))
    writer.write_bytes(significant.to_bytes(significant_bytes, "little"))


def _write_number_delta(
    writer: BinaryWriter, previous: Any, next_value: Any, before_previous: Any
) -> None:
    difference = float(next_value) - float(previous)
    if (
        float(previous).is_integer()
        and abs(float(previous)) <= SAFE_INTEGER_MAX
        and float(next_value).is_integer()
        and abs(float(next_value)) <= SAFE_INTEGER_MAX
        and not _is_negative_zero(previous)
        and not _is_negative_zero(next_value)
        and difference.is_integer()
        and abs(difference) <= SAFE_INTEGER_MAX // 2
    ):
        integer_difference = int(difference)
        writer.write_byte(DELTA_INTEGER_DIFFERENCE)
        writer.write_varuint(_encode_signed_difference(integer_difference))
        return
    if _is_exact_float32(previous) and _is_exact_float32(next_value):
        candidates = [
            {
                "tag": DELTA_FLOAT32_XOR,
                "value": _number_to_float32_bits(previous)
                ^ _number_to_float32_bits(next_value),
            },
            {
                "tag": DELTA_FLOAT32_DIFFERENCE,
                "value": _encode_signed_difference(
                    _signed_float32_bit_difference(previous, next_value)
                ),
            },
        ]
        if _is_exact_float32(before_previous):
            candidates.extend(
                [
                    {
                        "tag": DELTA_FLOAT32_BIT_PREDICTION,
                        "value": _encode_signed_difference(
                            _signed_uint32_difference(
                                _predict_float32_bits(before_previous, previous),
                                _number_to_float32_bits(next_value),
                            )
                        ),
                    },
                    {
                        "tag": DELTA_FLOAT32_VALUE_PREDICTION,
                        "value": _encode_signed_difference(
                            _signed_uint32_difference(
                                _predict_float32_value_bits(before_previous, previous),
                                _number_to_float32_bits(next_value),
                            )
                        ),
                    },
                ]
            )
        candidates.sort(key=lambda candidate: _varuint_length(candidate["value"]))
        writer.write_byte(candidates[0]["tag"])
        writer.write_varuint(candidates[0]["value"])
        return
    writer.write_byte(DELTA_NUMBER_XOR)
    _write_number_xor(writer, previous, next_value)


def _write_packed_unsigned(writer: BinaryWriter, values: list[int], bit_width: int) -> None:
    if bit_width == 0:
        return
    accumulator = 0
    accumulator_bits = 0
    for value in values:
        accumulator |= value << accumulator_bits
        accumulator_bits += bit_width
        while accumulator_bits >= 8:
            writer.write_byte(accumulator & 0xFF)
            accumulator >>= 8
            accumulator_bits -= 8
    if accumulator_bits:
        writer.write_byte(accumulator & 0xFF)


def _read_packed_unsigned(reader: BinaryReader, count: int, bit_width: int) -> list[int]:
    if bit_width == 0:
        return [0] * count
    mask = (1 << bit_width) - 1
    values: list[int] = []
    accumulator = 0
    accumulator_bits = 0
    while len(values) < count:
        while accumulator_bits < bit_width:
            accumulator |= reader.read_byte() << accumulator_bits
            accumulator_bits += 8
        values.append(accumulator & mask)
        accumulator >>= bit_width
        accumulator_bits -= bit_width
    return values


def _write_delta(
    writer: BinaryWriter, previous: Any, delta: Any, before_previous: Any = _SKIP
) -> None:
    if delta is None:
        writer.write_byte(DELTA_SAME)
        return
    if delta["kind"] == DELTA_NUMBER_XOR:
        _write_number_delta(writer, previous, delta["value"], before_previous)
        return
    kind = delta["kind"]
    writer.write_byte(kind)
    if kind == DELTA_REPLACE:
        _write_value(writer, delta["value"])
    elif kind == DELTA_OBJECT:
        writer.write_varuint(len(delta["deletions"]))
        for key in delta["deletions"]:
            writer.write_string(key)
        writer.write_varuint(len(delta["changes"]))
        for key, child in delta["changes"]:
            writer.write_string(key)
            _write_delta(
                writer,
                previous.get(key, _SKIP),
                child,
                before_previous.get(key, _SKIP)
                if isinstance(before_previous, dict)
                else _SKIP,
            )
    elif kind == DELTA_ARRAY:
        writer.write_varuint(delta["length"])
        writer.write_varuint(len(delta["changes"]))
        for index, child in delta["changes"]:
            writer.write_varuint(index)
            _write_delta(
                writer,
                previous[index] if index < len(previous) else _SKIP,
                child,
                before_previous[index]
                if isinstance(before_previous, list) and index < len(before_previous)
                else _SKIP,
            )
    elif kind == DELTA_DENSE_ARRAY:
        for index, child in enumerate(delta["deltas"]):
            _write_delta(
                writer,
                previous[index],
                child,
                before_previous[index]
                if isinstance(before_previous, list)
                else _SKIP,
            )
    elif kind == DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY:
        for index, value in enumerate(delta["values"]):
            writer.write_varuint(
                _encode_signed_difference(
                    _signed_float32_bit_difference(previous[index], value)
                )
            )
    elif kind == DELTA_DENSE_FLOAT32_XOR_ARRAY:
        for index, value in enumerate(delta["values"]):
            writer.write_varuint(
                _number_to_float32_bits(previous[index]) ^ _number_to_float32_bits(value)
            )
    elif kind in (
        DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY,
        DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY,
    ):
        predictor = (
            _predict_float32_bits
            if kind == DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY
            else _predict_float32_value_bits
        )
        for index, value in enumerate(delta["values"]):
            writer.write_varuint(
                _encode_signed_difference(
                    _signed_uint32_difference(
                        predictor(before_previous[index], previous[index]),
                        _number_to_float32_bits(value),
                    )
                )
            )
    elif kind == DELTA_DENSE_FLOAT32_BITPACKED_ARRAY:
        writer.write_byte(delta["mode"])
        writer.write_byte(delta["bit_width"])
        _write_packed_unsigned(writer, delta["residuals"], delta["bit_width"])
    else:
        raise ViewerDeltaError(f"Unknown replay delta kind {kind}")


def encode_replay_delta_chunk(ticks: list[Any], *, first_tick: int = 0) -> bytes:
    if not ticks:
        raise ViewerDeltaError("Replay delta chunks require at least one tick")
    writer = BinaryWriter()
    writer.write_bytes(VIEWER_CHUNK_MAGIC)
    writer.write_byte(VIEWER_CONTAINER_VERSION)
    writer.write_varuint(first_tick)
    writer.write_varuint(len(ticks))
    _write_value(writer, ticks[0])
    for index in range(1, len(ticks)):
        before_previous = ticks[index - 2] if index > 1 else _SKIP
        _write_delta(
            writer,
            ticks[index - 1],
            create_replay_delta(ticks[index - 1], ticks[index], before_previous),
            before_previous,
        )
    return writer.finish()


def _read_number_xor(reader: BinaryReader, previous: Any) -> float:
    if not _is_number(previous):
        raise ViewerDeltaError("Replay number XOR base is malformed")
    descriptor = reader.read_byte()
    trailing_bytes = descriptor >> 4
    significant_bytes = (descriptor & 0x0F) + 1
    if trailing_bytes + significant_bytes > 8:
        raise ViewerDeltaError("Replay number XOR delta is malformed")
    significant = int.from_bytes(reader.read_bytes(significant_bytes), "little")
    return _bits_to_number(
        _number_to_bits(previous) ^ (significant << (trailing_bytes * 8))
    )


def _read_float32_xor(reader: BinaryReader, previous: Any) -> float:
    if not _is_exact_float32(previous):
        raise ViewerDeltaError("Replay float32 XOR base is malformed")
    xor = reader.read_varuint()
    if xor > 0xFFFFFFFF:
        raise ViewerDeltaError("Replay float32 XOR delta is malformed")
    return _float32_bits_to_number(_number_to_float32_bits(previous) ^ xor)


def _read_integer_difference(reader: BinaryReader, previous: Any) -> int:
    if (
        not _is_number(previous)
        or not float(previous).is_integer()
        or abs(float(previous)) > SAFE_INTEGER_MAX
    ):
        raise ViewerDeltaError("Replay integer delta base is malformed")
    next_value = int(previous) + _decode_signed_difference(reader.read_varuint())
    if abs(next_value) > SAFE_INTEGER_MAX:
        raise ViewerDeltaError("Replay integer delta exceeds the safe range")
    return next_value


def _read_float32_difference(reader: BinaryReader, previous: Any) -> float:
    if not _is_exact_float32(previous):
        raise ViewerDeltaError("Replay float32 difference base is malformed")
    difference = _decode_signed_difference(reader.read_varuint())
    if not -0x80000000 <= difference <= 0x7FFFFFFF:
        raise ViewerDeltaError("Replay float32 difference is malformed")
    return _float32_bits_to_number(_number_to_float32_bits(previous) + difference)


def _read_float32_prediction(
    reader: BinaryReader,
    before_previous: Any,
    previous: Any,
    predictor: Any,
) -> float:
    if not _is_exact_float32(before_previous) or not _is_exact_float32(previous):
        raise ViewerDeltaError("Replay float32 prediction base is malformed")
    difference = _decode_signed_difference(reader.read_varuint())
    if not -0x80000000 <= difference <= 0x7FFFFFFF:
        raise ViewerDeltaError("Replay float32 prediction is malformed")
    return _float32_bits_to_number(predictor(before_previous, previous) + difference)


def _read_patched_value(
    reader: BinaryReader, previous: Any, before_previous: Any = _SKIP
) -> Any:
    tag = reader.read_byte()
    if tag == DELTA_SAME:
        return previous
    if tag == DELTA_REPLACE:
        return _read_value(reader)
    if tag == DELTA_NUMBER_XOR:
        return _read_number_xor(reader, previous)
    if tag == DELTA_FLOAT32_XOR:
        return _read_float32_xor(reader, previous)
    if tag == DELTA_INTEGER_DIFFERENCE:
        return _read_integer_difference(reader, previous)
    if tag == DELTA_FLOAT32_DIFFERENCE:
        return _read_float32_difference(reader, previous)
    if tag == DELTA_FLOAT32_BIT_PREDICTION:
        return _read_float32_prediction(
            reader, before_previous, previous, _predict_float32_bits
        )
    if tag == DELTA_FLOAT32_VALUE_PREDICTION:
        return _read_float32_prediction(
            reader, before_previous, previous, _predict_float32_value_bits
        )
    if tag == DELTA_OBJECT:
        if not isinstance(previous, dict):
            raise ViewerDeltaError("Replay object delta base is malformed")
        next_value = dict(previous)
        for _ in range(reader.read_varuint()):
            next_value.pop(reader.read_string(), None)
        for _ in range(reader.read_varuint()):
            key = reader.read_string()
            next_value[key] = _read_patched_value(
                reader,
                previous.get(key, _SKIP),
                before_previous.get(key, _SKIP)
                if isinstance(before_previous, dict)
                else _SKIP,
            )
        return next_value
    if tag == DELTA_ARRAY:
        if not isinstance(previous, list):
            raise ViewerDeltaError("Replay array delta base is malformed")
        length = reader.read_varuint()
        next_value = previous[:length]
        if length > len(next_value):
            next_value.extend([_SKIP] * (length - len(next_value)))
        for _ in range(reader.read_varuint()):
            index = reader.read_varuint()
            if index >= length:
                raise ViewerDeltaError("Replay array delta index is malformed")
            next_value[index] = _read_patched_value(
                reader,
                previous[index] if index < len(previous) else _SKIP,
                before_previous[index]
                if isinstance(before_previous, list) and index < len(before_previous)
                else _SKIP,
            )
        if any(item is _SKIP for item in next_value):
            raise ViewerDeltaError("Replay array delta left an undefined item")
        return next_value
    if tag == DELTA_DENSE_ARRAY:
        if not isinstance(previous, list):
            raise ViewerDeltaError("Replay dense array delta base is malformed")
        return [
            _read_patched_value(
                reader,
                value,
                before_previous[index]
                if isinstance(before_previous, list)
                else _SKIP,
            )
            for index, value in enumerate(previous)
        ]
    if tag in (
        DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY,
        DELTA_DENSE_FLOAT32_XOR_ARRAY,
        DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY,
        DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY,
        DELTA_DENSE_FLOAT32_BITPACKED_ARRAY,
    ):
        if not isinstance(previous, list) or not all(
            _is_exact_float32(value) for value in previous
        ):
            raise ViewerDeltaError("Replay dense float32 array base is malformed")
        if tag == DELTA_DENSE_FLOAT32_DIFFERENCE_ARRAY:
            output = []
            for value in previous:
                difference = _decode_signed_difference(reader.read_varuint())
                if not -0x80000000 <= difference <= 0x7FFFFFFF:
                    raise ViewerDeltaError("Replay dense float32 difference is malformed")
                output.append(
                    _float32_bits_to_number(_number_to_float32_bits(value) + difference)
                )
            return output
        if tag == DELTA_DENSE_FLOAT32_XOR_ARRAY:
            output = []
            for value in previous:
                xor = reader.read_varuint()
                if xor > 0xFFFFFFFF:
                    raise ViewerDeltaError("Replay dense float32 XOR delta is malformed")
                output.append(
                    _float32_bits_to_number(_number_to_float32_bits(value) ^ xor)
                )
            return output
        if tag in (
            DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY,
            DELTA_DENSE_FLOAT32_VALUE_PREDICTION_ARRAY,
        ):
            if (
                not isinstance(before_previous, list)
                or len(before_previous) != len(previous)
                or not all(_is_exact_float32(value) for value in before_previous)
            ):
                raise ViewerDeltaError("Replay dense float32 prediction base is malformed")
            predictor = (
                _predict_float32_bits
                if tag == DELTA_DENSE_FLOAT32_BIT_PREDICTION_ARRAY
                else _predict_float32_value_bits
            )
            output = []
            for index, value in enumerate(previous):
                difference = _decode_signed_difference(reader.read_varuint())
                if not -0x80000000 <= difference <= 0x7FFFFFFF:
                    raise ViewerDeltaError("Replay dense float32 prediction is malformed")
                output.append(
                    _float32_bits_to_number(
                        predictor(before_previous[index], value) + difference
                    )
                )
            return output

        mode = reader.read_byte()
        bit_width = reader.read_byte()
        if mode > FLOAT32_MODE_VALUE_PREDICTION or bit_width > 32:
            raise ViewerDeltaError("Replay dense bitpacked float32 metadata is malformed")
        if mode >= FLOAT32_MODE_BIT_PREDICTION and (
            not isinstance(before_previous, list)
            or len(before_previous) != len(previous)
            or not all(_is_exact_float32(value) for value in before_previous)
        ):
            raise ViewerDeltaError("Replay dense bitpacked prediction base is malformed")
        residuals = _read_packed_unsigned(reader, len(previous), bit_width)
        output = []
        for index, value in enumerate(previous):
            previous_bits = _number_to_float32_bits(value)
            if mode == FLOAT32_MODE_XOR:
                bits = previous_bits ^ residuals[index]
            elif mode == FLOAT32_MODE_DIFFERENCE:
                bits = previous_bits + _decode_signed_difference(residuals[index])
            elif mode == FLOAT32_MODE_BIT_PREDICTION:
                bits = _predict_float32_bits(before_previous[index], value) + _decode_signed_difference(
                    residuals[index]
                )
            else:
                bits = _predict_float32_value_bits(
                    before_previous[index], value
                ) + _decode_signed_difference(residuals[index])
            output.append(_float32_bits_to_number(bits))
        return output
    raise ViewerDeltaError(f"Unknown replay delta tag {tag}")


def decode_replay_delta_chunk(value: bytes | bytearray) -> tuple[int, list[Any]]:
    reader = BinaryReader(value)
    if reader.read_bytes(4) != VIEWER_CHUNK_MAGIC:
        raise ViewerDeltaError("Replay delta chunk magic is invalid")
    version = reader.read_byte()
    if version != VIEWER_CONTAINER_VERSION:
        raise ViewerDeltaError(f"Unsupported replay delta version {version}")
    first_tick = reader.read_varuint()
    tick_count = reader.read_varuint()
    if tick_count < 1:
        raise ViewerDeltaError("Replay delta chunk tick count is invalid")
    ticks = [_read_value(reader)]
    for index in range(1, tick_count):
        ticks.append(
            _read_patched_value(
                reader,
                ticks[index - 1],
                ticks[index - 2] if index > 1 else _SKIP,
            )
        )
    if reader.offset != len(reader.bytes):
        raise ViewerDeltaError("Replay delta chunk contains trailing bytes")
    return first_tick, ticks


@dataclass(frozen=True)
class _ProjectionContext:
    definitions: dict[str, Any]
    limits: dict[str, int]


def _resolve_node(node: Any, context: _ProjectionContext) -> Any:
    seen: set[str] = set()
    while isinstance(node, dict) and node.get("kind") == "ref":
        name = node.get("name")
        if not isinstance(name, str) or name in seen:
            raise ViewerDeltaError("Projection contains an invalid reference")
        seen.add(name)
        node = context.definitions.get(name)
    if node is None:
        raise ViewerDeltaError("Projection references an unknown definition")
    return node


def _collection_limit(node: dict[str, Any], context: _ProjectionContext) -> int:
    raw_limit = node.get("take_first", node.get("max_items", node.get("limit")))
    limit = context.limits.get(raw_limit) if isinstance(raw_limit, str) else raw_limit
    if not isinstance(limit, int) or limit < 0:
        raise ViewerDeltaError("Projection collection limit is malformed")
    return limit


def _normalize_scalar(value: Any, *, nullable: bool = False) -> Any:
    if value is None:
        if nullable:
            return None
        raise ViewerDeltaError("Projection expected a non-null scalar")
    if isinstance(value, (list, dict)) or not isinstance(value, (str, int, float, bool)):
        raise ViewerDeltaError("Projection expected a JSON scalar")
    if _is_number(value):
        numeric = float(value)
        if not math.isfinite(numeric):
            raise ViewerDeltaError("Projection rejects non-finite numbers")
        if isinstance(value, int) and abs(value) > SAFE_INTEGER_MAX:
            return numeric
    return value


def project_value(node: Any, value: Any, *, context: _ProjectionContext) -> Any:
    node = _resolve_node(node, context)
    if node == "scalar":
        return _normalize_scalar(value)
    if node == "nullable_scalar":
        return _normalize_scalar(value, nullable=True)
    if not isinstance(node, dict):
        raise ViewerDeltaError("Projection node is malformed")
    kind = node.get("kind")
    if kind == "object":
        if not isinstance(value, Mapping):
            raise ViewerDeltaError("Projection expected an object")
        fields = node.get("fields")
        if not isinstance(fields, dict):
            raise ViewerDeltaError("Projection object fields are malformed")
        required = node.get("required", [])
        if any(key not in value or value[key] is None for key in required):
            raise ViewerDeltaError("Projection is missing a required object field")
        output: dict[str, Any] = {}
        for output_key, child in fields.items():
            if isinstance(child, dict) and child.get("kind") == "generated":
                continue
            source_key = child.get("source", output_key) if isinstance(child, dict) else output_key
            item = value.get(source_key, _SKIP)
            if item is _SKIP or item is None:
                continue
            output[output_key] = project_value(child, item, context=context)
        return output
    if kind == "map":
        if not isinstance(value, Mapping):
            raise ViewerDeltaError("Projection expected a dynamic object map")
        if len(value) > _collection_limit(node, context):
            raise ViewerDeltaError("Projection map exceeds its pinned limit")
        return {
            str(key): project_value(node.get("values"), item, context=context)
            for key, item in value.items()
            if item is not None
        }
    if kind == "array":
        if not isinstance(value, list):
            raise ViewerDeltaError("Projection expected an array")
        limit = _collection_limit(node, context)
        if "take_first" in node:
            source_items = value[:limit]
        else:
            if len(value) > limit:
                raise ViewerDeltaError("Projection array exceeds its pinned limit")
            source_items = value
        return [
            project_value(node.get("items"), item, context=context)
            for item in source_items
        ]
    raise ViewerDeltaError(f"Unsupported projection node kind: {kind}")


@dataclass
class _ProjectionFrame:
    node: dict[str, Any]
    container: dict[str, Any] | list[Any]
    pending_key: str | None = None
    source_items: int = 0


class ProjectedEventBuilder:
    def __init__(self, node: Any, context: _ProjectionContext) -> None:
        self.root_node = node
        self.context = context
        self.frames: list[_ProjectionFrame] = []
        self.skip_depth = 0
        self.value: Any = _SKIP
        self.complete = False

    def feed(self, event: str, value: Any) -> None:
        if self.complete:
            raise ViewerDeltaError("Projection builder received trailing input")
        if self.skip_depth:
            if event in ("start_map", "start_array"):
                self.skip_depth += 1
            elif event in ("end_map", "end_array"):
                self.skip_depth -= 1
            return
        if event == "map_key":
            if not self.frames or not isinstance(self.frames[-1].container, dict):
                raise ViewerDeltaError("Projection received an unexpected object key")
            self.frames[-1].pending_key = str(value)
            return
        if event in ("end_map", "end_array"):
            if not self.frames:
                raise ViewerDeltaError("Projection received an unexpected container end")
            frame = self.frames.pop()
            expected = "end_map" if isinstance(frame.container, dict) else "end_array"
            if event != expected:
                raise ViewerDeltaError("Projection container shape changed")
            required = frame.node.get("required", [])
            if isinstance(frame.container, dict) and any(
                key not in frame.container for key in required
            ):
                raise ViewerDeltaError("Projection is missing a required object field")
            if isinstance(frame.container, dict) and frame.node.get("kind") == "object":
                fields = frame.node.get("fields") or {}
                ordered = {
                    key: frame.container[key]
                    for key in fields
                    if key in frame.container
                }
                frame.container.clear()
                frame.container.update(ordered)
            if not self.frames:
                self.value = frame.container
                self.complete = True
            return

        node, attach = self._next_node()
        if node is _SKIP:
            if event in ("start_map", "start_array"):
                self.skip_depth = 1
            return
        resolved = _resolve_node(node, self.context)
        if event in ("start_map", "start_array"):
            if not isinstance(resolved, dict):
                raise ViewerDeltaError("Projection expected a scalar")
            kind = resolved.get("kind")
            if (event == "start_map" and kind not in ("object", "map")) or (
                event == "start_array" and kind != "array"
            ):
                raise ViewerDeltaError("Projection source has the wrong container type")
            container: dict[str, Any] | list[Any] = {} if event == "start_map" else []
            self._attach(attach, container)
            self.frames.append(_ProjectionFrame(node=resolved, container=container))
            return
        if event in ("null", "boolean", "integer", "double", "number", "string"):
            if value is None and attach[0] == "object":
                return
            if resolved == "scalar":
                projected = _normalize_scalar(value)
            elif resolved == "nullable_scalar":
                projected = _normalize_scalar(value, nullable=True)
            else:
                raise ViewerDeltaError("Projection source has the wrong scalar type")
            self._attach(attach, projected)
            if not self.frames:
                self.value = projected
                self.complete = True
            return
        raise ViewerDeltaError(f"Projection received unsupported event {event}")

    def _next_node(self) -> tuple[Any, tuple[str, str | None]]:
        if not self.frames:
            return self.root_node, ("root", None)
        frame = self.frames[-1]
        kind = frame.node.get("kind")
        if kind == "object":
            source_key = frame.pending_key
            frame.pending_key = None
            fields = frame.node.get("fields") or {}
            output_key = None
            child = None
            for candidate_key, candidate_child in fields.items():
                candidate_source = (
                    candidate_child.get("source", candidate_key)
                    if isinstance(candidate_child, dict)
                    else candidate_key
                )
                if candidate_source == source_key:
                    output_key = candidate_key
                    child = candidate_child
                    break
            if isinstance(child, dict) and child.get("kind") == "generated":
                child = None
            return (child if child is not None else _SKIP), ("object", output_key)
        if kind == "map":
            key = frame.pending_key
            frame.pending_key = None
            frame.source_items += 1
            if frame.source_items > _collection_limit(frame.node, self.context):
                raise ViewerDeltaError("Projection map exceeds its pinned limit")
            return frame.node.get("values"), ("object", key)
        if kind == "array":
            frame.source_items += 1
            limit = _collection_limit(frame.node, self.context)
            if frame.source_items > limit:
                if "take_first" in frame.node:
                    return _SKIP, ("array", None)
                raise ViewerDeltaError("Projection array exceeds its pinned limit")
            return frame.node.get("items"), ("array", None)
        raise ViewerDeltaError("Projection frame kind is malformed")

    def _attach(self, target: tuple[str, str | None], value: Any) -> None:
        kind, key = target
        if kind == "root":
            return
        parent = self.frames[-1].container
        if kind == "object":
            if not isinstance(parent, dict) or key is None:
                raise ViewerDeltaError("Projection object attachment is malformed")
            parent[key] = value
        elif kind == "array":
            if not isinstance(parent, list):
                raise ViewerDeltaError("Projection array attachment is malformed")
            parent.append(value)


class ViewerPartsWriter:
    def __init__(self, directory: Path, *, producer: str) -> None:
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.producer = producer
        self.pending_ticks: list[Any] = []
        self.tick_count = 0
        self.chunks: list[ViewerChunkPart] = []
        self.encode_duration_ms = 0

    def add_tick(self, tick: Any) -> None:
        if self.tick_count >= VIEWER_MAX_TICKS:
            raise ViewerDeltaError("Replay tick count exceeds the pinned contract limit")
        self.pending_ticks.append(tick)
        self.tick_count += 1
        if len(self.pending_ticks) == VIEWER_KEYFRAME_INTERVAL:
            self._flush_chunk()

    def finish(
        self, replay: dict[str, Any], *, projection_duration_ms: int
    ) -> ViewerParts:
        self._flush_chunk()
        if self.tick_count < 1:
            raise ViewerDeltaError("Viewer artifacts require at least one replay tick")
        return ViewerParts(
            directory=self.directory,
            tick_count=self.tick_count,
            replay=replay,
            chunks=tuple(self.chunks),
            producer=self.producer,
            projection_duration_ms=projection_duration_ms,
            encode_duration_ms=self.encode_duration_ms,
        )

    def _flush_chunk(self) -> None:
        if not self.pending_ticks:
            return
        started = time.perf_counter()
        first_tick = self.tick_count - len(self.pending_ticks)
        raw = encode_replay_delta_chunk(self.pending_ticks, first_tick=first_tick)
        decoded_first_tick, decoded_ticks = decode_replay_delta_chunk(raw)
        if decoded_first_tick != first_tick or not _deep_exact_equal(
            decoded_ticks, self.pending_ticks
        ):
            raise ViewerDeltaError("Replay delta chunk failed lossless self-validation")
        index = len(self.chunks)
        raw_path = self.directory / f"chunk-{index:05d}.hsrd"
        raw_path.write_bytes(raw)
        self.chunks.append(
            ViewerChunkPart(
                index=index,
                first_tick=first_tick,
                tick_count=len(self.pending_ticks),
                raw_path=raw_path,
                raw_bytes=len(raw),
            )
        )
        self.pending_ticks = []
        self.encode_duration_ms += round((time.perf_counter() - started) * 1000)


def _deep_exact_equal(left: Any, right: Any) -> bool:
    if _is_number(left) and _is_number(right):
        return _same_value(left, right)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            _deep_exact_equal(left[index], right[index]) for index in range(len(left))
        )
    if isinstance(left, dict) and isinstance(right, dict):
        return list(left) == list(right) and all(
            _deep_exact_equal(left[key], right[key]) for key in left
        )
    return type(left) is type(right) and left == right


def build_python_viewer_parts(json_path: Path, directory: Path) -> ViewerParts:
    contract = load_pinned_contract()
    projection = contract.projection
    definitions = projection.get("definitions")
    limits = projection.get("limits")
    root = projection.get("root")
    if not isinstance(definitions, dict) or not isinstance(limits, dict) or not isinstance(root, dict):
        raise ViewerDeltaError("Pinned projection document is malformed")
    root_fields = root.get("fields")
    if not isinstance(root_fields, dict):
        raise ViewerDeltaError("Pinned projection root fields are malformed")
    context = _ProjectionContext(definitions=definitions, limits=limits)
    writer = ViewerPartsWriter(directory, producer="python-ijson")
    top_level: dict[str, Any] = {}
    active_key: str | None = None
    active_builder: ProjectedEventBuilder | None = None
    source_depth = 0
    started = time.perf_counter()

    try:
        with json_path.open("rb") as replay_file:
            for prefix, event, value in ijson.parse(replay_file, use_float=True):
                if event in ("start_map", "start_array"):
                    source_depth += 1
                    if source_depth > VIEWER_MAX_JSON_DEPTH:
                        raise ViewerDeltaError(
                            "Replay JSON exceeds the pinned maximum depth"
                        )
                elif event in ("end_map", "end_array"):
                    source_depth -= 1
                    if source_depth < 0:
                        raise ViewerDeltaError("Replay JSON container depth is invalid")
                elif event == "string" and len(value) > VIEWER_MAX_STRING_CHARACTERS:
                    raise ViewerDeltaError(
                        "Replay JSON string exceeds the pinned character limit"
                    )
                if active_builder is not None:
                    active_builder.feed(event, value)
                    if active_builder.complete:
                        projected = active_builder.value
                        if active_key == "ticks.item":
                            writer.add_tick(projected)
                        elif active_key is not None:
                            top_level[active_key] = projected
                        active_key = None
                        active_builder = None
                    continue

                if prefix == "ticks.item" and event == "start_map":
                    active_key = "ticks.item"
                    active_builder = ProjectedEventBuilder(
                        definitions["tick"], context
                    )
                    active_builder.feed(event, value)
                    continue
                if prefix in root_fields and prefix not in ("artifact", "ticks"):
                    node = root_fields[prefix]
                    if event in ("start_map", "start_array") or event in (
                        "null",
                        "boolean",
                        "integer",
                        "double",
                        "number",
                        "string",
                    ):
                        active_key = prefix
                        active_builder = ProjectedEventBuilder(node, context)
                        active_builder.feed(event, value)
                        if active_builder.complete:
                            if active_builder.value is not None:
                                top_level[prefix] = active_builder.value
                            active_key = None
                            active_builder = None
    except (OSError, ijson.JSONError) as error:
        raise ViewerDeltaError(f"Replay projection stream failed: {error}") from error
    if active_builder is not None:
        raise ViewerDeltaError("Replay projection ended inside a JSON value")
    if source_depth != 0:
        raise ViewerDeltaError("Replay JSON ended with an invalid container depth")

    replay = {
        key: top_level[key]
        for key in root_fields
        if key not in ("artifact", "ticks") and key in top_level
    }
    projection_duration_ms = round((time.perf_counter() - started) * 1000)
    return writer.finish(replay, projection_duration_ms=projection_duration_ms)


def write_viewer_parts_descriptor(parts: ViewerParts) -> Path:
    descriptor = {
        "schema": VIEWER_PARTS_SCHEMA,
        "sourceContract": {
            "schema": VIEWER_SCHEMA,
            "profile": VIEWER_PROFILE,
            "profile_revision": VIEWER_PROFILE_REVISION,
            "projection_sha256": VIEWER_PROJECTION_SHA256,
            "tick_count": parts.tick_count,
        },
        "tickCount": parts.tick_count,
        "replay": parts.replay,
        "chunks": [
            {
                "index": chunk.index,
                "firstTick": chunk.first_tick,
                "tickCount": chunk.tick_count,
                "rawFile": chunk.raw_path.name,
                "rawBytes": chunk.raw_bytes,
            }
            for chunk in parts.chunks
        ],
        "producer": parts.producer,
        "metrics": {
            "projectionDurationMs": parts.projection_duration_ms,
            "encodeDurationMs": parts.encode_duration_ms,
        },
    }
    path = parts.directory / "parts.json"
    path.write_bytes(_compact_json_bytes(descriptor))
    return path


def load_native_viewer_parts(directory: Path) -> ViewerParts:
    descriptor_path = directory / "parts.json"
    descriptor = _load_json_object(descriptor_path)
    if descriptor.get("schema") != VIEWER_PARTS_SCHEMA:
        raise ViewerDeltaError("Native viewer parts use an unsupported schema")
    source_contract = descriptor.get("sourceContract")
    tick_count = descriptor.get("tickCount")
    expected_contract = {
        "schema": VIEWER_SCHEMA,
        "profile": VIEWER_PROFILE,
        "profile_revision": VIEWER_PROFILE_REVISION,
        "projection_sha256": VIEWER_PROJECTION_SHA256,
        "tick_count": tick_count,
    }
    if source_contract != expected_contract:
        raise ViewerDeltaError("Native viewer parts do not match the pinned contract")
    if type(tick_count) is not int or not 1 <= tick_count <= VIEWER_MAX_TICKS:
        raise ViewerDeltaError("Native viewer parts have an invalid tick count")
    replay = descriptor.get("replay")
    raw_chunks = descriptor.get("chunks")
    if not isinstance(replay, dict) or not isinstance(raw_chunks, list):
        raise ViewerDeltaError("Native viewer parts descriptor is malformed")
    chunks: list[ViewerChunkPart] = []
    expected_first_tick = 0
    for expected_index, raw_chunk in enumerate(raw_chunks):
        if not isinstance(raw_chunk, dict):
            raise ViewerDeltaError("Native viewer chunk descriptor is malformed")
        raw_file = raw_chunk.get("rawFile")
        raw_bytes = raw_chunk.get("rawBytes")
        chunk_tick_count = raw_chunk.get("tickCount")
        first_tick = raw_chunk.get("firstTick")
        if (
            type(raw_chunk.get("index")) is not int
            or raw_chunk.get("index") != expected_index
            or type(first_tick) is not int
            or first_tick != expected_first_tick
            or type(chunk_tick_count) is not int
            or not 1 <= chunk_tick_count <= VIEWER_KEYFRAME_INTERVAL
            or not isinstance(raw_file, str)
            or Path(raw_file).name != raw_file
            or type(raw_bytes) is not int
            or raw_bytes < 1
        ):
            raise ViewerDeltaError("Native viewer chunk sequence is invalid")
        raw_path = directory / raw_file
        if not raw_path.is_file() or raw_path.stat().st_size != raw_bytes:
            raise ViewerDeltaError("Native viewer chunk file is missing or has the wrong size")
        chunks.append(
            ViewerChunkPart(
                index=expected_index,
                first_tick=first_tick,
                tick_count=chunk_tick_count,
                raw_path=raw_path,
                raw_bytes=raw_bytes,
            )
        )
        expected_first_tick += chunk_tick_count
    if expected_first_tick != tick_count:
        raise ViewerDeltaError("Native viewer chunk coverage does not match tick count")
    metrics = descriptor.get("metrics")
    metrics = metrics if isinstance(metrics, dict) else {}
    return ViewerParts(
        directory=directory,
        tick_count=tick_count,
        replay=replay,
        chunks=tuple(chunks),
        producer=str(descriptor.get("producer") or "rust-serde"),
        projection_duration_ms=_nonnegative_metric(
            metrics.get("projectionDurationMs")
        ),
        encode_duration_ms=_nonnegative_metric(metrics.get("encodeDurationMs")),
    )


def _nonnegative_metric(value: Any) -> int:
    return value if isinstance(value, int) and value >= 0 else 0


def _compact_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ViewerDeltaError("Viewer artifact contains invalid JSON") from error


def _tick_hash_json_bytes(value: Any) -> bytes:
    def serialize(item: Any) -> str:
        if item is None:
            return "null"
        if item is True:
            return "true"
        if item is False:
            return "false"
        if isinstance(item, int):
            return str(item)
        if isinstance(item, float):
            return _javascript_number_to_string(item)
        if isinstance(item, str):
            return json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        if isinstance(item, list):
            return "[" + ",".join(serialize(child) for child in item) + "]"
        if isinstance(item, dict):
            return "{" + ",".join(
                json.dumps(key, ensure_ascii=False) + ":" + serialize(child)
                for key, child in item.items()
            ) + "}"
        raise ViewerDeltaError("Tick hash encountered a non-JSON value")

    return serialize(value).encode("utf-8")


def _javascript_number_to_string(value: float) -> str:
    if not math.isfinite(value):
        raise ViewerDeltaError("Tick hash rejects non-finite numbers")
    if value == 0.0:
        return "0"

    text = repr(value).lower()
    if "e" not in text:
        return text.removesuffix(".0")

    mantissa, raw_exponent = text.split("e", 1)
    exponent = int(raw_exponent)
    negative = mantissa.startswith("-")
    if negative:
        mantissa = mantissa[1:]
    digits = mantissa.replace(".", "")
    decimal_position = 1 + exponent
    absolute = abs(value)
    if 1e-6 <= absolute < 1e21:
        if decimal_position <= 0:
            rendered = "0." + ("0" * -decimal_position) + digits
        elif decimal_position >= len(digits):
            rendered = digits + ("0" * (decimal_position - len(digits)))
        else:
            rendered = digits[:decimal_position] + "." + digits[decimal_position:]
    else:
        rendered_mantissa = digits[0]
        if len(digits) > 1:
            rendered_mantissa += "." + digits[1:]
        rendered = rendered_mantissa + "e" + ("+" if exponent >= 0 else "") + str(exponent)
    return ("-" if negative else "") + rendered


def _tick_sha256(ticks: list[Any]) -> str:
    digest = hashlib.sha256()
    for tick in ticks:
        serialized = _tick_hash_json_bytes(tick)
        digest.update(str(len(serialized)).encode("ascii"))
        digest.update(b":")
        digest.update(serialized)
    return digest.hexdigest()


def assemble_viewer_container(
    parts: ViewerParts,
    output_path: Path,
    *,
    replay_id: str,
    recorded_at: str,
) -> ViewerContainer:
    load_pinned_contract()
    if not replay_id or not recorded_at:
        raise ViewerDeltaError("Viewer manifest replay_id and recorded_at are required")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    compression_started = time.perf_counter()
    compressor = zstandard.ZstdCompressor(
        level=19,
        write_checksum=True,
        write_content_size=True,
        threads=0,
    )
    chunk_manifests: list[dict[str, Any]] = []
    compressed_paths: list[Path] = []
    chunk_offset = 0
    raw_chunk_bytes = 0
    compressed_chunk_bytes = 0
    validation_ms = 0

    for chunk in parts.chunks:
        raw = chunk.raw_path.read_bytes()
        if len(raw) != chunk.raw_bytes:
            raise ViewerDeltaError("Viewer raw chunk size changed before assembly")
        validation_started = time.perf_counter()
        decoded_first_tick, decoded_ticks = decode_replay_delta_chunk(raw)
        if (
            decoded_first_tick != chunk.first_tick
            or len(decoded_ticks) != chunk.tick_count
        ):
            raise ViewerDeltaError("Viewer raw chunk index does not match its descriptor")
        tick_sha256 = _tick_sha256(decoded_ticks)
        compressed = compressor.compress(raw)
        try:
            round_trip = zstandard.ZstdDecompressor().decompress(
                compressed,
                max_output_size=len(raw),
            )
        except zstandard.ZstdError as error:
            raise ViewerDeltaError("Viewer chunk compression round trip failed") from error
        if round_trip != raw:
            raise ViewerDeltaError("Viewer chunk compression changed encoded bytes")
        validation_ms += round((time.perf_counter() - validation_started) * 1000)
        compressed_path = parts.directory / f"chunk-{chunk.index:05d}.hsrd.zst"
        compressed_path.write_bytes(compressed)
        compressed_sha256 = hashlib.sha256(compressed).hexdigest()
        chunk_manifests.append(
            {
                "index": chunk.index,
                "offset": chunk_offset,
                "firstTick": chunk.first_tick,
                "tickCount": chunk.tick_count,
                "rawBytes": len(raw),
                "compressedBytes": len(compressed),
                "compressedSha256": compressed_sha256,
                "tickSha256": tick_sha256,
            }
        )
        compressed_paths.append(compressed_path)
        chunk_offset += len(compressed)
        raw_chunk_bytes += len(raw)
        compressed_chunk_bytes += len(compressed)

    source_contract = {
        "schema": VIEWER_SCHEMA,
        "profile": VIEWER_PROFILE,
        "profile_revision": VIEWER_PROFILE_REVISION,
        "projection_sha256": VIEWER_PROJECTION_SHA256,
        "tick_count": parts.tick_count,
    }
    manifest = {
        "format": VIEWER_DELTA_FORMAT,
        "sourceContract": source_contract,
        "replayId": replay_id,
        "recordedAt": recorded_at,
        "keyframeInterval": VIEWER_KEYFRAME_INTERVAL,
        "tickCount": parts.tick_count,
        "chunks": chunk_manifests,
        "replay": parts.replay,
    }
    manifest_raw = _compact_json_bytes(manifest)
    manifest_compressed = compressor.compress(manifest_raw)
    try:
        manifest_round_trip = zstandard.ZstdDecompressor().decompress(
            manifest_compressed,
            max_output_size=len(manifest_raw),
        )
    except zstandard.ZstdError as error:
        raise ViewerDeltaError("Viewer manifest compression round trip failed") from error
    if manifest_round_trip != manifest_raw:
        raise ViewerDeltaError("Viewer manifest compression changed bytes")
    total_bytes = (
        VIEWER_CONTAINER_HEADER_BYTES
        + len(manifest_compressed)
        + compressed_chunk_bytes
    )
    uncompressed_bytes = VIEWER_CONTAINER_HEADER_BYTES + len(manifest_raw) + raw_chunk_bytes
    if total_bytes > VIEWER_MAX_ARTIFACT_BYTES:
        raise ViewerDeltaError("Viewer artifact exceeds the API artifact size limit")
    if uncompressed_bytes > VIEWER_MAX_UNCOMPRESSED_BYTES:
        raise ViewerDeltaError("Viewer artifact exceeds the API uncompressed size limit")
    if any(
        value > 0xFFFFFFFF
        for value in (len(manifest_compressed), len(manifest_raw), total_bytes)
    ):
        raise ViewerDeltaError("Viewer container header value exceeds uint32")
    header = struct.pack(
        "<8sHHIIIII",
        VIEWER_CONTAINER_MAGIC,
        VIEWER_CONTAINER_HEADER_BYTES,
        VIEWER_CONTAINER_VERSION,
        1,
        len(manifest_compressed),
        len(manifest_raw),
        total_bytes,
        0,
    )
    digest = hashlib.sha256()
    with output_path.open("wb") as output:
        for value in (header, manifest_compressed):
            output.write(value)
            digest.update(value)
        for compressed_path in compressed_paths:
            with compressed_path.open("rb") as compressed_file:
                for block in iter(lambda: compressed_file.read(1024 * 1024), b""):
                    if not block:
                        break
                    output.write(block)
                    digest.update(block)
    if output_path.stat().st_size != total_bytes:
        raise ViewerDeltaError("Viewer container byte count changed during assembly")
    compression_ms = round((time.perf_counter() - compression_started) * 1000)
    metrics: dict[str, int | float] = {
        "source_projection_duration_ms": parts.projection_duration_ms,
        "chunk_encode_duration_ms": parts.encode_duration_ms,
        "compression_and_assembly_duration_ms": compression_ms,
        "validation_duration_ms": validation_ms,
        "chunk_count": len(parts.chunks),
        "tick_count": parts.tick_count,
        "manifest_raw_bytes": len(manifest_raw),
        "manifest_compressed_bytes": len(manifest_compressed),
        "chunk_raw_bytes": raw_chunk_bytes,
        "chunk_compressed_bytes": compressed_chunk_bytes,
        "artifact_bytes": total_bytes,
        "artifact_uncompressed_bytes": uncompressed_bytes,
        "compression_ratio": total_bytes / uncompressed_bytes,
    }
    return ViewerContainer(
        path=output_path,
        sha256=digest.hexdigest(),
        size_bytes=total_bytes,
        uncompressed_size_bytes=uncompressed_bytes,
        tick_count=parts.tick_count,
        chunk_count=len(parts.chunks),
        manifest=manifest,
        metrics=metrics,
    )


def validate_viewer_container(path: Path) -> dict[str, Any]:
    value = path.read_bytes()
    if len(value) < VIEWER_CONTAINER_HEADER_BYTES:
        raise ViewerDeltaError("Viewer container header is truncated")
    (
        magic,
        header_bytes,
        version,
        manifest_compression,
        manifest_compressed_bytes,
        manifest_raw_bytes,
        container_bytes,
        reserved,
    ) = struct.unpack("<8sHHIIIII", value[:VIEWER_CONTAINER_HEADER_BYTES])
    if (
        magic != VIEWER_CONTAINER_MAGIC
        or header_bytes != VIEWER_CONTAINER_HEADER_BYTES
        or version != VIEWER_CONTAINER_VERSION
        or manifest_compression != 1
        or reserved != 0
        or container_bytes != len(value)
    ):
        raise ViewerDeltaError("Viewer container header is invalid")
    manifest_start = header_bytes
    manifest_end = manifest_start + manifest_compressed_bytes
    try:
        manifest_raw = zstandard.ZstdDecompressor().decompress(
            value[manifest_start:manifest_end], max_output_size=manifest_raw_bytes
        )
    except zstandard.ZstdError as error:
        raise ViewerDeltaError("Viewer manifest decompression failed") from error
    if len(manifest_raw) != manifest_raw_bytes:
        raise ViewerDeltaError("Viewer manifest raw size is invalid")
    try:
        manifest = json.loads(manifest_raw)
    except json.JSONDecodeError as error:
        raise ViewerDeltaError("Viewer manifest JSON is invalid") from error
    if not isinstance(manifest, dict) or manifest.get("format") != VIEWER_DELTA_FORMAT:
        raise ViewerDeltaError("Viewer manifest format is invalid")
    decoded_ticks = 0
    for chunk in manifest.get("chunks", []):
        start = manifest_end + chunk["offset"]
        end = start + chunk["compressedBytes"]
        compressed = value[start:end]
        if hashlib.sha256(compressed).hexdigest() != chunk["compressedSha256"]:
            raise ViewerDeltaError("Viewer chunk compressed hash mismatch")
        try:
            raw = zstandard.ZstdDecompressor().decompress(
                compressed, max_output_size=chunk["rawBytes"]
            )
        except zstandard.ZstdError as error:
            raise ViewerDeltaError("Viewer chunk decompression failed") from error
        first_tick, ticks = decode_replay_delta_chunk(raw)
        if (
            first_tick != chunk["firstTick"]
            or len(ticks) != chunk["tickCount"]
            or _tick_sha256(ticks) != chunk["tickSha256"]
        ):
            raise ViewerDeltaError("Viewer chunk semantic validation failed")
        decoded_ticks += len(ticks)
    if decoded_ticks != manifest.get("tickCount"):
        raise ViewerDeltaError("Viewer manifest tick coverage is invalid")
    return manifest
