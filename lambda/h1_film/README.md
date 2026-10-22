# H1 Film Worker

Home of the Node/WASM H1 converter, Rust compact encoder and Python analytics
adapter. The dev intake worker is deployed as `halospawns-h1-film-dev`, pinned
to `20261022-r1`, with dedicated queue/API wiring and scoped data access.
New intake selects exporter 5 / analytics 4 / viewer 4 after verifying API
`live=188`. Admin reprocess defaults remain exporter 4 / analytics 3; explicit
5/4 requests work. Old pins remain supported. See [deployment](DEPLOYMENT.md).
The user enabled the single-user dev preview on 2026-10-09: concurrency five,
SQS mapping enabled and both API capability flags true. Broader acceptance and
prod activation remain pending; Xbox uploads are unchanged.

The deployed [combat analytics implementation](COMBAT_ANALYTICS.md) adds retained
exporter 5 / analytics revision 4, with discharge lineage, applied damage,
callback deaths and engine awards. One fenced dev canary passes with unchanged
viewer bytes, scoreboard, graphs and occupancy. Remaining admin-default
coordination, bulk backfill and broader hosted acceptance are not implied.

New H1 conversions select [bounded pose compression](POSE_COMPRESSION.md),
viewer revision 4 / `HSRDC002`. The fine candidate preserves every tick and all
non-pose data, with measured artifacts about 4.3x smaller. Old contracts and
explicit jobs remain supported; see deployment notes for the dev rollout.

## Layout

| Path | Responsibility |
| --- | --- |
| `convert.mjs` | Local CLI, including the differential/native-reference mode |
| `worker.py`, `cloud.py`, `Dockerfile` | Python Lambda intake, bounded Node/WASM conversion and shared replay finalization |
| `handler.mjs` | Exact health request and retained fail-closed foundation mode |
| `contracts/` | API-owned v1 job/completion schema snapshots; semantic checks also run in `cloud.py` |
| `runtime/` | Reusable `convertFilm`, exact profile dispatch and engine verification |
| `runtime/adapters/` | Versioned film readers and simulation verification |
| `profiles/registry.json` | Shared Node/Python engine identities, ABI and artifact pins |
| `engines/beta3/` | Beta 3 exporter, WASM compatibility port and native reference integration |
| `engines/h1arena/` | Retained prerelease 197bb65c port and native reference |
| `engines/beta4/` | Performance Build 2 Beta 4, pinned to e78e4daa; see [Beta 4](BETA4.md) |
| `encoder/` | Bounded tick-stream encoder; reuses `../replay_parser` codecs/contracts |
| `pose_codec/` | Shared bounded pose math, temporal tracks and exact fallbacks |
| `analytics.py`, `registry.py`, `recorded.py` | Verified native products, retained profiles, recorded rules/events and replay-parser adaptation |
| `tools/` | Candidate builds, engine staging/auditing, catalogs and offline reconciliation |
| `tests/` | Profile retention, multi-version dispatch, intake/retry, integrity and analytics tests |

Benchmark history, comparisons and the Windows-native oracle remain under
`../../experiments/h1-film`. Its old WASM conversion CLI forwards here; active
runtime code never imports from `experiments`. Game source, raw maps, compiled
engines and generated replay files are not committed to this package.

