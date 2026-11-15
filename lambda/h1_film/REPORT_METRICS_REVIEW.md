# Original-report timing and statistic coverage

## November 15, 2026 review

The user asked whether the host-only double-melee approach could also improve
three-shot kills and clarified that backwhacks were the other intended metric.
The review covers the six supplied Beta 8 recordings and the
90 distinct Beta 5/6 cases from `HOST_SHOT_EVALUATION.md`. Original recordings
are hash-checked and the instrumented reducer must reproduce the production
result before its diagnostic classifications are inspected.

All 1,497 unresolved three-shot classifications lack every original discharge
identity in their encounter. All have a confirmed headshot finisher. There are
1,182 encounters with three reported damage contexts, 258 with four and 57 with
five. No case is caused by duplicate accounts, capped shot/pull tables, fewer
than three damage contexts or four already resolved original discharges.

The accepted host reports retain the original client impact clock and reliable
identity. They do **not** retain the original firing sequence or unreported
misses. A projectile's impact clock is not its firing clock. Weapon firing
cooldowns also belong to individual weapon objects; a timing-only argument
cannot silently assume away switching, pickups or projectile travel.

The regression in `tests/gameplay-source.test.mjs` now explicitly compares two
histories with identical reliable host reports and original client hit clocks.
One is three consecutive hits; the other includes a miss with no report.
Original accounts distinguish them, while host-only evidence leaves both
unknown. This supplements the earlier host-shot/geometry counterexample.
Verified three-shot counts, definitions and separately labelled estimates are
therefore preserved. The review does not establish additional verified kills.

## Double-melee coverage correction

The host can prove a different useful fact. A victim may die to a self/friendly
grenade while the engine awards kill credit to an earlier enemy attacker. The
credited death weapon is unknown, so the old reducer also marked the double
melee classification unknown. The actual lethal damage proves a non-melee
finisher and excludes a double melee.

Exporter 37 enables this negative proof only when the credited death category
is unknown and the most recent damaging callback matches the exact victim body
and source tick, reduces positive health to zero, and has a known non-melee
category. Missing damage, different bodies/ticks, unknown categories, nonlethal
damage and contradictory death evidence retain uncertainty. An environmental
owner alone is insufficient: Exhibit contains a dead player's unowned host
melee at tick 52904. That case remains unknown.

Across the six supplied films, the correction preserves all five verified
doubles and resolves five false unknowns: two Exhibit grenade finishers and
one each in Dread, Hangemhigh and Fallout. Unknown classifications fall from
nine to four. Three-shot results and all other statistics retain
their prior results. The Fallout dstny total becomes complete; Seizen's
confirmed example remains intact.

## Backwhack investigation and correction

Backwhacks already use authoritative host damage, including remote clients.
The hook is inside the branch that actually depletes a live body's health after
the engine's assassination check. It is independent of the attacker's client
film and of ordinary instant kills, cheats and non-damaging predictions.
Successful backwhacks need both the actual damage and death observations.
Facing alone and original report timing cannot replace that branch evidence.

The current 342-game set has 251 verified backwhacks and 268 unknown kill
classifications across 151 games. Every such game is already among the 174
games selected for the double-melee coverage review.

Exporter 38 extends the finisher proof to backwhacks. A confirmed non-melee
finisher excludes a backwhack. Alternatively, when both the actual lethal
damage and its death explicitly report that the assassination branch did not
execute, the unknown credited weapon cannot make the kill a backwhack. The
same exact-body, same-tick and positive-health-to-zero requirements apply.
Missing/conflicting branch observations and an unowned actual assassination
remain unknown. This corrects negative classifications; it does not invent a
positive kill from missing attribution.

All nine backwhack unknowns in the supplied films are resolved by these rules,
including the unowned ordinary melee in Exhibit. Its double-melee classification
appropriately stays unknown. All existing backwhack and double-melee examples
are retained exactly.

An additional real Beta 5 Dammy case verifies why cross-attacker assassinations
remain unresolved. In game `80d17853-d7f1-4f85-8e6d-61778e0b2ae7` at tick
44667, slot 3's friendly melee triggers the actual assassination branch on
slot 4, while the engine credits enemy slot 5 with the kill. Both branch flags
are true. This release neither awards slot 5 a verified backwhack nor uses the
new negative branch proof to resolve that conflict. The exact original film
and map reproduce all 52,972 ticks / 442 hashes with zero mismatches, and the
instrumented reducer matches the live product. Evidence is in
`.build/report-metrics/unresolved-beta5-analysis.json`.

The final exporter 38 and retained exporter 37 reuse byte-identical exporter-36
engines. All seven profiles, 70 original exporters and every recipe remain
(78 exporters with both additions). Exporter 37 only enables the double-melee
correction; exporter 38 also enables backwhack coverage. Candidate worker r2
contains only the double-melee correction and was never activated; the combined
release is r3. Retained recipes preserve their prior results.
Backwhack definition 1, double-melee definition 2, analytics 5, viewer revisions
and proof shapes are unchanged. API support only admits the new Beta 8 recipes.

