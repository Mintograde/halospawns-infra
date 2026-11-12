# Backwhacks and double-melee kills

Deployed in dev on 2026-11-12 UTC as worker/default `20261112-r1`, policy 28,
and API 250 (`918d938`, CI 43134370060). Exporter 29 is selected for Beta 5,
6 and 7: 29/5/5, 29/5/10 and 29/5/11. Earlier engines stay on exporter 28.
All old pins and recipes remain; the registry has six profiles/45 exporters.
No migration or prod release. Frontend changes remain local/uncommitted.

## Definitions

Both metrics use definition 1 in `halospawns.h1GameplayMetrics.v1` alongside the
unchanged three-shot metric, within analytics 5/native v3.

- `backwhack_kills`: an enemy killed by melee damage that executes the engine's
  assassination branch. Both the damaging hit and its combat death must carry
  that observation. Facing/proximity alone never establishes a backwhack.
- `double_melee_kills`: two distinct damaging melee actions by the same attacker
  against the same enemy object lifetime. The first hit precedes a successful
  grenade cancellation; the next melee action delivers the killing hit strictly
  before the first melee's original cooldown expires. A missed/zero-damage hit,
  different target, respawn, failed grenade attempt, non-melee finisher or hit
  exactly at expiry does not qualify. Duplicate damage callbacks count once.

The first timer comes from the equipped weapon's actual animation duration after
the engine's melee-speed adjustment. It decrements on the 30 Hz phase within the
120 Hz simulation: expiry clock is `clock - clock % 4 + frames * 4`. A new normal
melee can start one source tick later. Classification compares the **lethal
damage tick with timer expiry**, not the second button press or the restart tick.
There is no fixed guessed millisecond threshold. Missing/invalid animation
timing clears the observation identity without changing or rejecting simulation.

Both blows must remove shield or health. No fresh-shield, full-health,
unassisted-kill or no-recovery condition is added to the user's double-melee
definition. A qualifying finisher may also be a backwhack; both stats then count.

## Evidence and coverage

`H1_MELEE_EXPORT` gates observational hooks in the source-pinned Beta 5/6/7
engines. Private gameplay kinds 4/5 record melee starts and successful grenade
cancellations; damage/death observations add action IDs, full object handles,
weapon category and the actual assassination branch. Existing simulation state,
combat/native fields and viewer data are unchanged. Exact source anchors and
native/WASM full-export parity guard the hooks.

Network DEAL damage deliberately carries no host melee action identity. Host
animation timing cannot establish the remote client's original action/cooldown.
Backwhacks can still be confirmed from accepted authoritative damage, but
remote double-melee candidates remain unknown. Embedded client worlds are still
exported and verified; this implementation does **not** join their original
melee actions to host damage. That requires an additional source-bound
client-action/report join. Earlier engines and non-H1 recordings lack these
new measurements.

Unresolved candidate kills use `value: null`, `missing_melee_evidence` coverage,
and separate `observed_count`/`unknown_kills`. Partial recordings also retain
observations without claiming a complete total. Known non-melee deaths can be
excluded. There are no melee estimates or starred candidates.

Examples identify the combat kill, victim and source ticks. Double-melee
examples additionally contain `melee_timing` with first damage, grenade,
second action and cooldown-expiry ticks. Worker and API independently validate
ordering, strict expiry, counts, coverage, roster, combat death and melee weapon
category. Old examples retain their exact serialized shape.

## API, frontend and release contract

The required reader capability is
`melee_metrics: halospawns.h1GameplayMetrics.v1`. Exporter 29 requires both new
metrics and analytics 5; older recipes reject their presence. API release
admission requires the capability before a worker recipe can be selected.
No database migration or replay-format change is needed.

Career totals and map/gametype/category folds sum only complete definition-1
participant counts. Missing, partial, older-definition and non-H1 measurements
remain unavailable and do not become zeros. Match scoreboards add BW/DM only
when the product exists, displaying exact counts, `n+` verified lower bounds or
`-` for unknown. Combat panels explain coverage and link verified examples to
the existing replay player/time seek. Frontend work remains local/uncommitted.

