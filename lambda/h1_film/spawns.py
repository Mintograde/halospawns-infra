"""Semantic validation of versioned, authoritative successful-spawn observations."""

import math


def validate_spawns(product, *, exporter_revision, slots, stop, full_match):
    if (product is not None) != ((exporter_revision or 1) >= 32):
        raise ValueError("Spawn metrics differ from exporter recipe")
    if product is None:
        return
    definition = 2 if exporter_revision >= 34 else 1
    threshold = (
        {"positive_to_neutral_ratio_exclusive": 2.0}
        if definition == 2 else {"maximum_ratio": 0.5, "minimum_gap": 0.1}
    )
    if (
        product.get("schema") != "halospawns.h1SpawnMetrics.v1"
        or product.get("definition_version") != definition
        or product.get("probability_model") != "independent_uniform_squared_ratings_v1"
        or product.get("boundary_policy") != "pre_end_snapshot"
        or product.get("threshold") != threshold
    ):
        raise ValueError("Unsupported spawn definition")
    events = product["events"]
    if len(events) > 8192:
        raise ValueError("Spawn evidence exceeds budget")
    previous, measured, lower, improbable = -1, 0, 0, 0
    seen = set()
    for event in events:
        tick, slot, unit = event["source_tick"], event["slot_index"], event["unit_handle"]
        if (
            type(tick) is not int
            or not 0 <= tick < stop
            or tick < previous
            or type(slot) is not int
            or slot not in slots
            or type(unit) is not int
            or not 0 <= unit < 2**32
            or (slot, unit) in seen
            or (
                event["spawn_index"] is not None
                and (type(event["spawn_index"]) is not int or not 0 <= event["spawn_index"] < 32768)
            )
        ):
            raise ValueError("Invalid spawn identity/clock")
        seen.add((slot, unit))
        previous = tick
        names = (
            "chosen_probability",
            "highest_probability",
            "probability_ratio",
            "probability_gap",
        )
        values = [event[n] for n in names]
        if all(v is None for v in values):
            if event["non_highest"] is not None or event["improbable"] is not None:
                raise ValueError("Unknown spawn cannot be classified")
            if definition == 2 and any(event[n] is not None for n in (
                "chosen_rating", "neutral_probability", "highest_positive_probability",
            )):
                raise ValueError("Unknown spawn cannot have influence evidence")
            continue
        if any(
            type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in values
        ):
            raise ValueError("Invalid spawn probability")
        chosen, highest, ratio, gap = values
        if event["spawn_index"] is None:
            raise ValueError("Measured spawn requires selected point")
        if (
            highest <= 0
            or chosen > highest
            or abs(ratio - chosen / highest) > 1e-10
            or abs(gap - (highest - chosen)) > 1e-10
        ):
            raise ValueError("Inconsistent spawn probabilities")
        non_highest = chosen < highest - 1e-12
        rare = non_highest and chosen <= highest * 0.5 + 1e-12 and gap >= 0.1 - 1e-12
        if definition == 2:
            rare = _neutral_baseline_classification(event, chosen, highest)
        if event["non_highest"] is not non_highest or event["improbable"] is not rare:
            raise ValueError("Spawn classification differs from definition")
        measured += 1
        lower += non_highest
        improbable += rare
    expected = {
        "observed_spawns": len(events),
        "measured_spawns": measured,
        "unknown_spawns": len(events) - measured,
        "non_highest_count": lower,
        "improbable_count": improbable,
    }
    if any(type(product[k]) is not int or product[k] != v for k, v in expected.items()):
        raise ValueError("Spawn totals do not reconcile with evidence")
    complete = full_match and stop > 0 and measured == len(events)
    if product["coverage"] != ("complete" if complete else "partial"):
        raise ValueError("Spawn coverage differs from recording/evidence")


def _neutral_baseline_classification(event, chosen, highest):
    rating = event["chosen_rating"]
    neutral = event["neutral_probability"]
    positive = event["highest_positive_probability"]
    if type(rating) not in (int, float) or not math.isfinite(rating) or rating <= 0:
        raise ValueError("Invalid chosen spawn rating")
    for probability in (neutral, positive):
        if probability is not None and (
            type(probability) not in (int, float)
            or not math.isfinite(probability)
            or not 0 <= probability <= highest
        ):
            raise ValueError("Invalid spawn influence probability")
    # Positive ratings (> 1) outrank every neutral/negative rating in this model.
    if positive is not None and abs(positive - highest) > 1e-10:
        raise ValueError("Positive spawn must have the highest probability")
    if rating > 1 and positive is None:
        raise ValueError("Positive selection requires positive spawn evidence")
    if rating == 1 and (neutral is None or abs(chosen - neutral) > 1e-10):
        raise ValueError("Neutral selection requires matching neutral probability")
    if neutral is not None:
        if (rating < 1 and chosen > neutral) or (rating > 1 and chosen < neutral):
            raise ValueError("Chosen probability differs from spawn influence")
        if positive is None and abs(neutral - highest) > 1e-10:
            raise ValueError("Without positive influence neutral spawns are highest")
    # Strictly more than twice the actual neutral chance; equality does not count.
    # Relative tolerance absorbs integration rounding without imposing an absolute
    # percentage-point floor on small probabilities.
    return (
        neutral is not None
        and positive is not None
        and (rating == 1 or (rating < 1 and chosen < neutral))
        and positive > 2 * neutral
        and not math.isclose(positive, 2 * neutral, rel_tol=1e-12, abs_tol=0)
    )
