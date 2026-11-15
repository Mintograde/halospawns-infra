# Host-only double-melee detection

## Scope and definition

The November 15, 2026 follow-up adds double-melee definition 2 for source-pinned
Beta 5, 6, 7 and 8 exporters. Definition 1 and all old recipes remain intact.
The original local-action detector is retained. The new path proves remote
double melees from the original host recording without requiring the attacker's
client film. No estimates, guessed latency offsets or proximity heuristics are
used. Backwhacks and every other statistic retain their definitions.

The definition is still two damaging melees by one attacker against the same
enemy body, a successful grenade cancellation between consecutive actions, and
a lethal second hit strictly before the first swing's original timer expires.
Both blows must remove health or shields. Assistance, victim recovery and low
starting health do not independently disqualify this particular statistic.

## Reported example and repeatable proof

Replay `e9456e6b-a6a3-4ca5-86bc-500f20d60881`, game
`6af9a8dc-d502-4085-9f0d-dc74d41965d8`, is Fallout source
`83f8158e-7034-4dbc-84dd-c1f4beefc2ba-16a2c5cd9e050b02.h1film`.
Seizen is slot 3 and dstny is slot 0. The film SHA-256 is
`64be95dc769107ec75009d91693ff8815b7b404076cf2a4dedf9d652e4f84bad`;
the approved map SHA-256 is
`5619f03a0ea67f75eb6bed2fa9ad29c260c5ffd356ec4eed98dcb6be410acefa`.

| Observation | Source tick / identity |
| --- | --- |
| Host's first melee action | 7157, action 8 |
| First accepted damaging melee | 7174, DEAL 49, ledger verdict 48 |
| Successful host grenade cancellation | 7186 |
| Host's next melee action | 7189, action 9 |
| Accepted lethal melee | 7206, DEAL 51, verdict 50, combat death 10 |
| Original client report clocks | 7145 and 7177: 32 ticks / 267 ms apart |
| Reliable identity | machine 3, epoch 43123, sequences 9 and 10 |
| Minimum original timer remaining after impact | 56 ticks / 467 ms |

The two full target/attacker handles match across the exchange. The first hit
is nonlethal. The host observes exactly the required first-hit/cancel/second-hit
ordering. Most importantly, 32 original client ticks is strictly below the
56-tick map-wide lower bound. Host arrival spacing is not used as timing proof.

Four more examples in the supplied films independently satisfy the same rule:
Fallout dstny (36 ticks), Player 2 (24), Galaxy (32), and Exhibit dstny (40).
All six native film replays verify cleanly. The source-bound fixture is retained
in `tests/fixtures/double-melee-fallout.json`; `tests/remote-melee.test.mjs` runs
the known positive and timing/identity/coverage counterexamples without any
attacker client account.

## Why the bound is conservative

Exact upstream `engine/blam/biped_update.c` starts the timer at
`T = total - (total >> 2)` and executes the damaging impact after `offset`
earlier decrements. At 120 Hz the timer decrements once per four ticks; impact
happens before its decrement. The original remaining time is therefore
`4 * (T - offset - 1)`. Equality is ordinary expiry and does not qualify.
`weapon_get_first_person_animation_time.c` selects the first first-person
animation set's melee entry, using `frame_count` and `private_key_frame_index`.
The melee caller passes reload type -1, so shotgun reload overrides do not apply.

The attacker can switch weapons between starting a swing and hitting. Using
only the damage weapon's animation would be unsafe. `remote-melee.h` reads all
melee-capable weapon tags in the exact approved map and takes the **minimum**
remaining timer. Invalid, absent or nonpositive timing produces no proof. It
reads tag data only; it does not call simulation, animation or random functions.

The reliable host report path preserves the original enqueue clock through
retries (`host/blampc_net_reliable.c`, `u_damage_handle_reports`). Damage reports
are queued by `u_damage_client_tick` at the original simulation tick. The active
client clock only jumps forward (`host/blampc_net_universal.c`), which can make
the measured interval longer, not spuriously shorter. The same reliable epoch,
distinct sequence numbers, increasing ledger indices and same body lifetimes
are required. The actual successful grenade cancellation is also observed by
the host. A short interval on its own never qualifies.

## Joins, uncertainty and compatibility

The uncapped original ledger must establish a complete per-tick ordered
bijection between accepted verdicts and simulated DEAL events, including
zero-damage DEALs. Full target handles, owner and host clock must agree. An
ambiguous join, client ledger copy, refused/unreliable report, missing timer,
different body, duplicate report or missing/late host cancellation cannot
produce a detection. Duplicate callbacks for one DEAL are one impact.

For a complete recording, a lethal single blow with no earlier melee or
unknown-category damage on that victim body establishes a negative. Partial
recordings or ambiguous earlier damage retain unknown coverage. Verified
observations remain available when another kill prevents a complete total.
This is intentionally conservative and does not promise detection of every
double melee visible to a human.

New `remote_melee_timing` examples retain report clocks, the bound, reliable
identity, verdict indices and host action/cancel ticks. Worker and API validate
the definition, strict timing/order, combat death and coverage independently.
Old examples serialize identically. Career totals sum complete definition 1
and 2 results; partial totals retain their established exclusion. Local
frontend readers display both definitions and link examples to attacker/time.

