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

Validation and rollout artifacts live under `.build/double-melee/`. Before
activation, the native/WASM full streams match for all four engines:
231,283 ticks / 1,928 hashes, including the complete user Fallout film. All
60,476 Fallout frames preserve every prior exported field. Node tests (241),
worker tests (122), site tests (867), viewer tests (1,860), isolated PostgreSQL
career tests (14) and both frontend builds pass. The pre-rollout inventory has
342 applicable games and six completed separate client views. Final packaged,
activation, backfill and preservation outcomes are appended after verification.