The second dev [performance release](PERFORMANCE.md#second-local-candidate)
reduces offline conversion time by 48% against the prior release across nine
maps, with identical products. It optimizes the Rust encoder and Linux
backpressure. Current [deployment notes](DEPLOYMENT.md) record actual Lambda
measurements for the pose release; the native-engine experiment is not deployed.

The [third local performance pass](PERFORMANCE.md#third-local-candidate) compares
numeric-array optimizations and a full-worker native experiment against R2.
The native engine experiment is not deployed; the current dev pin above remains authoritative.

The [typed transport pass](TYPED_TRANSPORT.md) reduces internal serialization
and copying while preserving complete logical exports and public replay bytes.
Exporter 4 is the dev default after the coordinated API/worker release.
The measured 18.23% improvement is against `runtime-20261011-r2`
in the offline corpus, not a hosted Lambda measurement.

The [incremental-state pass](TYPED_TRANSPORT.md#retained-world-objects)
retains unchanged world objects through decoding, validation and delta encoding.
It reduces the nine-map offline runtime another 16.24% against the typed
exporter-4 worker, with identical artifacts. It is deployed and enabled for new
exporter-4 conversions; persisted older jobs keep their original paths.
See [measurements](PERFORMANCE.md#incremental-state-candidate-2026-10-14).

The next [typed-pose slice](TYPED_TRANSPORT.md#typed-player-poses) feeds matrices
directly into the codec and reuses bounded topology/transform workspaces. It cuts
another 6.71% from the nine-map offline runtime against that incremental-state
candidate, with identical products. Player metadata remains generic. This is
included in the deployed default image, not a hosted Lambda timing claim.
Retained exporter-3 jobs benefit only from shared codec improvements; new jobs use
the full typed path after [the coordinated switch-over](DEPLOYMENT.md#fully-switching-new-conversions).

The [native Linux candidate](tools/linux-candidate/README.md) builds upstream
`src/linux_server` from archived h1arena `865d1b3d` and connects the existing
exporter to the Rust encoder. Full tick streams and replay/analytics artifacts
match a WASM build of the same source on three fresh synthetic films. After the
performance pass, native takes **56.26% of the current WASM conversion time**
(43.74% less), down from the initial native candidate's 156.6%. The requested
half-time target is **not yet met**. Five paired runs use equal two-CPU limits;
WASM retains its released encoder while native uses the candidate encoder.
This remains an offline experiment, not a Lambda measurement or deployment;
the deployed engines and profile registry are unchanged.

## Dev Deployment

New H1 image release tags use `YYYYMMDD-rN`, for example `20261022-r1`.
The date is the UTC release date; `N` starts at 1 each day and increments for
each new release that day. Tags have no content description and are immutable;
never reuse or overwrite one. The publisher validates the date and sequence.
Release notes describe changes. This sequence is independent of engine profiles,
exporter revisions, analytics revisions and viewer revisions. Existing historical
tags remain valid for audit and rollback.

The immutable image contains every registered engine, the Python source adapter,
and the shared replay parser/finalizer. Game maps/source are excluded.
Foundation mode still accepts only the exact `halospawns.h1FilmHealth.v1`
request and rejects jobs. Dev uses intake mode with its batch-one SQS mapping
as the only configured job entry point; there is no function URL or invoke policy.
The foundation audit below deliberately expects dormant gates, not current dev.

```powershell
.\scripts\publish-h1-film.ps1 -Tag '<YYYYMMDD-rN>' -EngineRoot '<private-engine-store>' -BuildOnly
.\scripts\verify-h1-film-foundation.ps1 -Tag 20261022-r1 -Mode intake
```

Omitting `-BuildOnly` publishes to private dev ECR after account, immutability,
engine-retention and container checks. It does not update Lambda. Pin the new
tag in `stacks/dev.yaml`, review the `map-processing` plan, then apply it.
Use `-PreviousRegistry` with the previous immutable release's registry for
later releases. Terraform resolves the release tag to an image digest.
See [deployment](DEPLOYMENT.md#dev-intake-wiring-deployed-2026-10-08) for the exact
scope, validation evidence and still-required activation gates. Do not raise
concurrency or enable API flags merely because the image is deployed.

## Supported Versions

Registered simulations:

- Performance Build Beta 3, format 2 / protocol 45 / 120 Hz,
  build `2.0 Public Beta 3 - September 28 2026`, with its original exporter pins.
- h1arena snapshot `197bb65ca6e9cef94c126904bf39ecdd1ea5929d`, format 2 /
  protocol 9111 / 120 Hz, build `UNIVERSAL Only - 2026-10-14 - 197bb65c`.
  This is the renamed successor of the same project, not a separate game.
  The retained worker and API registration are deployed in dev; **profile-specific
  map approval remains required** before hosted conversion. It does not claim support
  for an upcoming release or arbitrary later commits. See
  [snapshot provenance and refresh](COMPATIBILITY.md#h1arena-snapshot-197bb65c).

New Lambda releases must carry **every retained engine**, not replace a single
`latest.wasm`. Film identity selects one exact profile and its pinned engine;
missing/unknown/ambiguous identities fail. See [compatibility](COMPATIBILITY.md)
before adding another decompilation version. The registry is extensible, but no
unseen future source build is claimed to work without validation.

## Local Conversion

Run from the repo root. Engine staging and conversion destinations must be new.
Obtain the original reviewed engine pair from private release storage or the
existing local `L:\tmp\halospawns-h1-film-wasm-20261004` directory.

```powershell
$out = 'L:\tmp\h1-film-new-run'
cargo build --locked --release --manifest-path lambda/h1_film/encoder/Cargo.toml `
  --target-dir .build/h1-encoder
node lambda/h1_film/tools/stage-engine.mjs `
  --profile h1-performance-beta3-p45-wasm-v1 `
  --from 'L:\tmp\halospawns-h1-film-wasm-20261004\h1-film.js' `
  --engine-root .build/h1-engines
node lambda/h1_film/tools/check-release.mjs --engine-root .build/h1-engines
node lambda/h1_film/convert.mjs --film '<film.h1film>' --assets '<build directory>' `
  --engine-root .build/h1-engines --encoder .build/h1-encoder/release/h1-film-encoder.exe `
  --trusted-local --analytics --map-catalog '<reviewed map catalog.json>' --output $out
```

`H1_ENGINE_ROOT` is the equivalent engine-store environment setting. `--engine`
remains a hash-verified local diagnostic override; it cannot override the film's
build identity. `--profile` is an optional assertion for persisted/pinned jobs,
not a way to force an incompatible simulator.

`--reference <native conversion>` replaces `--trusted-local` for byte-exact
comparison. The latter remains a trusted-local tool, not a hostile-upload API.
The optional analytics intermediate is never a viewer fallback or canonical
source. Full integration and reproduction: [DEPLOYMENT.md](DEPLOYMENT.md).

Local conversion still produces both viewer rates and performs an independent
readback by default. The cloud fast path uses `--source-viewer-only` together
with `--trusted-local --skip-readback`, requiring inline lossless verification
of every tick and compressed chunk. This omits only the unused 30 Hz viewer;
the 30 Hz analytics sidecar is retained.

Analytics revision 3 is deployed in dev. It adds native damage/pickup totals and
cumulative timelines, verified recorded kill pairs and a resolved-rules subset,
while retaining full postgame playback with match-only statistics/events/spatial
analytics. Revisions 1/2 remain supported. Existing games need an explicit
revision-3 full reparse; the ordinary admin UI currently omits that selector.
Use `--analytics-revision 3` for local native-product conversion. Boundary
semantics and remaining exporter gaps are in
[COMPATIBILITY.md](COMPATIBILITY.md#native-analytics-revision-3); release and
reparse details are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Validation

```powershell
npm --prefix lambda/h1_film test
.\.venv\Scripts\python.exe -m unittest discover -s lambda/h1_film/tests -v
cargo test --locked --manifest-path lambda/h1_film/encoder/Cargo.toml `
  --target-dir .build/h1-encoder
.\lambda\h1_film\tests\build-engine.test.ps1
```

Also run the production replay-parser suite with a freshly built
`REPLAY_EXTRACTOR_TEST_BINARY`, audit the full private engine bundle, and rerun
the retained real-film comparisons for releases. No Terraform resource or
deployed image pin is changed by these commands.