## Release and rollback

Exporter 36 adds four binaries; all seven profiles, 66 previous exporters and
every historical recipe remain (70 exporters total). Analytics/viewer revisions
remain Beta 5 `5/5`, Beta 6 `5/10`, Beta 7 `5/12`, Beta 8 `5/13`.
Separate-client exporter 31 and earlier-engine defaults are unchanged. The
release requires `remote_melee_timing: halospawns.h1GameplayMetrics.v1`.
API 272 is commit `4ef34810f708fd29252138e95134ea299d842c32`, CI 43732127471.
No migration or frontend publication is needed. Preserve compatible readers,
archive readers, approvals, all recipes and all stored generations on rollback.

Validation and rollout artifacts live under `.build/double-melee/`. The
native/WASM full streams match for all four engines:
231,283 ticks / 1,928 hashes, including the complete user Fallout film. All
60,476 Fallout frames preserve every prior exported field. Node tests (241),
worker tests (122), site tests (867), viewer tests (1,860), isolated PostgreSQL
career tests (14) and both frontend builds pass. All 15 packaged cases / 45
exact deployed API callbacks, four retained recipes / 12 callbacks and the
separate-client flow pass. Thirteen prior packaged cases preserve every other
statistic and all replay payloads. New match containers differ only in their
top-level engine binary pins; legacy standalone viewer files stay identical.
API CI passes 2,439 tests (396 opt-in skips), Rust, lint and packaging checks;
all 15 map-processing Terraform tests pass.

Worker/default `20261115-r1`, policy 35, is active in dev from infra commit
`37ec458f819e3f7b94bf01c05dd9c5ed73a57e96`. The image digest is
`sha256:765e97b82337bd1cec8db34f29fec94c805cc793e968336479ef60d78abca6e5`.
The first live health passes. All six dev postplans are no-op. Exact commands:

```powershell
.\scripts\promote-h1-film.ps1 -Stack dev
.\.build\double-melee\refresh-api-state.ps1
.\scripts\plan.ps1 dev
```

The promotion owns only the map-processing worker image/environment update.
The API refresh is state-only, with zero resource actions and its saved version
output advancing from 270 to the CI-deployed 272. It records the already-live
player-distribution cache lifecycle/inline-policy values without changing them.
There were no AWS/session blockers. Publication initially ran out of local
Docker space; audited disposable engine-copy build caches were cleared and the
same immutable image was successfully revalidated before activation.

Real Chrome desktop/mobile checks pass for the game count, all four Fallout
review events, paused seeks, playback through the kill, and dstny/host world
switching. A local CSS correction prevents the mobile event filter row from
shrinking underneath the event list. The live career endpoint returns exactly
one double melee for Seizen in this Fallout game. Frontend changes remain local.

## Completed dev backfill

All 342 user-authorized host reparses succeeded and are selected: Beta 5 (27),
Beta 6 (146), Beta 7 (155) and Beta 8 (14). All 114 audited policy-35 batches
have confirmed dispatches, with at most four games and 230 MiB of combined
sources/maps per batch, and at most 20 outstanding host attempts. There were
no failed or retried attempts.

The selected results contain **119 verified double-melee kills across 86
games**, all supported by the new original-host-report proof. There are 1,186
complete and 335 partial player totals. Unknown kill classifications decrease
from 878 to 357; uncertainty remains explicit and verified observations in
partial totals remain available. Fallout contains four verified examples,
including Seizen's kill at tick 7206. The independently supplied Exhibit film
also reports dstny's kill at 52903, with a 40-tick report gap below the 56-tick
bound. The final review list is `.build/double-melee/detections-all.csv`, with
all 119 evidence summaries and paused player/time links.

Every other native statistic, scoreboard/graph/occupancy hash, original source
pin and world availability record is unchanged. All 27 standalone viewer files
are byte-identical; all 32,574 logical payload entries across 315 match files
retain their kinds, sizes and hashes. Match containers carry the new engine
binary pins in their top-level manifest as described above.
All 51 earlier-engine games retain their original selected artifacts and native
statistics. The final inventory contains 393 games, no concurrent arrivals,
and no active attempts.

All six separate client views have fresh audited attachments to the new hosts.
Exporter 31, the viewer bytes and original clocks are identical: 428,941 frames
/ 3,578 verified hashes. All original uploads and attempts remain.

The server-hashed history audit preserves all 442 original conversions, 2,240
receipts, 474 approvals and 2,104 settings snapshots. Final totals are 442
conversions, 2,582 receipts, 474 approvals and 2,446 settings snapshots. Final
API health is 200 and queue/DLQ visible, delayed and in-flight counts are all
zero. No migration, frontend publication or production deployment occurred.
All 1,851 original H1 attempts remain unchanged (2,193 total). Separate-client
history grows from 26 uploads / 27 attempts to 32 / 33, preserving every original
row. Database allocation at the final audit is 432,974,995 bytes.

Final evidence: `compare-all-summary.json`, `client-verification-summary.json`,
`history-hashed-after.json` (compared with `history-hashed-before.json`),
`inventory-after-summary.json`, `operational-verification.json`,
`browser-verification.json` and the rollout logs under `.build/double-melee/`.
