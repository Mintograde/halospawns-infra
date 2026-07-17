from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Mapping
from uuid import UUID


SOURCE_COORDINATE_SPACE = "halo1.replay_world.v1"
SOURCE_CELL_SIZE = 0.5
TICKS_PER_SECOND = 30.0
MAX_REGION_SETS = 20
MAX_REGIONS = 100
MAX_COLLECTIONS = 50
MAX_GEOMETRIES_PER_REGION = 16
MAX_GEOMETRIES_PER_SET = 400
MAX_GROUPS = 64
MAX_COUNTER = 9_007_199_254_740_991
STABLE_KEY_PATTERN = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
DISPLAY_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


class RegionStatsError(Exception):
    def __init__(self, error_code: str, safe_message: str) -> None:
        super().__init__(safe_message)
        self.error_code = error_code
        self.safe_message = safe_message


@dataclass(frozen=True)
class CellBounds:
    minimum: tuple[int, int, int]
    maximum: tuple[int, int, int]

    def contains(self, cell: tuple[int, int, int]) -> bool:
        return all(
            lower <= coordinate < upper
            for coordinate, lower, upper in zip(
                cell,
                self.minimum,
                self.maximum,
                strict=True,
            )
        )


@dataclass(frozen=True)
class RegionGeometry:
    minimum: tuple[float, float, float]
    maximum: tuple[float, float, float]
    exact_bounds: CellBounds

    def bounds_for(self, cell_size: float) -> CellBounds:
        if math.isclose(cell_size, SOURCE_CELL_SIZE):
            return self.exact_bounds
        return CellBounds(
            minimum=tuple(
                math.ceil(value / cell_size - 0.5) for value in self.minimum
            ),
            maximum=tuple(
                math.ceil(value / cell_size - 0.5) for value in self.maximum
            ),
        )


@dataclass(frozen=True)
class RegionDefinition:
    set_id: str
    id: str
    key: str
    label: str | None
    display_color: str | None
    geometries: tuple[RegionGeometry, ...]

    def bounds_for(self, cell_size: float) -> tuple[CellBounds, ...]:
        return tuple(geometry.bounds_for(cell_size) for geometry in self.geometries)


@dataclass(frozen=True)
class CollectionDefinition:
    set_id: str
    id: str
    key: str
    label: str | None
    analysis_mode: str
    region_ids: tuple[str, ...]


@dataclass(frozen=True)
class RegionConfiguration:
    revision: int
    hash: str
    coordinate_space: str
    sets: tuple[dict[str, object], ...]
    regions: tuple[RegionDefinition, ...]
    collections: tuple[CollectionDefinition, ...]


