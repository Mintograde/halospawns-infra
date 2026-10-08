# H1 Film Compatibility

## Three Independent Versions

1. **Simulation profile:** the exact film format, protocol, tick rate and build
   string select the decompiled engine that recorded it. Preserve its WASM and
   Node glue by SHA-256. A newer simulator is not assumed to reproduce older
   physics, random sequences, object layouts or film actions.
2. **Export/analytics adapter:** `HSFT0001` currently exports the normalized
   120 Hz tick stream; `halospawns.h1AnalyticsSource.v1` supplies 30 Hz analytics.
   Engine layouts and format readers live in versioned ports/adapters, not in
   the viewer codec. New ABIs/rates require explicit adapters. The Rust encoder
   rejects unknown contracts instead of treating all future data as Beta 3.
3. **Viewer artifact contract:** the shared revision-1/2 projection, delta codec
   and closed manifest remain owned by `../replay_parser` and the API. Supporting
   a new game source must not rename or mutate released viewer contract hashes.
   Existing compact files play without the simulator that produced them.

The Lambda software release is a bundle of these capabilities, not a single
game version. Updating that bundle must preserve old profile IDs and adapters.

## Registry and Engine Store

`profiles/registry.json` is the single source read by Node and Python. Each entry
pins the film tuple, adapter/port, export/analytics contracts, map cache format,
and both engine artifact hashes. Profile IDs are permanent. Unknown builds,
duplicate IDs and duplicate film tuples fail validation; there is no newest or
closest-version fallback. Python verifies the report's original tuple and both
engine hashes, not just a caller-supplied profile label.

Private bundle layout:

```text
engines/
  h1-performance-beta3-p45-wasm-v1/
    package.json             # generated CommonJS boundary for Emscripten glue
    h1-film.js
    h1-film.wasm
  <another-reviewed-profile>/
    ...
```

Use `tools/stage-engine.mjs` to populate new profile directories without
overwriting existing ones. It verifies both original and copied bytes. Use
`tools/check-release.mjs --engine-root <bundle> --previous-registry <previous release registry>`
before publishing. This requires every current profile's files and retains all
previous profile records exactly. CI must retrieve the previous immutable
registry from release storage, not regenerate it from the candidate checkout.
The checked-in `tests/fixtures/retained-profiles.json` is the initial compatibility
floor; append newly released profiles there without rewriting earlier entries.

Persist the selected profile ID, source film hash, raw map binding and artifact
generation with jobs/results. Retries must not reselect a different engine after
a software rollout. The runtime's `--profile` assertion rejects that mismatch.
Cloud job persistence is still part of the API/worker integration handoff.

Raw maps stay scoped to the selected engine profile and reviewed release.
Identical scenario names or file sizes across decomp builds do not establish
compatibility. Preserve the original matching raw maps and source films as well
as the engine binaries. GLBs alone cannot regenerate a film.

## Adding a Decompilation Version

1. Keep the old upstream source snapshot and compiled engine in private immutable
   storage. Do not rebuild old profiles from the newest source checkout. No game
   source, binaries or maps belong in public source control.
2. Choose an existing port only after checking layout/export compatibility. For
   incompatible source changes, add `engines/<new-port>/` with its own exporter,
   CMake compatibility rules and pinned `port.json` toolchain. Leave the old port
   available. Do not globally patch the Beta 3 integration to match a new layout.
3. Build a candidate into a new output directory:

   ```powershell
   .\lambda\h1_film\tools\build-engine.ps1 -Port beta3 `
     -Source '<private source snapshot>' -BuildDirectory '<new candidate directory>'
   ```

   The helper records hashes of all build-relevant upstream files (root
   `CMakeLists.txt`, `engine/`, `host/`), the versioned port and toolchain.
   Cache paths include source and port fingerprints, so additions/deletions or
   same-named newer sources cannot reuse a mixed source stage. Source directories
   are read-only; generated compatibility edits stay in the build cache. It
   verifies the live input fingerprint again after compilation. The output is
   a candidate, not automatic profile registration or publication.
4. Compare that candidate against a native oracle for the new source, including
   deterministic world hashes, score/events, timer/animation units, map bindings,
   partial recordings and supported modes. A candidate with an unknown hash
   intentionally cannot pass the registered converter until a reviewed local
   registry entry is added. Never change the existing Beta 3 entry to test it.
5. Add one new profile with the exact **observable** film tuple and candidate
   hashes. For the same format/ABI/rate, a registry entry and compatible port can
   suffice. New format/ABI/rate needs an additional reader/export/analytics
   adapter and its tests while retaining the old ones. Never register guessed
   wildcard builds, arbitrary binary paths or a profile that guesses a map.
6. Run Node/Python/Rust tests and both old and new real-film corpora. The synthetic
   two-version tests prove routing/isolation only; they do not simulate an actual
   future game version. Check the previous registry and **all** bundled binaries,
   then publish an immutable worker release through the reviewed deployment path.
   Add the new profile to the retention fixture at release time.

If upstream changes simulation while reusing the same build/protocol/rate tuple,
format 2 cannot reliably distinguish those sources. The current registry rejects
that ambiguity. Obtain a new recorded build identifier or design a separately
verified discriminator before enabling both; do not silently substitute engines.

Source fingerprints document new build candidates. They do not retroactively
prove the source provenance of an old binary; the existing Beta 3 binaries retain
their established SHA-256 pins and real-film parity evidence.

## Regression Evidence

The initial retained corpus is Dread and Downrush from the Beta 3 build. Original
native references remain at `L:\tmp\halospawns-h1-film-20261003-parity-v2`.
The earlier analytics proof remains at
`L:\tmp\halospawns-h1-integration-20261008`; the relocated worker's checks use
`L:\tmp\halospawns-h1-layout-20261008`.

Maintain exact decoded old tick/metadata values and pinned viewer-contract goldens.
The current relocation also checks byte-identical compact files at both rates.
Any intentional analytics correction needs an explicit fixture change and
availability/reprocessing decision, not an unreviewed consequence of choosing a
newer decompilation. Remaining semantic, security, API, frontend and deployment
gates are unchanged in [DEPLOYMENT.md](DEPLOYMENT.md).
