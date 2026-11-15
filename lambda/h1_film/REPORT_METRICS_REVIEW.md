# Original-report timing and statistic coverage

## November 15, 2026 review

The user asked whether the host-only double-melee approach could also improve
three-shot kills. The review covers the six supplied Beta 8 recordings and the
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
nine to four. Backwhacks, three-shot results and all other statistics retain
their prior results. The Fallout dstny total becomes complete; Seizen's
confirmed example remains intact.

The new four exporter recipes reuse byte-identical exporter-36 engines. All
seven profiles, 70 previous exporters and every old recipe remain. The worker
gates the correction at exporter 37; retained recipes preserve their prior
results. Double-melee definition 2, analytics 5, viewer revisions and proof
shapes are unchanged. API support only admits the new Beta 8 recipe.

Local investigation and validation artifacts are under
`.build/report-metrics/`: `coverage-study.mjs`, `coverage-study.json`,
`verify-six.mjs` and `six-film-comparison.json`. Deployment and backfill results
will be recorded here after validation completes.