class RegionAccumulator:
    def __init__(
        self,
        *,
        claim: Mapping[str, object],
        configuration: RegionConfiguration,
        max_membership_checks: int,
    ) -> None:
        self.claim = claim
        self.configuration = configuration
        self.max_membership_checks = max_membership_checks
        self.games_selected = 0
        self.games_contributing = 0
        self.games_missing_data = 0
        self.incompatible_games = 0
        self.participants_selected = 0
        self.participants_contributing: set[str] = set()
        self.observed_player_ticks_total = 0
        self.discarded_player_ticks = 0
        self.discarded_samples = 0
        self.source_cell_sizes: set[float] = set()
        self.precisions: set[str] = set()
        self.membership_checks = 0
        self._charged_membership_checks = 0
        self._component_count = sum(
            len(region.geometries) for region in configuration.regions
        )
        self.source_cells = 0
        self.group_totals: dict[str, int] = defaultdict(int)
        self.region_totals: dict[tuple[str, str], int] = defaultdict(int)
        self.collection_unions: dict[tuple[str, str], int] = defaultdict(int)
        self.collection_overlaps: dict[tuple[str, str], int] = defaultdict(int)
        self._participants_by_slot: Mapping[int, tuple[str, int | None]] = {}
        self._game_ticks = 0
        self._classify_current_game = False
        self._bounds: dict[str, tuple[CellBounds, ...]] = {}
        self._collection_members = {
            item.id: frozenset(item.region_ids) for item in configuration.collections
        }

    def begin_game(
        self,
        *,
        participants_by_slot: Mapping[int, tuple[str, int | None]],
        document: Mapping[str, object] | None,
    ) -> None:
        self.games_selected += 1
        self.participants_selected += len(participants_by_slot)
        self._participants_by_slot = participants_by_slot
        self._game_ticks = 0
        self._classify_current_game = False
        if document is None:
            return

        ticks_per_second = document.get("ticks_per_second")
        cell_size = document.get("cell_size")
        coverage = document.get("coverage", {})
        if (
            isinstance(ticks_per_second, bool)
            or not isinstance(ticks_per_second, (int, float))
            or not math.isclose(float(ticks_per_second), TICKS_PER_SECOND)
            or isinstance(cell_size, bool)
            or not isinstance(cell_size, (int, float))
            or not _compatible_cell_size(float(cell_size))
            or not isinstance(coverage, Mapping)
            or str(coverage.get("status", "available")) != "available"
        ):
            self.incompatible_games += 1
            return

        normalized_cell_size = float(cell_size)
        self.source_cell_sizes.add(normalized_cell_size)
        precision = (
            "grid_exact"
            if math.isclose(normalized_cell_size, SOURCE_CELL_SIZE)
            else "voxel_center"
        )
        self.precisions.add(precision)
        self.discarded_samples = _checked_add(
            self.discarded_samples,
            _coverage_count(coverage, "discarded_samples"),
        )
        self._bounds = {
            region.id: region.bounds_for(normalized_cell_size)
            for region in self.configuration.regions
        }
        self._classify_current_game = True

    def add_cell(
        self,
        *,
        slot_index: int,
        cell: tuple[int, int, int],
        observed_ticks: int,
    ) -> None:
        if not self._classify_current_game:
            return
        participant = self._participants_by_slot.get(slot_index)
        if participant is None:
            self.discarded_player_ticks = _checked_add(
                self.discarded_player_ticks,
                observed_ticks,
            )
            return
        if (
            self._charged_membership_checks + self._component_count
            > self.max_membership_checks
        ):
            raise RegionStatsError(
                "region_membership_limit_exceeded",
                "Region classification exceeded its configured work limit",
            )

        participant_id, team_index = participant
        group_keys = ("all", _team_group_key(team_index))
        matched_ids: set[str] = set()
        self.source_cells += 1
        self._charged_membership_checks += self._component_count
        self._game_ticks = _checked_add(self._game_ticks, observed_ticks)
        self.observed_player_ticks_total = _checked_add(
            self.observed_player_ticks_total,
            observed_ticks,
        )
        self.participants_contributing.add(participant_id)

        for region in self.configuration.regions:
            for component_bounds in self._bounds[region.id]:
                self.membership_checks += 1
                if component_bounds.contains(cell):
                    matched_ids.add(region.id)
                    break

        for group_key in group_keys:
            self.group_totals[group_key] = _checked_add(
                self.group_totals[group_key],
                observed_ticks,
            )
            for region_id in matched_ids:
                key = (group_key, region_id)
                self.region_totals[key] = _checked_add(
                    self.region_totals[key],
                    observed_ticks,
                )
            for collection in self.configuration.collections:
                match_count = len(matched_ids & self._collection_members[collection.id])
                if match_count:
                    key = (group_key, collection.id)
                    self.collection_unions[key] = _checked_add(
                        self.collection_unions[key],
                        observed_ticks,
                    )
                if match_count > 1:
                    key = (group_key, collection.id)
                    self.collection_overlaps[key] = _checked_add(
                        self.collection_overlaps[key],
                        observed_ticks,
                    )

    def finish_game(self) -> None:
        if self._game_ticks > 0:
            self.games_contributing += 1
        else:
            self.games_missing_data += 1
        self._participants_by_slot = {}
        self._classify_current_game = False
        self._bounds = {}

    def document(self, *, generated_at: str) -> dict[str, object]:
        group_keys = ["all", *sorted(
            (key for key in self.group_totals if key != "all"),
            key=_team_sort_key,
        )]
        if len(group_keys) > MAX_GROUPS:
            raise RegionStatsError(
                "region_group_limit_exceeded",
                "Region classification exceeded its supported team count",
            )
        groups = [self._group_document(group_key) for group_key in group_keys]
        return {
            "schema": "halospawns.regionStatsRollup.v1",
            "scope": {
                "type": self.claim["scope_type"],
                "map_id": self.claim["map_id"],
                "player_id": self.claim["player_id"],
                "eligibility": self.claim["eligibility"],
            },
            "source_revision": self.claim["source_revision"],
            "region_configuration": {
                "revision": self.configuration.revision,
                "hash": self.configuration.hash,
                "coordinate_space": self.configuration.coordinate_space,
            },
            "ticks_per_second": TICKS_PER_SECOND,
            "region_sets": list(self.configuration.sets),
            "groups": groups,
            "summary": self.summary(),
            "generated_at": generated_at,
        }

    def summary(self) -> dict[str, object]:
        return {
            "games_selected": self.games_selected,
            "games_contributing": self.games_contributing,
            "games_missing_data": self.games_missing_data,
            "participants_selected": self.participants_selected,
            "participants_contributing": len(self.participants_contributing),
            "observed_player_ticks_total": self.observed_player_ticks_total,
            "observed_player_seconds_total": (
                self.observed_player_ticks_total / TICKS_PER_SECOND
            ),
            "discarded_player_ticks": self.discarded_player_ticks,
            "discarded_samples": self.discarded_samples,
            "incompatible_games": self.incompatible_games,
            "coverage_complete": (
                self.games_missing_data == 0
                and self.incompatible_games == 0
                and self.discarded_player_ticks == 0
                and self.discarded_samples == 0
            ),
            "source_cell_sizes": sorted(self.source_cell_sizes),
            "membership_precision": _membership_precision(self.precisions),
            "region_membership_checks": self.membership_checks,
        }

    def _group_document(self, group_key: str) -> dict[str, object]:
        observed_total = self.group_totals[group_key]
        team_index = _team_index(group_key)
        regions = []
        for region in self.configuration.regions:
            ticks = self.region_totals[(group_key, region.id)]
            all_ticks = self.region_totals[("all", region.id)]
            regions.append(
                {
                    "region_id": region.id,
                    "key": region.key,
                    "label": region.label,
                    "display_color": region.display_color,
                    "observed_player_ticks": ticks,
                    "observed_player_seconds": ticks / TICKS_PER_SECOND,
                    "share_of_group_observed": _ratio(ticks, observed_total),
                    "share_of_region_observed": (
                        _ratio(ticks, all_ticks) if group_key != "all" else _ratio(ticks, ticks)
                    ),
                }
            )
        collections = []
        for collection in self.configuration.collections:
            member_ticks = sum(
                self.region_totals[(group_key, region_id)]
                for region_id in collection.region_ids
            )
            union_ticks = self.collection_unions[(group_key, collection.id)]
            overlap_ticks = self.collection_overlaps[(group_key, collection.id)]
            outside_ticks = observed_total - union_ticks
            collections.append(
                {
                    "collection_id": collection.id,
                    "key": collection.key,
                    "label": collection.label,
                    "analysis_mode": collection.analysis_mode,
                    "member_ticks": member_ticks,
                    "union_ticks": union_ticks,
                    "outside_ticks": outside_ticks,
                    "overlap_ticks": overlap_ticks,
                    "outside_share": _ratio(outside_ticks, observed_total),
                }
            )
        return {
            "key": group_key,
            "label": _group_label(group_key),
            "team_index": team_index,
            "participant_id": None,
            "observed_player_ticks_total": observed_total,
            "observed_player_seconds_total": observed_total / TICKS_PER_SECOND,
            "regions": regions,
            "collections": collections,
        }


