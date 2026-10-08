# H1 film Lambda integration

Status on 2026-10-08: local conversion, production-parser reconciliation and
API schema/graph construction are verified for Dread and Downrush. A dormant
dev runtime is now deployed ahead of API/viewer readiness with the user's
explicit authorization. No queue, upload capability, API route, database or
hosted viewer was changed. This is not full Xbox semantic parity or enabled
cloud intake.

Active code has since been organized under `lambda/h1_film`; experiments retain
only reference/benchmark tooling and historical notes. See [README.md](README.md)
for the current entry points and [COMPATIBILITY.md](COMPATIBILITY.md) for retained
engine bundles, source-isolated builds and append-only profile registration.

## Dev foundation deployed 2026-10-08

- Account/region: `halospawns-dev` / `283279960672` / `us-east-1` only.
- Function: `halospawns-h1-film-dev`, Image / x86_64, Active / Successful.
- Private ECR: `halospawns-h1-film`, immutable release tag
  `foundation-20261008-r1`, resolved and pinned by Terraform to
  `sha256:8254713c182746576db0c192f097365e7f81b0a7113cc24ed5428564cbb7e2c9`.
- Runtime: 3,008 MiB memory, 8,192 MiB `/tmp`, 900-second timeout.
  AWS rejected the initial 4,096 MiB request with this account's 3,008 MiB
  memory cap; no quota increase was requested. Actual Lambda resource/time
  benchmarking remains pending.
- Reserved concurrency is **zero**, with no provisioned concurrency, source
  mapping, function URL, invocation policy, schedule or upload notification.
  No H1 queue exists yet. No application producer or API configuration changed.
- Execution IAM permits only CreateLogStream/PutLogEvents for its own 14-day
  log group. There is no S3, SQS, SSM, API secret or database access.
- The image contains the pinned Beta 3 WASM/glue, current Linux static encoder
  and local Node conversion tools. It omits game maps/source and the Python
  finalizer. The health-only handler rejects all job/record/path-bearing events.
  It cannot process uploads even if someone manually raises concurrency.
- Terraform owns releases directly. The existing ZIP code updater was not
  modified and cannot publish this container. Prod is disabled by default and
  explicitly rejected by the foundation resource guard.

This stage is intentionally independent of the ordered **activation** work
below. Enabling ingestion still requires the API job/map contract, security
hardening, shared finalization, reconciled analytics/availability, viewer
readiness, dedicated queue/DLQ/routing and narrowly scoped credentials. Keep
the future input prefix disjoint from `replays/unprocessed/`.

Validation:

- Eleven Node tests passed, including fail-closed job rejection; PowerShell
  syntax and Terraform validation passed.
- Pinned engine-retention audit and Linux executable health passed at image
  build time. Local Lambda runtime-interface tests passed on a read-only root
  filesystem as a non-root user, including job/extra-field rejection.
- Both films ran through this exact image locally with networking disabled.
  All four compact outputs (Dread/Downrush at 30/120 Hz) are SHA-256 identical
  to the existing native references; 630/671 world-hash checks, zero mismatches.
  Both private 30 Hz analytics sidecars were generated. The runs took 84.38 /
  56.04 seconds total with a two-CPU Docker limit and Windows bind mounts;
  these are packaging checks, **not** AWS performance measurements.
- `scripts/verify-h1-film-foundation.ps1 -Tag foundation-20261008-r1` confirms
  the actual AWS digest, zero concurrency, no mappings/URL/invoke policy and
  log-only IAM. No AWS film conversion or pipeline upload was performed.

Evidence: `L:\tmp\halospawns-h1-dev-foundation-20261008`.
Published compressed image size: 153,846,816 bytes. Storage remains billable;
zero reserved concurrency prevents event execution, rather than relying on
producers being absent. See [AWS concurrency controls](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html).

Exact provisioning commands from the repository root:

```powershell
.\scripts\plan.ps1 dev ecr
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\ecr' apply -no-color dev-ecr.planfile
.\scripts\publish-h1-film.ps1 -Tag foundation-20261008-r1 `
  -EngineRoot 'L:\tmp\halospawns-h1-layout-20261008\bundle\engines'
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\map-processing' apply -no-color dev-map-processing.planfile
```

ECR plan/apply: 2 additions, no changes/deletions. Initial processing plan:
4 additions, no changes/deletions; apply created the role/policy/log group
before the memory-cap error. After pinning 3,008 MiB, re-ran the focused plan
and saved-plan apply: 1 addition, no changes/deletions. Existing consumer
resources were no-op. Pre-apply aggregate dev planning found only H1 resource
additions and unrelated API output drift `app_lambda_function_version`
`164 -> 168`, which was not applied. Final focused `map-processing` and full
dev plans have zero resource actions: `ecr`/`map-processing` and the other
foundation components are no-op, with only that unchanged API output drift.
No AWS profile/session blocker remains. The account memory cap was handled
with the explicit dev stack value, not an account-wide change.

The installed Atmos 1.216.0 ignored `apply --from-plan` in this session and
attempted an interactive apply, which failed at EOF without changes. Its
explicit `plan -out=...` attempt also failed argument parsing. Normal script
plans produced the expected files. After checking their JSON action lists
and dormant settings, applied those exact saved plans with native Terraform
`-chdir`. No state manipulation or unrelated apply was used.

## Deployment choice

Keep the implementation in `halospawns-infra` initially. Use a dedicated H1
worker function with the existing replay finalization implementation, rather
than duplicating that implementation in a new Node service. Its engine still
runs in Node/WASM; the eventual intake image can invoke Node and the Rust
encoder/extractor as bounded child processes. The existing Xbox worker and
its release pin should remain independent during adoption.

The dormant foundation uses an immutable container image deployed by infra,
following the existing replay-parser pattern. `map-processing` owns the
function/IAM/event mapping, `uploads-ingest` owns its input queue/DLQ/prefix
routing, and `ecr` owns its repository. Do not create a root Terraform module.
Do not put the H1 code behind an already-enabled Xbox consumer before the
source-format routing contract exists.
Use an input prefix disjoint from the existing `replays/unprocessed/` S3
notification (for example, proposed `films/unprocessed/`); a nested H1 prefix
would still trigger the enabled Xbox consumer. The final prefix is part of
the API/infra job contract, not an applied configuration in this change.

A separate `halospawns-replays` repository remains a useful later extraction:
move both source adapters and the shared analytics/finalizer together, or
publish the shared code as a versioned internal package. The encoder currently
includes this repo's `native/src/viewer.rs` and contract resources by relative
path; copying only `lambda/h1_film` would not be a self-contained release.
Do not fork the projection, analytics or completion-retry implementation.

The existing code updater is an S3 **ZIP** updater, not an ECR-image updater.
Using it requires a new ZIP-managed function, an artifact bucket/prefix,
GitHub OIDC publish role and `live` alias through `lambda-s3-managed` and
`lambda-code-updater`. CI uploads a versioned release ZIP only; the updater
owns publication/promotion. First prove the whole package, including any
bundled Node/Python runtime and native libraries, fits and runs on Linux.
Lambda cannot change an existing function from Image to Zip in place, and
ZIP plus layers must fit the 250 MB uncompressed limit. See
[AWS ZIP deployment](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-zip.html)
and [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).

## Local integration implemented

`convert.mjs --analytics` now additionally writes
`candidate/analytics.30hz.json.zst`. This is a private, non-playable
intermediate, **not** the canonical uploaded replay or a viewer fallback.

- Native 120 Hz compact replay bytes and the optional 30 Hz compact bytes are
  unchanged. All six counter series are observed at 120 Hz before aggregation.
- Analytics positions use every fourth source tick, excluding dead-body
  positions. Existing 30 Hz graphs, occupancy weights and region rollups
  therefore receive their established units. A future full-rate analytics
  contract can replace this adapter without changing the engine profile.
- Final counters include a partial final four-tick interval. Initial graph
  baselines remain separate even for a one-sample film.
- Mode, variant name and teamplay are supplied to normal game/fact extraction.
  Observed match-end duration is separate from retained recording/postgame
  duration. No UTC start time or host/controller layout is invented.
- The stream omits model nodes, weapons and world objects. It is bounded to
  256 MiB raw / 64 MiB compressed, and retains at most one pending sample.
- `lambda/h1_film/analytics.py` verifies film/product hashes, simulation
  completion and map provenance, then adapts the ordinary `ParsedReplay`.
  It is not registered in the live handler or deployment image yet.
- `reconcile.py` runs both actual Xbox analytics extractors and requires
  identical semantic results. It then uses the existing container assembler,
  immutable viewer writer, spatial writer and finalization payload builder.
  AWS clients are replaced before importing the handler; writes go to local
  files, with no callbacks or database operations.
- `verify-api-products.py` validates that callback through the API's real
  `ReplayIngestRequest` and calls its graph/spatial-event builders without a DB.

## Engine and map identity

`runtime/profiles.mjs` selects an exact format/protocol/tick-rate/build tuple from
the shared `profiles/registry.json` and
pins both the WASM and Node glue hashes. The initial profile is
`h1-performance-beta3-p45-wasm-v1`: format 2, protocol 45, 120 Hz,
`2.0 Public Beta 3 - September 28 2026`. Unknown tuples fail closed. New
versions need a separate reviewed profile and their own deterministic corpus.

`--map-catalog` takes a trusted `halospawns.h1FilmMapCatalog.v1` inventory:

```json
{
  "schema": "halospawns.h1FilmMapCatalog.v1",
  "maps": [{
    "engine_profile": "h1-performance-beta3-p45-wasm-v1",
    "scenario": "dread",
    "size_bytes": 74758912,
    "sha256": "d8de6acf667e104a076a4ebbf9d1b0a028dccb8e19a2cb7a12116363a6bd9382"
  }]
}
```

Hosted bindings can additionally carry an API-owned `map_id` and reviewed
`game_release_key`. Zero or multiple matching build/name/size entries fail;
the downloaded raw cache must match the binding's SHA-256. Format 2 does not
record a cryptographic map hash: this is a reviewed catalog binding plus
clean simulation verification, not a hash recovered from the film.
Never infer a release from the shared `Invader 0.54.2.r4101` compiler string.
GLBs cannot replace the raw `.map` required by simulation.

`tools/catalog-local-maps.mjs` creates an explicitly operator-asserted test inventory
from a local build directory, checking PC v7 cache headers, scenario names,
sizes and hashes. It skips UI/bitmap/sound/localization resources, including
the build's empty `bitmaps.map`. All 40 Beta 3 playable maps were cataloged;
this did not verify their hosted database identities. Cloud raw-map resolution
is an API-owned pending contract, not a filename-only S3 search.

## Evidence

Local evidence is under `L:\tmp\halospawns-h1-integration-20261008`.
`dread` and `downrush` contain conversions; `*-finalization` contain complete
offline callback JSON, spatial gzip, reassembled viewer files, reconciliation
reports and API-builder reports. Original film/map/native fixtures were not
modified. The original optimized encoder installation was not replaced.

| Result | Dread | Downrush |
| --- | ---: | ---: |
| Native 120 Hz states | 75,584 | 80,430 |
| Analytics 30 Hz samples | 18,896 | 20,108 |
| Canonical/native compact comparisons | Both rates byte-identical | Both rates byte-identical |
| World-hash checks, zero mismatches | 630 | 671 |
| Participant stat rows | 4 | 4 |
| Spawn coordinates | 63 | 23 |
| Graph families, each with four players | 6 | 6 |
| Valid kill/death spatial events | 192 | 165 |
| Live occupancy observations | 58,641 | 64,806 |
| Distinct 0.5-unit occupancy cells | 4,974 | 4,925 |
| Compressed analytics bytes | 1,539,642 | 1,658,773 |
| Conversion including analytics, Windows seconds | 44.19 | 30.71 |

These are local functional runs, not new AWS performance measurements.
Final-source repeat runs are in `{dread,downrush}-final-check` and
`{dread,downrush}-final-check-products`, using freshly built encoder/extractor
binaries. Both again passed byte comparisons, parser parity and API builders;
conversion pipeline times were 45.03 / 29.74 seconds. Analytics bytes and counts
were unchanged. The newer reports additionally retain initial counter baselines
and explicitly identify local-only, not-yet-hosted map resolution.
Reassembly changes the manifest replay ID to a test upload UUID, so the
reassembled site's container hash intentionally differs from the original
native-reference file. Its encoded chunks are reused.

Passing the two production extractors proves compatibility of the generated
analytics source, **not** that an Xbox capture of the same match has identical
statistics. The earlier 32-film corpus measured converter performance and
simulation, not this new analytics integration.

## Remaining data reconciliation

Do not enable general site aggregation until these definitions are reconciled
or explicitly represented as unavailable/non-comparable in the API:

| Area | Current H1 evidence | Work still required |
| --- | --- | --- |
| K/D/A, scores, suicides, betrayals | Final engine counters; all-tick deltas | Partial recordings, non-Slayer modes and score-unit fixtures |
| Shots/hits | PGCR totals; shot timeline | Match Xbox counting semantics, especially energy weapons; export per-weapon attribution |
| Damage | PGCR dealt points are rounded; taken includes self/environment damage | Export precise attacker/victim damage; reconcile Xbox attributed/vitality-clamped definition |
| Opponent matrices | Not present | Authoritative kill/death/damage attribution; never pair simultaneous counter increments by guesswork |
| Streaks/multikills | Not present | Export authoritative events/state and verify reset/window rules |
| Powerups | Camo/overshield totals | Export pickup timeline series |
| Variant | Name, mode, teams | Decode/export the full recorded variant, not a name lookup |
| Host/splitscreen | Deliberately omitted | Read original roster/machine evidence, not replay-local seats |
| Time | Relative clocks and observed match end | Authoritative recording timestamp is absent; do not turn filesystem mtime into game UTC |

References: converter `export.c` and `encoder/src/main.rs`, production
`handler.py`, API `services/replay_ingest.py` and
`repositories/replay_ingest.py`, and Xbox producer
`../xqemu-tools/xemu-tools-rs/src/events.rs`. Detailed availability is included
in offline callbacks at `metadata.h1_film.known_gaps`. Merely adding this metadata
does not make existing API aggregation enforce it; that is a rollout gate.

## Ordered rollout work

1. Finish engine analytics instrumentation and paired semantic fixtures above.
   Preserve the clean world hashes and both-rate rendering regressions.
   Re-run representative maps and partial/non-Slayer films, not only the two
   Team Slayer matches. Add hostile header/action/map tests, process deadlines,
   bounded logs/output/disk checks, child environment isolation and cleanup.
   Current NODERAWFS trusted-local runner is not an upload security boundary.
2. Implement API handoff `20261008-infra-api-h1film-ingest-contract`: source
   typing, gated presigns, version-pinned raw-map lookup, reprocess routing,
   availability and validated playback-rate metadata. Retain the original
   `.h1film` as canonical source. Do not expose it as a playable Xbox fallback.
3. Implement frontend handoff `20261008-infra-svelte-h1film-120hz-viewer`.
   The local harness mutates global config before mounting; hosted support
   must select and reset a session-owned rate through API metadata, with old
   Xbox assets remaining 30 Hz. Released closed manifests stay immutable.
4. Build a private immutable Linux image from pinned engine/glue/encoder,
   shared parser and projection contracts. Keep proprietary map/source inputs
   out of public source control. Add a real H1 source adapter at the common
   finalizer boundary; do not teach the Xbox decompressor to guess at film bytes.
   Choose only 120 Hz for the normal hosted viewer output; the local dual-rate
   comparison output is not a requirement to store both representations forever.
5. Extend the dormant foundation with a **disabled** dedicated queue/intake
   through the owning components. The deployed function is 3,008 MiB memory,
   8,192 MiB `/tmp`, 900-second timeout and zero concurrency. Future consumer
   settings should use batch size 1 and bounded concurrency. Benchmark 4,096 MiB
   only after an account-limit increase is separately reviewed.
   A Docker quota of two CPUs/2 GiB is not equivalent to Lambda's CPU allocation.
   Reserve time for verification/uploads/callback persistence before the Lambda
   deadline. Measure cold/warm runs and the largest supported film in actual dev.
6. Reuse version/hash-pinned downloads, immutable outputs, persisted completion
   retries, stale-attempt guards, HMAC/SSM-only callbacks, DLQ behavior and logs.
   Grant only the needed raw-map/source/derived prefixes and exact parameters.
   Keep converter-derived artifacts out of source notification prefixes.
7. Run focused plans for the changed components, then `scripts/plan.ps1 dev`.
   Publish the pinned image before applying the disabled function. Coordinate
   API/frontend readiness and existing revision-2 rollout gates before one
   reviewed dev upload. Verify catalog map identity, scoreboard, graphs, spatial
   and region reads, viewer timing, retry idempotency and queue drain, then
   enable bounded consumers. Prod remains separately gated by its runbook.

Standard Lambda invocation timeout is at most 900 seconds; CPU scales with
configured memory. Recheck the [AWS limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
when finalizing deployment. Films outside the reviewed resource/time envelope
need rejection or a separate longer-running compute path, not repeated timeouts.

## Reproduce locally

Use the configured repo Python environment and the existing native extractor.
These commands never contact AWS. Output directories/files must be new.

```powershell
$h1 = 'L:\bens_stuff\xbox mod\Games\H1 Performance Build 2.0 Beta 3'
$out = 'L:\tmp\halospawns-h1-integration-20261008'
node lambda/h1_film/tools/catalog-local-maps.mjs --maps "$h1/maps" `
  --profile h1-performance-beta3-p45-wasm-v1 --trusted-local --output "$out/maps.json"
cargo build --locked --release --manifest-path lambda/h1_film/encoder/Cargo.toml `
  --target-dir "$out/target"
