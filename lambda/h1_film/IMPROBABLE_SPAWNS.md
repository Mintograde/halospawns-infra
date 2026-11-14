# Improbable spawns (random randoms)

## Dev deployed and backfilled (2026-11-14)

All 339 original games and six separate client views have selected new results.
API 265 / worker-default 20261114-r1 / policy 33 remain active. Original evidence,
statistics and replay payloads are preserved; concurrent manual uploads are
tracked separately. Frontend changes remain local/uncommitted. Full release and
backfill evidence is below and in the completed handoff.

### Neutral-baseline definition 2

Exporter 34 reuses the existing exporter-32 binaries (including Beta 7's
exporter-33/viewer-12 recipe). All six host defaults in the active registry
use 34, all previous recipes remain, and separate-client exporter 31 is unchanged.
The new capability is `spawn_neutral_baseline: halospawns.h1SpawnMetrics.v1`.
The new worker/default is active in dev; all prior releases and pins remain.

Count a neutral selection, or a negative selection with lower probability than
neutral, only when a positive point exceeds twice an **actual** neutral point's
probability. Equality is excluded, with 1e-12 relative rounding tolerance; there
is no absolute gap floor. Net engine rating defines influence: 1 neutral, >1
positive, 0<rating<1 negative. Do not synthesize a neutral point when none exists.
Offsetting influences with final rating 1 are net neutral.

The producer preserves `chosen_rating`, `neutral_probability` and
`highest_positive_probability` for every event, including unflagged events.
Missing neutral/positive candidates are null; unknown selection remains unknown.
The unchanged engine observation hooks supply this evidence. Old recipes still
produce definition 1 byte-for-byte. API and worker independently validate both.

The API now derives current `spawn_metrics.analysis` at read time from the
retained inputs. Its definition version, count, selected event indexes and help
text can change in an API release without a worker release, reparse or frontend
change. The original ingestion definition remains frozen for receipt/retry audit.
This compact per-event evidence supports ratio/gap/net-influence rules; complete
candidate distributions and spatial context are not retained. See the API's
`docs/h1film-spawn-metrics.md` for the supported scope and future-change workflow.

Old completion manifests and replay artifacts do not contain the temporary full
rating vectors. Old games need one full reparse to obtain the new inputs. The authorized
backfill is complete. Compatible API readers,
exact packaged callbacks and guarded promotion are verified. Keep both
definitions, capability readers and every old recipe on rollback.

## November 14 deployment and completed backfill

The user-authorized neutral-baseline backfill is complete in dev: all 339
original games have successful selected exporter-34 generations. API 265
(`42bd83d`, CI 43562257607), worker/default 20261114-r1 and policy 33 remain.
The original 48 submissions were reconciled before the remaining 291 resumed;
all 112 immutable batch intents have confirmed responses. The user's concurrent
uploads are separate: 36 new games were observed at the final audit. Frontend
changes remain local/uncommitted, including the separate Overview panel removal.
No frontend or prod deployment occurred.

The original games retain 33,371 observed spawns (33,371 measured), 689 random
randoms and 7,367 non-highest selections. Coverage is 311 complete / 28 partial
games, with 0 unknown observed spawns. Definition 2 requires an actual neutral
point; positive odds must be strictly more than twice its chance. Every event
retains the evidence for API-only rule changes. Alternate thresholds were
checked without modifying stored products or frozen classifications.

All prior statistics, observations, graph/occupancy hashes and source pins are
preserved. All 78 legacy viewer files and 27,918 logical entries in 261 match
artifacts remain. Six separate client views are reattached through audited
uploads, with identical viewer bytes, original clocks and exporter 31 (428,941
frames / 3,578 hashes). All original history remains; the resume baseline of
1,895 receipts, 388 conversions, 380 approvals and 1,759 settings snapshots has
identical logical hashes. The earlier receipt-hash bridge and original
attempt/client records also pass preservation checks.

Database allocation is 410,852,149 / 500,000,000 bytes at the final audit,
including concurrent uploads. All 291 resumed host completions use the compact
response contract; their maximum acknowledgement is 487 bytes. The original 48
receipts remain intact. All 15 native canary reads pass on API 265. Feature
validation passed 2,348 API tests, 204 Node / 121 worker Python tests, 856 site
tests and both frontend builds. All 21 packaged host cases / 63 exact API
callbacks, six retained cases / 18 exact callbacks and the separate client flow
passed. Live canaries passed CDN range/CORS/full-hash checks. All six resumed
dev infrastructure plans are no-op. Batches stayed within four games / 230 MiB
and 20 outstanding host attempts. The film queue and DLQ are empty at the final
operational check. Keep every old recipe, both spawn definitions, compatible
analysis/storage readers and forward migrations on rollback.

