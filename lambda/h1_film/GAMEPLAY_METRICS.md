# Derived gameplay metrics

Analytics 5 / native v3 adds `halospawns.h1GameplayMetrics.v1`. Metric IDs,
definition versions, participant coverage and replay examples form the shared
contract for future reducers. Existing native metrics and combat are retained.
The first definition is `pistol_three_shot_kills` version 1.

## Counting rule

The victim starts at normalized health and normal shields of 1. Exactly three
distinct, consecutive pistol discharges from one opponent must kill that victim.
Intervening misses and other weapon discharges disqualify the kill. Other damage
(including self/environment/team damage), a different victim object lifetime,
or vitality recovery during the encounter also disqualify it. Duplicate damage
callbacks from a single discharge count once. A fully restored victim starts a
new encounter; overshields are not normal fresh shields. Grenade throws do not
advance the firearm sequence, but grenade damage disqualifies the encounter.

The sequence is defined by the first through lethal discharge, not a guessed
time window. Unknown weapon, relationship or discharge evidence remains unknown.
Known disqualifying evidence can establish zero despite other unavailable
details. The complete count is null for partial recordings or unresolved
potential kills, while `observed_count` and verified examples remain visible.
Examples reference combat event indices, victim slots and first-hit/kill source
ticks (120 Hz). Match-ending deaths count; postgame events do not.

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
146 supplied local films found no additional account for this match.

The network model applies accepted client hit reports to the host world. The
film records those damage effects and the inputs as consumed by the host;
those inputs can be merged or repeated. A host projectile is not the original
client projectile. This match demonstrates the distinction directly: host
pistol discharge counts for slots 0/1/2 are 144/148/91, while their original
client pull logs contain 147/152/92. Complete host verification therefore does
not establish the original sequence of misses.

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
