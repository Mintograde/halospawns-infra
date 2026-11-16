# Double melees in mirrored host recordings

Exporter 39 for Beta 5-8 adds a conservative proof using the original reports
and accepted host verdict copies in a recording player's diagnostic account.
It preserves definition 2, all earlier recipes, and the exact exporter-38
engine binaries. New releases require the API capability
`client_melee_timing: halospawns.h1GameplayMetrics.v1`.

## Reported replay

Replay `69e50a6e-85ba-49b3-972b-67133f77f75d`, game
`e7e608c4-9415-4c63-a965-f0162898742a`, is a Beta 6 Chillout recording.
The source SHA-256 is
`40ff23bfdd49c3ab92f0661509b0655ac09bb08a4593c64106cea0588185a5f9`;
the approved map SHA-256 is
`d989155349c2e2855f8031d6112227197f2375099420125e643fda50da63bb43`.

| Observation | Source tick / identity |
| --- | --- |
| .minto's first host-observed melee action | 24503, action 31 |
| First damaging hit on JukkisP | 24517, DEAL 741 |
| Successful grenade cancellation | 24528 |
| Second melee action | 24539, action 32 |
| Lethal second melee | 24553, DEAL 742, combat death 32 |
| Original reliable report clocks | 24517 and 24553: 36 ticks / 300 ms |
| Conservative minimum recovery remaining | 56 ticks / 467 ms |
| Reliable identity | machine 0, epoch 11539, sequences 154 and 155 |

The original account SHA-256 is
`9487864b5e900b345637191ca4f095701fe9221163760776e70f2fb4b5dfd45d`.
Its raw shot and verdict indices are 154 and 155. Both hits remove vitality,
the first is nonlethal, and attacker/victim body identities remain unchanged.
The original report interval is strictly below the map-wide recovery bound.

## Why the ledger is absent

Exact Beta 6 source `host/blampc_film.c::film_mirror_envelope` intentionally
zeros `ledger_offset` and `ledger_size` in the player copy of a host film.
`film_mirror_finish` appends the recorder's own diagnostic account. The true
server recording has the full ledger. `blampc_film_feed.h` delivers verdict
copies only to their owning client; the diagnostic account preserves them
verbatim alongside the client's original reports.

The extracted 7,568,722-byte host segment verifies 71,992 ticks and 600 hashes
with no mismatch. Its account alone proves the exchange without any embedded
client simulation. Removing the account still verifies the host world but
removes the original report timing; host arrival spacing alone is insufficient.
Investigation evidence is retained privately in `.build/melee-24493/`.

## Conservative binding and compatibility

The new path runs only when the original host ledger is absent. It requires an
uncapped, uniquely identified account with a source hash, original reliable
reports and their matching accepted host verdict copies. Raw duplicates remain
ambiguous. Conflicting copies from another account invalidate the report.
An exact host-tick/owner/full-target-handle join must be one-to-one on both
sides, including zero-damage DEALs; no cross-account ordering is inferred.
The damage tag must match the simulated melee. The same-account report and
verdict indices increase; reliable epoch, body lifetimes, two damaging hits,
observed successful grenade cancellation and strict recovery bound still apply.

Examples identify `remote_melee_timing.method = client_accepted_reports_v1`
and retain `client_account_sha256`, `first_shot_index`, `second_shot_index`.
API and worker readers validate the additional provenance and reject this
method for older frozen exporters. Existing local/host-ledger examples retain
their exact shape. New compatible readers and all registered recipes must
remain available on rollback.

Backwhacks already use the actual host assassination branch. Three-shot
classification already binds original client pulls/reports and accepted verdict
copies when the full ledger is absent; misses and incomplete pull coverage
remain disqualifying/unknown. Neither metric is loosened by this change.

## Validation and rollout

`tests/fixtures/double-melee-chillout-client.json` retains the bounded host
exchange and uncapped original report/verdict tables. The tests cover the real
positive, old-recipe exclusion, missing/capped/conflicting evidence, duplicate
identity, wrong owner/target/damage, unreliable/refused reports, body changes,
compressed host arrival timing, equality at expiry and missing cancellation.
The preceding host-ledger suite and three-shot miss/coverage tests also remain.

Mirrored-host double-melee detection is deployed in dev as worker/default
`20261116-r1`, policy 37, API 278 (`a147d8b`, CI 43887724133). Beta 5-8 use
exporter 39 with exact exporter-38/36 binaries; all seven profiles, 82 exporters
and every prior recipe remain. The original client reports and accepted host
verdict copies retained in a mirrored host account can establish definition 2
without an embedded client world. Missing, capped or conflicting evidence stays
unknown. `.minto` now has two complete double-melee kills in replay
`69e50a6e-85ba-49b3-972b-67133f77f75d`: CTRL at 11896 and JukkisP at 24553.

All 121 affected games succeeded in 50 audited batches. Across the original
410 games, verified double melees increased from 123 to 133
(10 recovered across 8 games); unknown kill classifications fell
from 213 to 203. Doubles included in complete player totals increased from
95 to 103. All 262 backwhacks, 2598 verified three-shots and
750 three-shot estimates remain unchanged. Their existing evidence paths already
handle the corresponding host observations/client accounts; original hit clocks
cannot establish an otherwise missing miss-free shot history.

Every other statistic and all replay bytes remain: 17 standalone files and
10,833 payload entries in 104 match files. All 289 unaffected original games
are unchanged. Two separate client views are reattached with identical bytes
and original clocks (167,368 frames / 1,396 hashes); the other four remain
attached to unchanged hosts. All original history remains. Final totals are
459 conversions / 2,894 logical receipts / 2,488 H1 attempts /
474 approvals / 2,758 settings snapshots; client history is
37 uploads / 38 attempts.

All 295 Node / 123 packaged worker / 2,501 API CI tests, 17 packaged cases /
51 exact deployed-API callbacks, seven retained cases / 21 callbacks and the
separate client flow pass. Live API/CDN hashes and desktop/mobile Chrome counts,
filtering, lead-in seeks, playback and perspective switching pass. The first
cold inventory health exceeded 300 seconds; the full warm retry passed before
the saved promotion's final policy/API/image-fenced activation. All six dev
postplans have no resource actions; API output refresh and final no-op pass.
Queue and DLQ are empty. No migration, frontend or production deployment.
Retain compatible API readers, every recipe/generation, receipt archive access
and all archived versions on rollback.

The immutable worker image is
`sha256:b7d04148bb5e1437a952ad3071a1005c8c48c2c9ed7d0835fa43f2ce504b0afa`,
built from infra `10c3f5c`. All 220 released API Python files match `a147d8b`.
The initial local packaging attempt exhausted Docker storage before simulation.
Four unused, digest-verified ECR image cache copies and their recoverable build
cache were removed locally; all remote releases, source files, volumes, engine
binaries and recipes remain. Publication resumed with the same immutable image.
The first browser harness assumed the selected player's client clock was the
host clock; selecting Host explicitly resolves that test assumption. No frontend
code changed. Evidence, including both unsuccessful checks, is retained in
`.build/client-melee/` and `.build/h1-promotions/20261116-145632-1b23a5b5d2ac43afa36fd7843fe4d187/`.
