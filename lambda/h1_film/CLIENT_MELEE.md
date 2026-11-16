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

User-authorized dev publication, guarded activation and audited historical
reparses are in progress. Evidence is retained in `.build/client-melee/`.