The compatible API was deployed before worker registration, guarded image
promotion and default selection. Existing games acquire these measurements
through audited full reparses that preserve their original generations.
Rollback must retain the capability/readers and all recipes used by stored
generations.

## Deployment and backfill validation

Release image:
`sha256:1b4278a4d58129e635e27b33806945a9c3dc987d42dff929573bdf1605523e4c`.
API CI passes 2,264 tests (325 skips). All 18 packaged cases / 54 exact API
callbacks, six retained exporter-28 recipes / 18 callbacks, receipt retries
and the separate Beta 5 client flow pass. The first full live health check
passes; all six dev postplans are no-op. Runtime limits are unchanged.

The authorized backfill completed all 227 games (27 Beta 5, 146 Beta 6,
54 Beta 7) through 64 audited batches, with no failed attempts. All selected
viewer/statistics generations agree. Results across 981 participant appearances:

| Metric | Verified observations | Complete / partial totals | Unresolved kills |
| --- | ---: | ---: | ---: |
| Backwhacks | 158 | 810 / 171 | 146 |
| Double-melee kills | 0 | 579 / 402 | 548 |

No positive double melee was proven by these recordings; this does not claim
that the unresolved candidates are zero. Every old native statistic, pistol
counter, three-shot result, scoreboard/graph/occupancy hash, 27 legacy viewer
files and 19,910 entries across 200 match files is unchanged. The 51 older
engine games and all original history are preserved.

Four new Beta 7 uploads automatically used the new defaults, bringing the
audit snapshot to 231 measured games and 162 verified backwhacks. Default PB2
2v2 has 222 games / 111 complete-count backwhacks. Its original 218-game scope
reproduces every previous career field in an independent read-only comparison.
Live API/CDN hash/range/CORS and desktop/mobile Chrome checks pass. Queue/DLQ
are empty. Final history totals: 311 conversions / 1,226 receipts / 948 H1
attempts / 360 approvals. See [DEPLOYMENT.md](DEPLOYMENT.md) and
`.build/melee-deploy/final-audit.json`; browser evidence is in sibling Svelte
`smoke-runs/melee-deploy-20261112/`.

## Prior local validation

- 182 Node tests; 114 tests inside the packaged worker.
- 2,249 API unit tests (six optional skips), final focused schema tests and
  Ruff; 14 isolated PostgreSQL career cases; source-only API Lambda package.
- 847 site tests and both production builds. Headless Chrome at 1600/390 px
  checks scoreboard counts, unknown coverage, six real backwhack links and no
  overflow using browser-local API fixtures from the packaged Beta 5 product.
- Final native/WASM full-export parity: 170,807 ticks and 1,424 hash checks
  across Beta 5/6/7, with identical streams.
- Seven final packaged cases, including complete embedded-client Beta 6/7
  containers, pass all three callback modes and 21 exact API validations.
- Comparing retained exporter 28 with 29 preserves all prior analytics,
  three-shots, scoreboard/graph/occupancy data and replay payloads across three
  profiles. Beta 5 viewer bytes are identical; Beta 6/7 match manifests differ
  only in the intentional engine pins. All 42 old exporter entries and every
  old recipe are retained.
- Real melee recordings yield eight verified backwhacks (six Beta 5/two Beta 6).
  No verified positive double melee was found in these samples. Controlled
  event tests establish positive sequences and the expiry boundary; they do
  not substitute for a real positive client-origin recording.

Evidence is under `.build/melee/`: `candidate-final-*`, `parity-final-*`,
`packaged-complete-*`, `complete-*`, `api-*.json`, `preservation-complete.json`
and test logs. Final local image digest:
`sha256:5cb93381bf04d7c0f0aff27ec4fd905f4d82f4d0021801e05451ede7c8c79635`.
`release-complete.json` is an **unregistered offline fixture**, not a published
release. Browser evidence is in sibling Svelte `smoke-runs/melee-20261111/`.
