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

The final exporter 38 and retained exporter 37 reuse byte-identical exporter-36
engines. All seven profiles, 70 original exporters and every recipe remain
(78 exporters with both additions). Exporter 37 only enables the double-melee
correction; exporter 38 also enables backwhack coverage. Candidate worker r2
was published before the user's clarification and was never activated; the
combined release is r3. Retained recipes preserve their prior results.
Backwhack definition 1, double-melee definition 2, analytics 5, viewer revisions
and proof shapes are unchanged. API support only admits the new Beta 8 recipes.

Local investigation and validation artifacts are under
`.build/report-metrics/`: `coverage-study.mjs`, `coverage-study.json`,
`verify-six.mjs` and `six-film-comparison.json`. Deployment and backfill results
will be recorded here after validation completes.
