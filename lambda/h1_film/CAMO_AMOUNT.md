# Per-world player camouflage strength

Handoff: `20261112-svelte-infra-player-camo-amount`.

Exporter 30 adds nullable `player_object_data.camo_amount` to all six supported
host profiles. Separate Beta 5 client exporter 31 adds the same field to its
independent world. Older exporters and recipes retain their exact binaries.
Existing viewer revisions 4/5 already retain this field; match revisions 6–11
contain independent revision-5 worlds. No projection, encoding, or database
migration is needed. API release admission requires
`player_camo_amount: halospawns.h1PlayerCamoAmount.v1`.

## Source and meaning

All six source-pinned families define `_unit_datum.active_camouflage` at unit
offset `0x188`. `unit_update.c` updates its normalized 0–1 strength during normal
simulation, using the active-camouflaged flag and the current weapon's regrowth
rate. The default rise/fall is `0.0083333338 / BLAMPC_TICK_RATE_SCALE` per tick.
The `g_running_simulated_update` exclusion is the engine's rollback path; no
render update is required. `game_engine_weapon_fired.c` applies the weapon's
camo ding and a 0.05 floor. Pickup, expiry, damage and death retain the original
engine behavior. The distinct `active_camouflage_super_amount` is not substituted.

The exporter reads the completed world's field without writing engine state,
running extra updates, or inferring strength from pickup totals. Only finite
values in [0,1] are exported as numbers; invalid state is null. A missing body
remains null, and old artifacts keep the field absent. Client values reflect
that client's replicated/predicted world, including its original quantization;
they need not equal the host at the same numeric clock. Independent frame
ordinals, clocks, alignment and availability evidence are preserved.

`H1_PLAYER_CAMO_AMOUNT` gates the source observation and is part of the builder's
candidate variant. Every new host recipe retains its previous analytics and
viewer revision. Beta 3/Arena/Beta 4 keep analytics 4; Beta 5/6/7 keep analytics 5
and all three gameplay metrics. The release guard scopes melee requirements to
those applicable families while retaining the earlier exporter-29 restrictions.

The local frontend already normalizes `camo_amount` and applies proportional
player/held-weapon opacity; absent or null remains opaque. It does not infer
strength from powerup counts. Frontend work remains local/uncommitted.

## Validation in progress

API 251 (`f7ec001`, CI 43266198330) adds reader admission with no migration.
2,278 local API unit tests pass (six optional skips); all 101 encoder tests pass
(one profiling test ignored), including zero/partial/full/null/absent field
preservation in borrowed, owned and recycled projections.

The reported Hang 'Em High replay `f7a5e10e-2411-4977-8c0c-aa6a82ebd471`
passes packaged initial/viewer/full processing. All five worlds' 352,979 frames
and 1,411,916 snapshots compare exactly after removing only the added field.
All pose bytes and 98 non-world payload entries are unchanged; so are clocks,
verification, prior native metrics, settings, scores, graphs and occupancy.
171,748 snapshots have positive camo. Host and client amounts differ where their
own simulation/replication differs; no host value is copied over client state.

Evidence is under `.build/camo/`. Publication, promotion, full backfill and live
browser validation must be recorded here before the handoff is marked complete.
Rollback must retain the camo reader capability and every registered recipe.
