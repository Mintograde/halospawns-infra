# Recorded tick rates

Dev rollout authorized on 2026-11-17. The additive database migration is
applied in dev; API, worker and frontend releases are in progress. No production
action or historical reparse.

## Supported recordings

The source-pinned Beta 4, 5, 6/6.1, 7 and 8 engines implement two runtime rates:
30 and 120 Hz. Their recorder headers now select that rate throughout conversion.
Beta 3 and the retained `197bb65c` arena engine remain fixed at 120 Hz. 60 Hz and
other rates not implemented by those upstream sources remain rejected.
The registry's original `tick_rate: 120` identities remain immutable; the effective
job engine gets the verified recording's rate. New engines must declare their
source-supported rates in both tick-rate helpers and prove them with fixtures.

The reported Chillout film is a valid Beta 7 recording at 30 Hz:

- SHA-256: `b1d661384a414dba911287fdce39211b479aa91b9b92b808916fdd289fc824ab`.
- Host: 23,431 frames / 196 recorded hashes; duration 781.033333 seconds.
- Embedded clients: 23,430, 23,432 and 23,432 frames, all available and verified.
- Original failure: envelope validation required 120 Hz. Removing that restriction
  alone exposed a second 120 Hz assumption in the melee timer exporter.
- Melee timer phases and conservative remote timing bounds now use the upstream
  `BLAMPC_TICKS_PER_ARTEFACT_TICK` value (1 at 30 Hz, 4 at 120 Hz).

## Compatibility

Host exporter 40 is added for Betas 4–8; Beta 5 separate clients use exporter 41.
All seven old profile identities, 82 old exporters and previous recipes remain
in the 88-exporter registry. Old recipes continue to require 120 Hz.

Beta 4 uses 40/4/5 and Beta 5 uses 40/5/5. Betas 6–8 use 40/5/14 and match replay
v9. The new container binds its actual 30/120 Hz rate and exact engine profile,
retaining the existing 512 MiB physical/per-entry and 2 GiB logical limits.
All older projection/encoding documents remain unchanged. Release capability:
`tick_rates: halospawns.h1TickRates.v1`.

World frames, game clocks, combat events and diagnostic clocks remain in their
original source units. Analytics/occupancy remain 30 Hz, with stride
`source_tick_rate / 30`. Animation frames remain 30 Hz. At 30 Hz the source viewer
uses `replay.source.hsrdc` and encoding key `source`; retained 120 Hz names and
encoding keys remain unchanged. Hash sampling intervals remain recorded values.
Non-120 completion/client identities carry `source_tick_rate`; omitted means 120.
Serializers omit the default to preserve existing proof fingerprints.

## Verification and artifacts

Private local evidence is under `.build/tick-rates/`:

- Packaged user-film conversion, rebuild and reparse, including idempotent
  callbacks and all four worlds, pass. Exact API schema/pure-builder callbacks
  pass for all three product modes.
- The retained separate Beta 5 client also passes exporter 41, real API service
  validation, immutable artifact/timeline checks and lost-callback redelivery:
  5,134 frames / 43 hashes. 30 Hz client association/rate binding is covered by
  contract tests; no separate player-supplied 30 Hz Beta 5 client was available.
- Five synthetic 30 Hz recordings and five 120 Hz recordings pass packaged
  conversion and exact API validation. The five retained 120 Hz recipes also
  pass; `retained-comparison.json` proves identical statistics/settings and all
  world/recorded-entry bytes. Their new outer match contract is intentionally v9.
- Generated fixtures are synthetic. Local native CMake build labels were
  canonicalized only in fixture copies; original files, source pins and both
  hashes are retained in `generated*-provenance.json`. The user's film is untouched.
- Full user-film native/WASM comparison verifies all recorded simulation hashes.
  The established spawn-rating audit finds 30 floating-point ratings differing
  by at most one ULP, maximum probability delta `1.961905236602668e-7`.
  Every other field, spawn selection and classification is identical. This is
  not byte-identical native/WASM output; raw observations are retained.
- 300 Node, 124 Python worker and 103 Rust tests pass (one Rust test skipped).
  API: 2,784 unit tests pass, four skipped; isolated PostgreSQL checks cover
  source-rate binding and old/new format constraints. Viewer: 2,018 tests pass,
  one skipped; site: 907 pass; both frontend builds pass.
- Desktop/mobile Chrome loads the actual 30 Hz match, seeks while paused,
  plays at the correct rate and switches all three client perspectives.
  Browser harness, screenshots and report: sibling frontend
  `smoke-runs/tick-rates/`.

Local candidate image: `halospawns-h1-film:tick-rates`,
`sha256:9891c6907177831f9f1e80515bb567b5a5e9907c7d360beb0b964bb179f332cd`.
The offline release/catalog use a deliberately fake all-`a` image digest and
must not be published. Private new WASM builds are under `.build/tick-rates/`;
the retained engine store is `.build/beta7-deploy/engines`.

## Rollout requirements

Deploy compatible API readers and additive migration
`20261117010000_h1film_tick_rates.sql` before activating a real published worker
manifest with the new capability. Run the normal release verification/health
and guarded promotion procedure. The local frontend has the corresponding v9
reader and recorded-rate presentation. Retain every old recipe, artifact,
generation and migration on rollback. No historical reparse is required for
existing 120 Hz data; the failed original upload has not been retried live.
