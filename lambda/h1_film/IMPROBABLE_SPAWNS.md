# Improbable spawns (random randoms)

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
