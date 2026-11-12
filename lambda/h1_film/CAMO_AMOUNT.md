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

## Validation

API 251 (`f7ec001`, CI 43266198330) adds reader admission with no migration.
2,278 local API unit tests pass (six optional skips); all 101 encoder tests pass
(one profiling test ignored), including zero/partial/full/null/absent field
preservation in borrowed, owned and recycled projections.

All six native/WASM host comparisons and the separate Beta 5 client comparison
pass: 326,877 ticks / 2,726 hashes, with byte-identical full transport streams.
Observed nonzero strengths include pickup fades, firing suppression, expiry and
death; fixtures without a pickup correctly remain zero. The 183 Node, 114
packaged worker, 1,819 viewer and 847 site tests pass, along with both frontend
builds. The separate client fixture also verifies independent clocks and retry
receipts. All six retained host recipes and retained client exporter 13 produce
their original viewer bytes and statistics.

The complete 19-case camo corpus preserves 39 worlds / 1,565,501 frames /
6,810,157 player snapshots after removing only the new field, plus exact pose
bytes and 542 non-world payload entries. The separate client preserves another
5,134 frames. Existing analytics, scores, graphs, occupancy and settings agree.

The reported Hang 'Em High replay `f7a5e10e-2411-4977-8c0c-aa6a82ebd471`
passes packaged initial/viewer/full processing. All five worlds' 352,979 frames
and 1,411,916 snapshots compare exactly after removing only the added field.
All pose bytes and 98 non-world payload entries are unchanged; so are clocks,
verification, prior native metrics, settings, scores, graphs and occupancy.
171,748 snapshots have positive camo. Host and client amounts differ where their
own simulation/replication differs; no host value is copied over client state.

## Dev deployment and complete backfill

Dev worker/default **20261112-r3**, policy **29**, and API **252**
(`93a0308`, CI **43284914787**) are deployed. API 251 (`f7ec001`) first
added camo reader admission; API 252 fixes regenerated host identity lookup.
The image digest is
`sha256:e328ce0e061fcfec25120da02981d30b5a566df376700333fd4049c23d14aef5`. Six profiles / 52 exporters retain every old recipe;
new host defaults use exporter 30 and the separate Beta 5 client uses 31.
No migration, frontend deployment or prod action occurred. Frontend changes
remain local/uncommitted. Memory stays 3008 MB, concurrency/SQS maximum 50,
batch size 1, and worlds run sequentially.

Candidate r2 was installed but never activated; its two inventory checks hit
the former 180-second limit. Final r3's cold full-inventory check also reached
its 300-second bound. The complete warm inventory passed, and guarded resumption
rechecked the exact API version/hash, manifest, worker image/environment digest,
runtime settings, expected policy 28 and all saved exact callback evidence before
activating policy 29. Original failed health evidence remains. Do not promote r2.
All 19 final packaged outputs and the separate client are byte-identical to the
r2 camo corpus. Six retained host recipes / 18 API callbacks and client exporter
13 preserve their original bytes, timelines and statistics.

The bounded health path uses 1 MiB sequential hash reads, a 300-second inventory
limit and 330-second caller; normal job deadlines and all verification remain.
API 252 CI passes 2,280 tests (331 opt-in/fixture skips); the local full unit
suite passes 2,278, plus 34 PostgreSQL client/generation cases. Its exact deployed
ZIP also accepts all 19 packaged cases / 57 callback modes and separate client.

All 282 applicable existing games have selected camo generations:
76 audited batches / 282 successful attempts, with no failures.
The six completed separate Beta 5 client recordings were regenerated through
fresh audited attachments to their new hosts, preserving every original upload
and attempt (including the two old failed clients). Their 428,941
frames / 1,418,192 player snapshots differ only by camo;
poses, source hashes, verification and timeline clocks are unchanged.

The first fresh client attempt exposed an existing host-generation reader bug:
API 251 returned the original conversion's exporter 12 pin alongside the new
exporter 30 host. The worker rejected it before simulation. API 252 resolves
the exact successful reparse identity with all source/generation fences intact.
The failed attempt remains; its audited retry succeeded. Six new PostgreSQL
regressions, 28 existing client lifecycle cases and the full unit suite pass.

Every previous native statistic, scoreboard/graph/occupancy hash and source pin
is unchanged across all 282 games. The 78 legacy viewer files and
204 match containers now carry the added field; all
19,431 non-world match payload entries remain exact.
All original history is preserved: 311 conversions / 1,508 receipts / 1,230 H1 attempts / 360 approvals.
The client tables contain 14 uploads / 15 attempts.
Final inventory finds no applicable old selected recipe or active reparse.
All six dev postplans are no-op. No visible/delayed work or DLQ messages remain. Two original SQS deliveries
are still in flight under the unchanged 90-minute visibility timeout; both
attempts are completed/selected after exact frozen-job redelivery replayed their
saved completion manifests. They will acknowledge their cached receipts on
automatic redelivery. Do not purge or replace the originals.

Live API/CDN range, CORS and complete SHA-256 checks pass for the reported
Hang 'Em High canary. All five worlds verify 352,979 ticks / 2,945 hashes with
zero mismatches. Chrome at 1440x900 and 390x844 checks host and client zero,
partial, full and backward-seek restoration against exact recorded values.
Skinned-body and held-weapon materials follow proportional opacity; independent
client quantization is retained. Screenshots show visible fades, with no page
errors or overflow. The browser uses the normal replay scrub gate to hold a
frame while progressive loading retains its playback intent.

Evidence: `.build/camo/final-audit.json`, `compare-all-summary.json`,
`live-client-comparison.json`, `browser-live.json`, `postcheck.json`,
`history-before.json` / `history-after.json`, and the retained package/parity
reports. Promotion evidence is in
`.build/h1-promotions/20261112-181604-aad591e52b4a49d581dab0e0f37ea204/`;
the successful bounded warm health is `.build/camo/warm-health-r3.json`.
Rollback must retain the camo reader capability, every registered recipe and
the original immutable generations.
