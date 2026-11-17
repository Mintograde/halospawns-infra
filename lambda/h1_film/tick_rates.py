"""Recorded clocks supported by the pinned engine sources."""

TICK_RATE_EXPORTER = 40
TICK_RATE_CONTRACT = "halospawns.h1TickRates.v1"
SWITCHABLE_PROTOCOLS = frozenset((9803, 9818, 9839, 9844, 9848))


def supported_tick_rates(profile):
    return (30, 120) if profile.get("protocol_revision") in SWITCHABLE_PROTOCOLS else (120,)


def supports_tick_rate(profile, rate):
    return type(rate) is int and rate in supported_tick_rates(profile)


def source_rate_key(rate):
    return "120hz" if rate == 120 else "source"


def source_replay_name(rate):
    return f"replay.{source_rate_key(rate)}.hsrdc"


def analytics_stride(rate):
    if type(rate) is not int or rate not in (30, 120):
        raise ValueError("Unsupported film tick rate")
    return rate // 30


def playback(rate):
    analytics_stride(rate)
    return {"tick_rate": rate, "source_tick_rate": rate, "animation_tick_rate": 30}