Evidence: infra `.build/spawn-neutral-baseline/COMPLETED.json`,
`compare-all-summary.json`, `inventory-after-summary.json`,
`history-resume-summary.json`, `client-verification-summary.json`,
`storage-final.json`, `operational-final-confirmed.json` and
`postplans-resume.log`. The original pause is retained as
`PAUSED-20261114T035241Z.json`; authorization and live pins are in
`RESUME-APPROVED.json` and `api-pin-resume.json`.

## Historical definition-1 deployment

Dev deployment complete: API 253, worker/default 20261112-r4, policy 30.
All 282 eligible games and six current separate client views have selected
generations. See DEPLOYMENT.md for totals, preservation evidence and recovery.
The frontend is implemented and tested locally, with paused review links.


Definition 1 counts a successful spawn as improbable when its modeled selection
probability is at most half the highest probability **and** at least 10 percentage
points below it. A separate non-highest count includes every strictly lower
probability selection; tied maxima never count. Classification uses a 1e-12
comparison tolerance. Initial spawns and respawns both count.

The game-level product is `native_analytics.spawn_metrics`, with schema
`halospawns.h1SpawnMetrics.v1`. It contains the definition and probability-model
versions, threshold, observed/measured/unknown counts, non-highest and improbable
counts, coverage, and every observed event. Events retain player slot, source tick,
unit handle, selected spawn index, chosen/highest probabilities, ratio, gap and
classification. Missing selection evidence has null probabilities and flags.
Saved probabilities permit later threshold analysis without simulating again.
Changing the published definition requires a new version; old results stay intact.

## Observations and probability model

All six exact source profiles use the maximum positive `rating * sqrt(U)` score.
The hooks copy each rating inside that actual selection loop without evaluating
ratings again, consuming randomness, or changing simulation state. An event is
committed only after a player receives its successfully created unit. Failed
attempts never count. Forced spawns have unknown probabilities. Observed player
body births without selection hooks also count as unknown, with a null spawn
index. Only the authoritative host contributes game statistics; embedded and
separate clients cannot duplicate events.

The model `independent_uniform_squared_ratings_v1` uses independent continuous
uniform draws. Squaring positive ratings gives weights w; for candidate k,
P(k wins) is the integral from 0 to w[k] of F(t)/t, where
F(t) = product(min(1,t/w[i])). The implementation integrates piecewise in log
space. Ratings [1,2] give probabilities [1/8,7/8], not [1/3,2/3]. Nonpositive
ratings have zero probability. The actual engine uses discrete, correlated LCG
draws (high 16 bits divided by 65535), floating-point scoring and first-wins
ties. These are modeled probabilities, not exact finite-PRNG odds. The unrelated
HUD teammate-nearby random percentage is not this metric.

The product uses the existing pre-end snapshot boundary: the end-transition
frame and postgame events are excluded. Complete coverage requires the recording
to start at clock zero, observe the match end, have a positive retained window,
and measure every observed spawn. Otherwise counts are lower bounds, even when
every event in a partial recording was measured. Old products omit this field;
absence must never become a measured zero.

## Implementation and release contract

Exporter 32 adds host observations for all six profiles; all prior recipes and
exporters remain. Analytics and viewer revisions are unchanged. Separate client
exporter 31 remains unchanged. The release capability `spawn_metrics` is required
for exporter 32 and compatible API readers. No database migration is required.

`engines/beta3/spawn-events.h` captures bounded observations. The Rust encoder
removes private spawn evidence before viewer serialization and writes a bounded
private stream. `runtime/spawn-probabilities.mjs` and `spawn-metrics.mjs` derive the
product. Worker/API validation checks clocks, participant membership, duplicate
unit identities, finite bounded probabilities, arithmetic, classifications,
coverage and counts. Existing native statistics and viewer payloads are retained.

The local site shows a Spawn luck panel on game Overview, with both counts,
measured coverage, the definition and model explanation. Expandable event rows
link to the player/time in the replay; an option includes every non-highest
selection. Partial totals have a + indicator. Legacy games omit the panel.

## Validation and deployment evidence

Evidence is under `.build/spawns/`. API 253 (`7cc59dc`, CI 43356594104) adds
compatible validated readers. Worker publication/deployment and backfill status
are recorded in DEPLOYMENT.md and the task handoff.

All six source-pinned native/WASM recordings pass recorded-state verification.
Five exports are byte-identical across runtimes. Beta 3 has 25 newly observed
rating values differing by one float ULP; every pre-existing field, spawn choice
and classification is identical. The largest probability/ratio/gap difference
is 1.435e-7. Raw observations are preserved without rounding to hide this
arithmetic difference. `rating-parity.log` and `parity-beta3/parity.json` record
the bounded comparison; the initial strict byte-comparison failure is retained.
Every profile's prior exported fields match the camo baseline exactly.

Rollback must retain the spawn-metrics reader/capability, all engines, old and new
recipes, published generations, and audited reparse history. Rollback changes
future defaults; it must not rewrite previous evidence.