Local investigation and validation artifacts are under
`.build/report-metrics/`: `coverage-study.mjs`, `coverage-study.json`,
`verify-six.mjs`, `verify-six-r3.mjs` and their comparison JSON. Source-bound
positive/negative fixtures also run in `tests/melee-finishers.test.mjs`.

## Dev deployment

Worker/default `20261115-r3` is active at policy 36 with API 274. The worker
runtime source is `16c067a`; its immutable image is
`sha256:0556e44abbb6929de8b51c0706570b94cfa0c6ed8bddcda00d824ad3914747cd`.
API source `e8bf153f4cc2b72f78ff5b3f061035b839910508` passed CI 43743933684;
all 220 deployed Python files match that commit. API 273 was an intermediate
compatible reader before the combined exporter-38 support in API 274.

All 262 Node tests, 122 packaged worker tests and 2,441 API CI tests pass
(396 opt-in API skips). Fifteen final packaged replay cases / 45 exact deployed
API callbacks pass, including the known Fallout and independent Exhibit
double melees. Five retained cases / 15 callbacks preserve exporter-36 and
exporter-37 behavior. Separate client flow preserves viewer bytes and clocks.
All other native statistics, every positive melee example and all packaged
viewer bytes are unchanged. The engines are the exact already-verified
exporter-36 binaries; this release changes the reducer, not simulation.

The narrow map-processing plan changed only the worker. A guarded API state
refresh recorded version 274 with zero resource actions. The first full live
health check passed before guarded policy activation. All six postplans are
no-op. Memory remains 3008 MB, reserved/SQS concurrency 50, batch size 1 and
sequential worlds. There is no migration or frontend/production deployment.

Local Docker initially ran out of space during packaged validation. Only two
audited, unshared local engine-copy build-cache records were pruned (5.7 GB).
No image, volume, source recording or recipe was removed. Publication resumed
with the same immutable r3 image; the failed evidence directory is retained.

Release evidence is in `.build/report-metrics/`,
`.build/h1-releases/20261115-r3-publication/` and
`.build/h1-promotions/20261115-180758-3ecbfa4a167a4c54853b1de360a368b3/`.
The historical refresh used four canaries and at most 20 outstanding
attempts, with at most four games / 230 MiB of source and map data per batch.

## Completed historical refresh and live validation

All 174 affected games succeeded and selected exporter-38 viewer/statistics
generations in 67 audited batches, without failures, retries or concurrent
arrivals. The unaffected 219 games retain their exact selected artifacts and
statistics. Across all 342 measured games, verified counts and examples remain
251 backwhacks / 119 doubles. Unknown classifications decrease from 268 to
1 for backwhacks and 357 to 201 for doubles.
Complete player appearances increase from 1,243 to 1,451 and
1,186 to 1,295, respectively. Previously verified kills
now admitted into complete totals raise their sums from 203 to
241 backwhacks and 80 to 92 doubles.
Partial recordings remain partial even with no unknown kill classifications.
All three-shot observed counts (2,460), complete totals (2,437), coverage,
estimates and every unrelated statistic are unchanged.

All 19 standalone viewer files retain their complete hashes;
all 16,728 logical payload entries in 155 match
files retain their original sizes and hashes. World identity, clocks and
verification remain. The three affected separate client views are reattached
through fresh audited uploads of their exact retained sources, preserving
293,175 frames / 2,445 verified hashes and all original clocks.
The other three attached views remain on unchanged hosts.

The server-hashed immutable-history comparison preserves all original
conversions, receipts, map approvals and settings snapshots. The independent
audit preserves all original H1 attempts and client rows. Totals are
442 conversions / 2,756 receipts / 2,367 H1 attempts / 474 approvals /
2,620 settings snapshots, plus 35 client uploads / 36 client attempts.

Live API game, statistics, scoreboard and graph responses match the selected
native products for four engine canaries. CDN full hashes, range requests and
CORS pass. Real Chrome desktop/mobile checks verify complete Fallout backwhack
totals, Seizen and dstny double-melee totals, all four review events, paused
seeks, playback and dstny/host perspective switching. Queue and DLQ are empty;
no active attempts remain. The deployment requires no additional frontend code.

Evidence includes `compare-all-summary.json`, `inventory-after-summary.json`,
`totals-before.json`, `totals-after.json`, `history-hashed-after.json`,
`client-verification-summary.json`, `live-verification.json`,
`browser-verification.json`, `career-overview-summary.json` and
`operational-verification.json` under `.build/report-metrics/`.

Rollback must retain the compatible API readers, all seven profiles / 78
exporters, every recipe, all original generations and the new coverage results.
Use the guarded promotion workflow for a retained release; never repin an
existing attempt. Candidate r2 remains published but must not be activated.