def parse_region_configuration(
    value: object,
    *,
    expected_revision: int,
    expected_hash: str,
) -> RegionConfiguration:
    if not isinstance(value, Mapping):
        raise _configuration_error()
    revision = _positive_int(value, "revision")
    configuration_hash = _sha256(value, "hash")
    coordinate_space = _string(value, "coordinate_space")
    sets_raw = value.get("sets")
    if (
        revision != expected_revision
        or configuration_hash != expected_hash
        or coordinate_space != SOURCE_COORDINATE_SPACE
        or not isinstance(sets_raw, list)
        or not 1 <= len(sets_raw) <= MAX_REGION_SETS
    ):
        raise _configuration_error()

    snapshots: list[dict[str, object]] = []
    regions: list[RegionDefinition] = []
    collections: list[CollectionDefinition] = []
    region_ids: set[str] = set()
    collection_ids: set[str] = set()
    set_ids: set[str] = set()
    set_keys: set[str] = set()
    for set_raw in sets_raw:
        if not isinstance(set_raw, Mapping):
            raise _configuration_error()
        set_id = _uuid(set_raw, "id")
        set_key = _stable_key(set_raw, "key")
        if set_id in set_ids or set_key in set_keys:
            raise _configuration_error()
        set_ids.add(set_id)
        set_keys.add(set_key)
        display_name = _bounded_string(set_raw, "display_name", maximum=160)
        version = _positive_int(set_raw, "version")
        is_default = set_raw.get("is_default", False)
        regions_raw = set_raw.get("regions")
        collections_raw = set_raw.get("collections")
        if (
            not isinstance(is_default, bool)
            or not isinstance(regions_raw, list)
            or not 1 <= len(regions_raw) <= MAX_REGIONS
            or not isinstance(collections_raw, list)
            or len(collections_raw) > MAX_COLLECTIONS
        ):
            raise _configuration_error()

        set_regions: list[dict[str, object]] = []
        set_region_ids: set[str] = set()
        set_region_keys: set[str] = set()
        set_geometry_count = 0
        for region_raw in regions_raw:
            region = _parse_region(region_raw, set_id=set_id)
            if (
                region.id in region_ids
                or region.id in set_region_ids
                or region.key in set_region_keys
            ):
                raise _configuration_error()
            region_ids.add(region.id)
            set_region_ids.add(region.id)
            set_region_keys.add(region.key)
            set_geometry_count += len(region.geometries)
            regions.append(region)
            set_regions.append(
                {
                    "id": region.id,
                    "key": region.key,
                    "display_name": region.label,
                    "display_color": region.display_color,
                }
            )
        if set_geometry_count > MAX_GEOMETRIES_PER_SET:
            raise RegionStatsError(
                "region_configuration_limit_exceeded",
                "The published region configuration exceeded rollup schema limits",
            )

        set_collections: list[dict[str, object]] = []
        set_collection_keys: set[str] = set()
        for collection_raw in collections_raw:
            collection = _parse_collection(
                collection_raw,
                set_id=set_id,
                set_region_ids=set_region_ids,
            )
            if collection.id in collection_ids or collection.key in set_collection_keys:
                raise _configuration_error()
            collection_ids.add(collection.id)
            set_collection_keys.add(collection.key)
            collections.append(collection)
            set_collections.append(
                {
                    "id": collection.id,
                    "key": collection.key,
                    "display_name": collection.label,
                    "analysis_mode": collection.analysis_mode,
                    "region_ids": list(collection.region_ids),
                }
            )

        snapshots.append(
            {
                "id": set_id,
                "key": set_key,
                "display_name": display_name,
                "version": version,
                "is_default": is_default,
                "regions": set_regions,
                "collections": set_collections,
            }
        )

    if len(regions) > MAX_REGIONS or len(collections) > MAX_COLLECTIONS:
        raise RegionStatsError(
            "region_configuration_limit_exceeded",
            "The published region configuration exceeded rollup schema limits",
        )
    return RegionConfiguration(
        revision=revision,
        hash=configuration_hash,
        coordinate_space=coordinate_space,
        sets=tuple(snapshots),
        regions=tuple(regions),
        collections=tuple(collections),
    )


