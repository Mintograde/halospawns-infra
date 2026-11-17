# Recorded tick rates

Deployed in dev on 2026-11-17 as worker/default `20261117-r1`, policy 38,
API 289 (`88652a2`) and frontend `10bef45`. The additive migration is applied.
No production action or historical reparse.

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
  API CI: 2,839 tests pass, 430 skipped; isolated PostgreSQL checks cover
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

## Dev release verification

Dev worker/default `20261117-r1`, policy 38, API 289 (`88652a2`, CI
44098326649) and frontend `10bef45` (CI 44098401230) support recorded 30/120 Hz
for source-pinned Betas 4–8. Migration `20261117010000_h1film_tick_rates.sql`
is applied. Host exporter 40, separate Beta 5 client 41 and match v9 retain all
seven profiles, 88 exporters and every prior recipe. Fixed-rate engines remain
unchanged; unsupported source rates remain rejected.

The user's Chillout film is recovered through normal presign/S3 intake as upload
`a904c396-6f8d-4319-98b9-ccd43ada8ae1`, game `bf2a6d11-8d4b-4b4a-a879-c4bcdab9bbe0`,
replay `751356d0-12b8-416d-9df5-496b4bdfcc43`. All four worlds verify
93,725 frames / 784 hashes with zero mismatches; duration is 13:01. The failed
original upload and its exact S3 version remain untouched. API clocks, combat
filters, settings, CDN hashes/ranges and desktop/mobile hosted Chrome playback,
paused seeks and all perspective switches pass. Existing 120 Hz playback passes.

All 23 packaged cases / 69 exact deployed-API callbacks and the separate client
flow pass. API CI: 2,839 passed / 430 skipped; viewer: 2,018 passed / one skipped;
site: 907 passed. The cold inventory exceeded 300 seconds; the complete warm
check passed before policy/API/image-fenced activation. All six final dev plans
are no-op, the API output refresh is applied, and health/queue/DLQ checks pass.
Every original history fingerprint is retained; totals are 460 conversions,
2,895 receipts, 474 approvals and 2,759 settings snapshots.
No historical reparse or production action. The frontend study under
`scripts/input-profile-study/` remains untouched. Keep compatible readers,
the additive migration and every stored generation/recipe on rollback.

Published image:
`sha256:c5b88d7c6999a2741076102edbbcf1e219b7dffce7d48c13e770e0e5dc68ee77`.
Saved promotion: `.build/h1-promotions/20261117-143158-70b8bd0c6cb147d7ab7fd37bf0db609e/`.
The final release corpus used the normal Linux disk-backed temporary volume,
3008 MB limit and two CPUs. Initial local credential-store/disk-space problems
and a Windows bind-mount rename failure are retained in private evidence;
the same immutable image passed all 23 final native-volume cases.

Retain API 289+ compatible readers, match v9, the additive migration and every
old recipe/artifact/generation on rollback. Existing 120 Hz games need no reparse.
