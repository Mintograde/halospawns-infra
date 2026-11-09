# Derived gameplay metrics

Analytics 5 / native v3 adds `halospawns.h1GameplayMetrics.v1`. Metric IDs,
definition versions, participant coverage and replay examples form the shared
contract for future reducers. Existing native metrics and combat are retained.
The metric is `pistol_three_shot_kills`. Definition 2 adds partial-health targets
and requires an observed headshot finisher; definition 1 remains frozen for old recipes.

## Counting rule

Definition 2 requires normal shields of 1 before the first hit and any positive
remaining health. The third shot must trigger the engine's instant-headshot kill
branch. A confirmed headshot counts even when a body shot would also have been
lethal; bodyshot finishers never count. Missing headshot evidence remains unknown.
No health cutoff or inferred damage threshold is used. The existing engine hook
observes the actual headshot branch, including accepted host network damage.
API and worker validators independently require the referenced combat death's
`headshot: true` for both verified examples and starred review candidates.

Exactly three
distinct, consecutive pistol discharges from one opponent must kill that victim.
Intervening misses and other weapon discharges disqualify the kill. Other damage
(including self/environment/team damage), a different victim object lifetime,
or vitality recovery during the encounter also disqualify it. Duplicate damage
callbacks from a single discharge count once. Restored full normal shields start
a new encounter; overshields are not normal fresh shields. Grenade throws do not
advance the firearm sequence, but grenade damage disqualifies the encounter.

The sequence is defined by the first through lethal discharge, not a guessed
time window. Unknown weapon, relationship or discharge evidence remains unknown.
Known disqualifying evidence can establish zero despite other unavailable
details. The complete count is null for partial recordings or unresolved
potential kills, while `observed_count` and verified examples remain visible.
Examples reference combat event indices, victim slots and first-hit/kill source
ticks (120 Hz). Match-ending deaths count; postgame events do not.

Retained definition 1 requires normalized health and normal shields both equal
to 1 and has no explicit headshot check. Old results and recipes retain that rule.

## Evidence and extension points

Exporter 19 is new for both Beta 5 and Beta 6. The gated C observations record
ordered discharges, applied damage with before/after vitality, deaths and network
DEAL invocations. They never modify simulation state. Rust writes a private
bounded evidence stream and removes it before encoding viewer state. Node joins
recorded source evidence and runs the independent reducer. These are separate
layers so future metrics can share observations without changing old definitions.

Local discharges use the existing exact projectile lineage. Remote discharges
use original client pull/report identifiers, accepted host verdicts, and the
replayed network damage call. A complete host ledger permits an ordered per-tick
DEAL/TAKEN bijection, including non-damaging calls. Where the original host ledger
is absent, identical client verdict copies are deduplicated by report identity;
the exact host tick, owner and full victim object handle must join one-to-one on
both sides. Conflicts, duplicate matches and ambiguous simultaneous damage are
unknown. No nearest-time, proximity or three-hit approximation is used.

Pull tables include misses. Capped tables, ambiguous low-16 pull wraps, missing
reports, mismatched owners/weapons and incomplete source evidence cannot prove a
kill. Beta 5 commonly contains only one client's account and may also lack
resolved remote weapon attribution. Such players remain unknown. Beta 6 embedded
accounts can support all participants, independently of whether that client's
predicted world is playable. The authoritative simulation must still verify.

Private evidence is limited to 2048 events per frame, 400000 events overall and
128 MiB. Capped combat output cannot claim gameplay coverage. API and worker
validators reconcile counts, coverage, roster, kill identities, pistol weapons,
ordering and match bounds. Public payloads contain counts and examples, not the
raw evidence stream.

## Recipes and rollout

Exporter 24 selects definition 2 for both exact counts and review estimates.
Beta 5 uses 24/5/5 and Beta 6 uses 24/5/10. Required capability
`three_shot_headshot: halospawns.h1GameplayMetrics.v1` prevents activation on an
older API. The existing native-v3 and gameplay-v1 containers are unchanged;
the API checks the definition against the frozen exporter. Engine binaries,
viewer formats and all recipes through 23 remain unchanged. Separate Beta 5
client views retain 13/2/5. No migration is required.

The retained 90-match Beta 5/6 corpus verifies the production reducer for both
definitions. All definition-1 products are unchanged, including estimates.
Definition 2 retains all 510 exact kills and adds 39 partial-health headshots
(549 total); starred candidates increase from 513 to 542. Unresolved kills
decrease from 1,490 to 1,417 because confirmed bodyshot finishers can now be
excluded even when their discharge sequence is unavailable. Every exact and
starred example has the existing engine/combat headshot evidence. The smallest
starting health among new exact examples is approximately 0.0127, which remains
eligible because the finisher is a headshot. Private source-bound results are in
`.build/three-shot-headshot-v2/corpus-products.json`.

