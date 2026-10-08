# H1 Film Worker

Home of the Node/WASM H1 converter, Rust compact encoder and Python analytics
adapter. A dormant dev runtime is deployed as `halospawns-h1-film-dev` with
zero concurrency and no triggers or data access. Cloud intake/finalization
and hosted viewer adoption remain gated; existing Xbox uploads are unchanged.

## Layout

| Path | Responsibility |
| --- | --- |
| `convert.mjs` | Local CLI, including the differential/native-reference mode |
| `handler.mjs`, `Dockerfile` | Health-only, fail-closed Lambda foundation and private Linux image |
| `runtime/` | Reusable `convertFilm`, exact profile dispatch and engine verification |
| `runtime/adapters/` | Versioned film readers and simulation verification |
| `profiles/registry.json` | Shared Node/Python engine identities, ABI and artifact pins |
| `engines/beta3/` | Beta 3 exporter, WASM compatibility port and native reference integration |
| `encoder/` | Bounded tick-stream encoder; reuses `../replay_parser` codecs/contracts |
| `analytics.py`, `registry.py` | Verified products and normal replay-parser adaptation |
| `tools/` | Candidate builds, engine staging/auditing, catalogs and offline reconciliation |
| `tests/` | Profile retention, multi-version dispatch, integrity and analytics tests |

Benchmark history, comparisons and the Windows-native oracle remain under
`../../experiments/h1-film`. Its old WASM conversion CLI forwards here; active
runtime code never imports from `experiments`. Game source, raw maps, compiled
engines and generated replay files are not committed to this package.

## Dev Foundation

The immutable image contains the converter and every registered engine. It
does **not** contain a cloud upload handler, Python finalizer or game maps.
The handler accepts only the exact `halospawns.h1FilmHealth.v1` health request;
job events fail, never return an empty success batch. AWS concurrency is zero,
so even health invocations are blocked there. Local container tests exercise
the real Lambda runtime interface before publication.

```powershell
.\scripts\publish-h1-film.ps1 -Tag '<new-release-tag>' -EngineRoot '<private-engine-store>' -BuildOnly
.\scripts\verify-h1-film-foundation.ps1 -Tag foundation-20261008-r1
```

Omitting `-BuildOnly` publishes to private dev ECR after account, immutability,
engine-retention and container checks. It does not update Lambda. Pin the new
tag in `stacks/dev.yaml`, review the `map-processing` plan, then apply it.
Use `-PreviousRegistry` with the previous immutable release's registry for
later releases. Terraform resolves the release tag to an image digest.
See [deployment](DEPLOYMENT.md#dev-foundation-deployed-2026-10-08) for the exact
foundation scope, validation evidence and still-required activation gates.

## Supported Versions

Currently registered: Performance Build Beta 3, format 2 / protocol 45 / 120 Hz,
build `2.0 Public Beta 3 - September 28 2026`.

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