cargo build --locked --release --manifest-path lambda/replay_parser/native/Cargo.toml `
  --target-dir "$out/target"
node lambda/h1_film/convert.mjs --film "$h1/films/<film>.h1film" `
  --assets $h1 --engine 'L:\tmp\halospawns-h1-film-wasm-20261004\h1-film.js' `
  --encoder "$out/target/release/h1-film-encoder.exe" --trusted-local `
  --analytics --map-catalog "$out/maps.json" --output "$out/<new-run>"
.\.venv\Scripts\python.exe lambda/h1_film/tools/reconcile.py `
  --conversion "$out/<new-run>" --film "$h1/films/<film>.h1film" `
  --extractor "$out/target/release/replay-extractor.exe" `
  --output "$out/<new-finalization>"
```

For byte-exact native comparison replace `--trusted-local` with
`--reference <original-native-directory>`; reconciliation then independently
compares both actual compact files with that reference. The API proof script
requires the sibling API's dependencies; the infra environment alone lacks
Pydantic. This isolated command leaves the repository environment unchanged:

```powershell
uv run --no-project --python '.\.venv\Scripts\python.exe' `
  --with 'pydantic>=2.7,<3' --with 'psycopg[binary]>=3.2,<4' `
  --with 'numpy>=1.26,<3' --with 'aws-lambda-powertools>=3,<4' `
  --with boto3 --with jsonschema lambda/h1_film/tools/verify-api-products.py `
  --api ../halospawns-api --finalization "$out/<new-finalization>/finalization.json" `
  --output "$out/<new-finalization>/api-products.json"