def _parse_region(value: object, *, set_id: str) -> RegionDefinition:
    if not isinstance(value, Mapping):
        raise _configuration_error()
    region_id = _uuid(value, "id")
    key = _stable_key(value, "key")
    label = _optional_bounded_string(value, "display_name", maximum=160)
    color = _optional_bounded_string(value, "display_color", maximum=7)
    if color is not None and not DISPLAY_COLOR_PATTERN.fullmatch(color):
        raise _configuration_error()
    geometries_raw = value.get("geometries")
    if geometries_raw is None:
        geometries_raw = [value.get("geometry")]
    elif (
        not isinstance(geometries_raw, list)
        or not 1 <= len(geometries_raw) <= MAX_GEOMETRIES_PER_REGION
    ):
        raise _configuration_error()
    geometries = tuple(_parse_geometry(item) for item in geometries_raw)
    bounds = {(geometry.minimum, geometry.maximum) for geometry in geometries}
    if len(bounds) != len(geometries):
        raise _configuration_error()
    return RegionDefinition(
        set_id=set_id,
        id=region_id,
        key=key,
        label=label,
        display_color=color,
        geometries=geometries,
    )


def _parse_geometry(value: object) -> RegionGeometry:
    geometry = value
    if not isinstance(geometry, Mapping):
        raise _configuration_error()
    if (
        geometry.get("type") != "axis_aligned_box"
        or geometry.get("coordinate_space") != SOURCE_COORDINATE_SPACE
        or geometry.get("boundary") != "min_inclusive_max_exclusive"
        or not _number_matches(geometry.get("snap_size"), SOURCE_CELL_SIZE)
    ):
        raise _configuration_error()
    minimum = _coordinates(geometry, "min")
    maximum = _coordinates(geometry, "max")
    if any(
        lower >= upper
        or abs(lower) > 1_000_000
        or abs(upper) > 1_000_000
        or not _snapped(lower)
        or not _snapped(upper)
        for lower, upper in zip(minimum, maximum, strict=True)
    ):
        raise _configuration_error()
    exact_bounds = CellBounds(
        minimum=tuple(round(value / SOURCE_CELL_SIZE) for value in minimum),
        maximum=tuple(round(value / SOURCE_CELL_SIZE) for value in maximum),
    )
    return RegionGeometry(
        minimum=minimum,
        maximum=maximum,
        exact_bounds=exact_bounds,
    )


