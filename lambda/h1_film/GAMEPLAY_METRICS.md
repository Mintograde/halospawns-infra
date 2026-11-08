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

- Beta 5: exporter 19 / analytics 5 / viewer 5.
- Beta 6: exporter 19 / analytics 5 / viewer 9.
- Required capability: `gameplay_metrics: halospawns.h1GameplayMetrics.v1`.

Every old binary and recipe remains. New full reparses create new immutable
generations; old attempts, receipts and artifacts stay pinned. The API needs no
database migration. Keep native v3 and gameplay readers on policy rollback.
Frontend changes remain local. Deployment and reparse evidence belongs in
`DEPLOYMENT.md`.
