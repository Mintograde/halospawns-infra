# Native pistol counters

Exporter 28 reads `blampc_pgcr_stats_pistol_shots_fired` and
`blampc_pgcr_stats_pistol_shots_hit` from each supported source-pinned game
engine. Deterministic host replay re-executes the game's original PGCR
bookkeeping, so the recording does not need separate saved hit events or
an embedded client view to recover these counters. The original game source
is `host/blampc_pgcr_stats.c`; the career CSV writer consumes the same pair.

The game identifies the human pistol by the `\\pistol\\` path segment,
excluding the plasma pistol. A pistol discharge increments fired and arms a
per-player latch. A qualifying weapon-fire damage callback against another
player consumes it and increments hits once. Firing another weapon clears
the pistol latch. These are the game's accuracy counters, not an independently
verified projectile-to-victim history. They do not improve or alter the
three-shot metric, its exclusions, coverage, or examples.

The optional native product is independently versioned:

```json
{
  "schema": "halospawns.h1PistolAccuracy.v1",
  "method": "pgcr_player_latch",
  "boundary_policy": "pre_end_snapshot",
  "players": [{"slot_index": 0, "shots_fired": 100, "shots_hit": 45}]
}
```

Counters follow the existing overall PGCR boundary: retain the last snapshot
before the first `game_ended_this_tick` snapshot. Exclude subsequent firing,
including ambiguous transition-tick activity. The game writes its CSV later
in postgame, so that file can differ if more activity occurs in this interval.
Partial recordings retain observed totals and existing coverage, not a claim
of complete match totals. A participant with no active snapshot has two nulls;
a measured zero remains zero. Extended-roster engines subtract the PGCR baseline
when a new participant occupies a reused physical slot.

The engine exports a private `pistol_counters` field. The encoder validates the
active roster, monotonic integer values and bounds against overall counters,
then removes it before viewer/30 Hz serialization. Only authoritative native
analytics consumes the pair; embedded client worlds discard the private field.
Worker and API validators require this product for exporter 28 and later,
reject it on earlier recipes, and preserve older serialized receipt shapes.

All six engine profiles receive new exporter-28 entries; previous profiles,
recipes, binaries, analytics revisions, viewer formats and client-view recipes
remain. Release registration and activation require
`pistol_accuracy: halospawns.h1PistolAccuracy.v1`. Keep this reader capability
and every recipe on rollback.

Career totals, player/map/category/gametype summaries, records and leaderboards
prefer the paired PGCR measurement. Accuracy is total paired hits divided by
total paired shots. Missing pairs are excluded; older generations keep the
existing combat-attribution fallback. No database migration is required.
Frontend help explains the native-counter source, and frontend edits remain
local. Deployment, native/WASM parity and audited backfill evidence are recorded
in `DEPLOYMENT.md`.