```

## Focused validation

The final source passed these checks on 2026-10-08:

- Production parser suite: 81 tests passed, including native binary checks.
- Relocated H1 analytics/profile suite: eight Python tests passed.
- H1 encoder/shared codec: 33 tests passed; one opt-in profiling test ignored.
- Film/profile/map/engine-store/source-fingerprint suite: ten Node tests passed.
- PowerShell build-orchestration test passed with a mocked compiler: distinct
  source stages, no candidate overwrite, and changed-input rejection.
- Ruff `E9,F,I` checks and infra `git diff --check` passed.
- Fresh Dread/Downrush conversions selected the retained Beta 3 engine from the
  new private bundle. Both rates matched the original native references exactly;
  analytics bytes, production-parser parity and API graph/spatial results stayed
  unchanged. Evidence: `L:\tmp\halospawns-h1-layout-20261008`.
- The relocated map catalog tool reproduced the original 40-map catalog exactly.

This cleanup reused the pinned WASM binaries. The new build helper's fingerprints,
PowerShell syntax and orchestration were tested; a full Emscripten recompilation
was not performed by the relocation. The subsequent dev foundation above
built and verified the Linux image without replacing the pinned WASM engine.

```powershell
$env:REPLAY_EXTRACTOR_TEST_BINARY = "$out/target/release/replay-extractor.exe"
.\.venv\Scripts\python.exe -m unittest discover -s lambda/replay_parser/tests
.\.venv\Scripts\python.exe -m unittest discover -s lambda/h1_film/tests
cargo test --locked --manifest-path lambda/h1_film/encoder/Cargo.toml `
  --target-dir lambda/replay_parser/native/target
node --test lambda/h1_film/tests/*.test.mjs
.\lambda\h1_film\tests\build-engine.test.ps1
```

Use the freshly built extractor: the older installed September 27 binary failed
two current default-revision tests; rebuilding from existing source resolved
both without changing the extractor implementation. Both fresh integration
binaries remain under the temporary evidence directory, leaving the original
installed converter/extractor binaries untouched.

The earlier relocation/local integration required no Terraform or AWS changes.
The subsequent dormant dev deployment is recorded above; hosted ingestion and
viewer validation remain pending.
