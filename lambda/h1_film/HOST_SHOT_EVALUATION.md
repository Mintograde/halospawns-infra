# Host instrumentation and missing shot evidence

## Decision — November 8, 2026

Keep the isolated instrumentation/evaluation tools and the regression protecting
strict counts. Do **not** add host-time or host-collision estimates to the
verified three-shot metric, or permanently enable these extra geometry hooks in
the worker. Geometry did not improve classification in this study and reduced
coverage. Timing estimates performed well empirically, but cannot exclude a
client miss that was never reproduced in the host simulation.

No worker/API deployment, live reparse, frontend change or recording-format
change was made for this experiment. Dev remains worker/default `20261108-r7`,
policy 17, API 233. The existing exporter-20 attribution correction is retained.

## Experiment and results

The isolated native probe observes projectile origins/directions, collisions,
endings, and accepted host damage calls. Its source port is committed
`24fabfd6ffa68b92c3893a8094dfb6e4c296bf5b`; game sources are the exact Beta 5
`fbbfae27` and Beta 6.1 `86c52285` archives. It changes neither archive nor any
registered engine. Candidates cannot read the original client accounts used as
the reference. An instrumented copy of the production reducer exposes per-kill
decisions and must produce the same public result as the original reducer.

Of 103 simulated host recordings, 91 passed all required checks: 6,282,220 ticks,
52,389 matching state hashes, no seed mismatches and no refused network effects.
One short Beta 5 recording overlapped a longer recording of the same match and
was excluded from aggregate counts. Analysis therefore covers **90 distinct
matches: 30 Beta 5 and 60 Beta 6**. Seven were examined while choosing candidates;
the remaining 83 were validation cases. A new local Beta 6 recording appeared
during the study and was included by the final inventory; it added no evaluated
opponent kills. Splits use host hash or match identity, preserving the original
split when extra accounts change an outer container hash.

All five candidates require a unique same-player/same-weapon host discharge in
the chosen window, include intervening host discharges, and prohibit sharing a
discharge between different damage reports. Unknown/ambiguous associations are
abstentions. Thresholds were fixed before the larger validation run.

| Candidate | Known kills recovered / 510 | Known positives left unknown | Incorrect known classifications | New positives without reference evidence |
|---|---:|---:|---:|---:|
| Preceding discharge within 12 ticks | 498 | 12 | 0 | 513 |
| Discharge within 12 ticks either way | 504 | 6 | 0 | 522 |
| Preceding + trajectory agreement | 495 | 15 | 0 | 507 |
| Preceding + exact victim collision | 164 | 346 | 0 | 133 |
| Preceding + trajectory + collision | 164 | 346 | 0 | 133 |

For the primary preceding-discharge policy, validation alone recovered 440/450
known positives, correctly ruled out 6,426 negatives, and abstained on ten
positives and 30 negatives. None of the 634 validation encounters with exactly
three hits and a disqualifying intervening discharge were counted. Across all
90 matches that subset contains 698 encounters, again with no incorrect counts.

There are 1,490 kills whose exact classification is unavailable from original
evidence. Candidate predictions for these kills **cannot establish accuracy or
additional verified kills**. Beta 5 has much less original account coverage than
Beta 6, and matches/players are not independent statistical samples. Zero
observed errors is not proof of exact attribution.

Nine simulated recordings had no network-verification summary and were excluded
from this network study despite clean hashes. Three other runs failed the
required verification/continuous-clock checks. These exclusions describe this
diagnostic runner, not a new verdict on their production conversion eligibility;
in particular it does not implement intake's initial-roster recovery. Two Beta 5
and seven Beta 6 inputs also failed strict inventory inspection and were never
simulated. No damaged input was repaired or admitted to improve the results.

For Seizen's game `1ac30833-c145-4f66-b4ed-b53df5b79993`, the control probe
preserved the existing gameplay events, deaths, weapons, roster and match end,
and matched all 542 state hashes. The timing estimate marks the kill at source
tick 20923 as a candidate, but the absent original client account still prevents
excluding intervening misses. Seizen's complete verified count remains unknown.

## Why even successful instrumentation cannot establish the missing fact

The network damage model accepts client hit reports independently of the host's
copies of client projectiles. It does not send every original client miss to the
host. Merged/repeated inputs also mean host firing sequences can differ from the
original client sequences. The Seizen film's original client pistol totals
147/152/92 differ from host totals 144/148/91.

The new regression constructs the same three host discharges and the same
accepted damage reports with either of two original client histories:

1. Three consecutive hits: qualifies.
2. Hit, miss, hit, hit: does not qualify.

Exact source binding returns one and zero respectively. Removing the original
accounts yields unknown for both. Even when every observed host projectile has
perfect trajectory agreement and hits the exact victim object, all five
candidate policies return a positive for the second history. This is an explicit
synthetic missing-input counterexample, not a false positive observed in the real
corpus. Additional observation of that same host world cannot distinguish the
two histories.

## Groundwork for complete future recordings

An exact future host recording needs original firing records from every client,
including misses, joined to the host's accepted damage. A recording extension
should provide:

- A stable participant/session identity and monotonic discharge sequence, with
  weapon, trigger, original tick and projectile/pellet identities. Grenade throws
  stay distinct from the firearm sequence.
- Original outcome records for player hits, other collisions and no collision,
  with each accepted/rejected host damage verdict linked to its original shot.
  A client-reported impact and host-applied damage remain distinct facts.
- Reliable delivery or explicit sequence-gap/cap/overflow evidence, plus an
  acknowledged end watermark per participant. Missing records must remain
  incomplete even when the host simulation verifies.
- A versioned, source-bound section with join/leave identity and coverage rules,
  retaining old recorder/engine pins. Existing files cannot acquire lost misses
  through re-simulation or a format conversion.

The present original client accounts already implement much of the firing and
report evidence used by the strict reducer. The needed improvement is making
that evidence complete and available in the authoritative recording. Recorder
and transport changes are future work; this experiment did not modify them.

## Reproduction and validation

See [the study tool instructions](tools/host-shot-study/README.md) and
[the machine-readable results](tools/host-shot-study/20261108-results.json) for
policies, source/map/engine hashes, splits and exclusions. Private native dumps,
logs and full per-kill reports remain under `.build/host-shot-experiment/`.

Validation: 104 repository Node tests and the separate study counterexample test
pass. The two release-manifest assertions left at exporter 19 were updated to
the already deployed exporter 20, retaining all older recipe assertions.
Re-running the permanent preparation tool produces byte-identical probe files
to the tested native build. The production reducer, source adapter, registry,
WASM binaries, API and frontend are unchanged.