def _parse_collection(
    value: object,
    *,
    set_id: str,
    set_region_ids: set[str],
) -> CollectionDefinition:
    if not isinstance(value, Mapping):
        raise _configuration_error()
    collection_id = _uuid(value, "id")
    key = _stable_key(value, "key")
    label = _optional_bounded_string(value, "display_name", maximum=160)
    analysis_mode = _string(value, "analysis_mode")
    region_ids_raw = value.get("region_ids")
    if (
        analysis_mode not in {"partition", "overlay"}
        or not isinstance(region_ids_raw, list)
        or len(region_ids_raw) > MAX_REGIONS
    ):
        raise _configuration_error()
    region_ids = tuple(_uuid_value(item) for item in region_ids_raw)
    if len(set(region_ids)) != len(region_ids) or not set(region_ids).issubset(set_region_ids):
        raise _configuration_error()
    return CollectionDefinition(
        set_id=set_id,
        id=collection_id,
        key=key,
        label=label,
        analysis_mode=analysis_mode,
        region_ids=region_ids,
    )


def _compatible_cell_size(value: float) -> bool:
    return (
        math.isfinite(value)
        and SOURCE_CELL_SIZE <= value <= 1_000
        and math.isclose(value / SOURCE_CELL_SIZE, round(value / SOURCE_CELL_SIZE))
    )


def _coverage_count(coverage: Mapping[str, object], key: str) -> int:
    value = coverage.get(key, 0)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return 0
    return int(value)


def _checked_add(current: int, value: int) -> int:
    result = current + value
    if result > MAX_COUNTER:
        raise RegionStatsError(
            "region_counter_overflow",
            "A region rollup counter exceeded its supported range",
        )
    return result


def _membership_precision(precisions: set[str]) -> str:
    if len(precisions) > 1:
        return "mixed"
    return next(iter(precisions), "grid_exact")


def _team_group_key(team_index: int | None) -> str:
    return "team:none" if team_index is None else f"team:{team_index}"


def _team_sort_key(group_key: str) -> tuple[int, int]:
    if group_key == "team:none":
        return (1, 0)
    return (0, int(group_key.removeprefix("team:")))


def _team_index(group_key: str) -> int | None:
    if group_key in {"all", "team:none"}:
        return None
    return int(group_key.removeprefix("team:"))


def _group_label(group_key: str) -> str:
    if group_key == "all":
        return "All players"
    team_index = _team_index(group_key)
    return "No team" if team_index is None else f"Team {team_index}"


def _ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _configuration_error() -> RegionStatsError:
    return RegionStatsError(
        "invalid_region_configuration",
        "The pinned region configuration was invalid",
    )


def _positive_int(values: Mapping[str, object], key: str) -> int:
    value = values.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise _configuration_error()
    return value


def _string(values: Mapping[str, object], key: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value:
        raise _configuration_error()
    return value


def _bounded_string(values: Mapping[str, object], key: str, *, maximum: int) -> str:
    value = _string(values, key)
    if len(value) > maximum:
        raise _configuration_error()
    return value


def _optional_bounded_string(
    values: Mapping[str, object],
    key: str,
    *,
    maximum: int,
) -> str | None:
    value = values.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise _configuration_error()
    return value


def _stable_key(values: Mapping[str, object], key: str) -> str:
    value = _bounded_string(values, key, maximum=80)
    if not STABLE_KEY_PATTERN.fullmatch(value):
        raise _configuration_error()
    return value


def _uuid(values: Mapping[str, object], key: str) -> str:
    return _uuid_value(values.get(key))


def _uuid_value(value: object) -> str:
    if not isinstance(value, str):
        raise _configuration_error()
    try:
        return str(UUID(value))
    except ValueError as error:
        raise _configuration_error() from error


def _sha256(values: Mapping[str, object], key: str) -> str:
    value = _string(values, key).lower()
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise _configuration_error()
    return value


def _coordinates(
    values: Mapping[str, object],
    key: str,
) -> tuple[float, float, float]:
    raw = values.get(key)
    if not isinstance(raw, Mapping):
        raise _configuration_error()
    coordinates = tuple(_finite_number(raw.get(axis)) for axis in ("x", "y", "z"))
    return coordinates  # type: ignore[return-value]


def _finite_number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _configuration_error()
    normalized = float(value)
    if not math.isfinite(normalized):
        raise _configuration_error()
    return normalized


def _number_matches(value: object, expected: float) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(float(value))
        and math.isclose(float(value), expected)
    )


def _snapped(value: float) -> bool:
    return math.isclose(value / SOURCE_CELL_SIZE, round(value / SOURCE_CELL_SIZE))