Exporter 21 adds separately labelled review estimates using the exact exporter-20
simulation binaries. New recipes are 21/5/5 and 21/5/9, with required capability
`gameplay_estimates: halospawns.h1GameplayEstimates.v1`. Each player's optional
`estimates` object carries that schema, method `host_sequence_previous_12`,
candidate `count`, and combat-bound `examples`. The original exact fields and
coverage remain unchanged. Old recipes omit this object, preserving old outputs
and receipt identities. No additional engine geometry hooks are enabled.

The estimator accepts only unresolved kills from the exact analysis. It joins
accepted damage to a unique preceding host discharge of the same owner and
weapon within 12 ticks, consumes each discharge once per report, and applies the
same fresh-target/unassisted/consecutive-shot reducer. Every host firearm
discharge advances the sequence, including misses and other weapons. A known
exact disqualification always excludes a candidate. Unknown association,
relationship or weapon evidence cannot manufacture one. Since original client
misses may be absent, these examples are estimates, never verified counts.
Frontend counts that include them carry an asterisk and link to each candidate.

The original 20/5/5 and 20/5/9 recipes and every earlier recipe remain:

Exporter 20 adds a gated damage-graph correction for Beta 5/6. Effect parts
declared as decals are excluded before validating their handles. A stale
grenade-scorch decal identifier in some maps previously invalidated every remote
weapon mapping. All other references retain the existing bounds, identity,
ambiguity and traversal checks. Exporter 19 and all earlier binaries remain.

- Beta 5: exporter 20 / analytics 5 / viewer 5 (19 retained).
- Beta 6: exporter 20 / analytics 5 / viewer 9 (19 retained).
- Required capability: `gameplay_metrics: halospawns.h1GameplayMetrics.v1`.

Every old binary and recipe remains. New full reparses create new immutable
generations; old attempts, receipts and artifacts stay pinned. The API needs no
database migration. Keep native v3 and gameplay readers on policy rollback.
Frontend changes remain local. Deployment and reparse evidence belongs in
`DEPLOYMENT.md`.

## A verified host replay can still have incomplete shot evidence

Game `1ac30833-c145-4f66-b4ed-b53df5b79993` is a concrete example. Its exact
retained source, SHA-256
`0b0f59199ea62e9d29b437821d49afbc008df4e4950f169ff0244f2322466bd9`,
completes 64,992 ticks and all 542 verification hashes. It contains original
client accounts for slots 0, 1 and 2, but none for Seizen (slot 3). Scanning the
146 supplied local films and the version-pinned headers of all 61 retained Beta 6
dev conversion sources found no additional account for this match.

The network model applies accepted client hit reports to the host world. The
film records those damage effects and the inputs as consumed by the host;
those inputs can be merged or repeated. A host projectile is not the original
client projectile. This match demonstrates the distinction directly: host
pistol discharge counts for slots 0/1/2 are 144/148/91, while their original
client pull logs contain 147/152/92. Complete host verification therefore does
not establish the original sequence of misses.

This follows the pinned Beta 6 network model (`86c52285`):
`src/host/blampc_net_universal_damage.c` documents that clients report their own
hits and the host's copies of their projectiles deal no damage. Its report
path covers host objects and shielded devices, not every shot into air or the
map. `src/host/blampc_film.c` records accepted `DEAL` damage calls; their order
does not supply the missing original discharge sequence.

Seizen has 14 evaluated kills, ten known not to qualify and four unresolved
encounters. The unresolved lethal source ticks are 20923 (2:54.358), 51013
(7:05.108), 55046 (7:38.717) and 61359 (8:31.325). The first has three accepted
pistol hits from full normal vitality, but no original pull sequence to exclude
intervening misses. This is not a verified count of one. The other encounters
include extra damage or host firing observations, also without exact client
discharge identities. The complete total must remain null.

For exhaustive strict counts, recordings need uncapped original firing/pull
logs for every participant, including misses, with stable joins to accepted
damage reports. A playable client world is not required; the original account
can remain useful even when that client's predicted simulation diverges.

The separate exporter-20 attribution defect was reproduced with complete
client accounts in games `26800ba4-a8bf-41c3-ad63-c4627433106d`,
`bbfec5b6-684b-4dab-a6c9-e986fa7f2504` and
`42355370-aa4a-4143-818d-20cbbf0d7dce`. Their network DEAL/verdict joins are
exact, but the stale visual reference made the damage weapon unknown. That
fix does not recover Seizen's absent client account. Private reproduction,
source hashes and encounter evidence are in `.build/three-shot-investigation/`.

The follow-up [host instrumentation study](HOST_SHOT_EVALUATION.md) covers 90
distinct Beta 5/6 matches. Host timing estimates recovered 498/510 known kills;
requiring host collisions recovered only 164/510. Neither can exclude a missing
original client miss. The offline probe/evaluation tooling and ambiguity
regressions are retained. The subsequent user-authorized review feature exposes
estimates separately, without changing the strict definition or the simulation binaries.
