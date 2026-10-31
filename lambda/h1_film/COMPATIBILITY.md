# H1 Film Compatibility

## PB2 recorder label matching (deployed, 2026-10-31 UTC)

`halospawns.h1RecordedBuild.v1` separates recorded labels from canonical engine
labels. The registry opts Beta 4 and Beta 5 into `source_commit_suffix_v1` via
the top-level `build_matching` map. Exact registered labels remain accepted.
Other printable ASCII labels (1–63 bytes) must end with a clean 8–40 character
lowercase Git prefix matching that profile's full source commit, either alone
or after ` - `. Format, protocol and rate must still match. Dirty `+` suffixes,
unknown commits, missing/truncated hashes and ambiguous profile matches fail.
This is not a protocol-only fallback or automatic support for future engines.

Profiles, binaries, exporter revisions, recipes and map approvals are unchanged.
The original label remains in the film envelope, settings and frozen conversion;
`engine.build` retains its canonical value. Retried attempts cannot rewrite the
recorded label, even to an equivalent spelling. Manifest registration requires
the new reader contract and retains previously registered build rules. Policy
rollback must retain these API/worker readers and rules.

The two supplied October 31 Windows Dread recordings identify Beta 5 commit
`fbbfae27` and pass 109,134 native/WASM ticks with identical full exports and
all 910 recorded hashes. Dev worker/default `20261031-r2`, policy revision 6,
and API 223 are deployed. Eighteen packaged films and all 54 exact deployed-API
callbacks pass. See `BETA5.md` and `DEPLOYMENT.md` for acceptance evidence.

## Beta 5 missing-size and roster recovery (2026-10-31 UTC)

Exporter 12 retains the Beta 5 profile and upstream commit, adds a new immutable
WASM pin, and keeps analytics 4 / viewer 5. API 222 supports the additional
`halospawns.h1MissingMapSize.v1` and `halospawns.h1InitialRosterRecovery.v1`
requirements. Zero recorded size resolves only through one reviewed
profile/scenario approval, preserving measured size, hash and S3 version.

Initial roster recovery is limited to the proven all-remote FFA subset described
in `BETA5.md`. Jobs freeze the recovered slots/handles/teams and original count;
completion must match. Missing names remain unknown. Separate client-predicted
world playback is still unsupported. All older profiles, binaries and recipes
remain available. Roll back defaults while retaining the current worker/API
readers for existing recovered jobs and receipts; do not repin old attempts.

## Beta 5 client diagnostic companion (deployed, 2026-10-29 UTC)

Worker/default `20261029-r4`, policy revision 4, and API `live=219` select Beta 5
11/4/5. `halospawns.h1ClientDiagnostics.v1` is an indexed companion to the same
viewer-5 world replay, bound to its immutable generation. API registration,
activation, ingest and asset delivery all recognize the contract. Old recipes
and readers remain; Beta 4 approvals copied to Beta 5 retain their exact pins.
All three real companions match the source byte-for-byte and upstream decoding;
the world replay hashes match exporter 10. Existing clients still play viewer 5.
Frontend reader/handoff changes stay local; overlay rendering is future work.
Rollback the policy while retaining the current worker/API readers for pinned
diagnostic jobs. See `CLIENT_DIAGNOSTICS.md` and `DEPLOYMENT.md`.

## Beta 5 (deployed, 2026-10-29 UTC)

Worker `20261029-r2` / API `live=217` add the separate `beta5` port and profile
`h1-performance-beta5-p9818-wasm-v1`, pinned to upstream `beta-5` commit
`fbbfae27d6be7e47613acce37da95ed754dccb42`. It accepts the supplied authoritative
`Linux server` recordings at protocol 9818 with exporter 10 / analytics 4 /
viewer 5. Client-view films and unregistered recorder labels remain unsupported.
The new envelope, network projectile records and settings layout have separate
adapters; every older engine, recipe and receipt reader is retained.

All three supplied Dread films match the native reference byte-for-byte and
pass all 964 recorded state hashes. Seven packaged films and 21 actual deployed
API success callbacks plus failure/receipt checks pass. The user-authorized
transfer copied all 70 Beta 4 map approvals with exact pins and audited lineage;
the originals remain unchanged. Default release `20261029-r2` is active at
policy revision 3. See `BETA5.md` and `DEPLOYMENT.md` for evidence and limits.

## Release catalogue (2026-10-27 UTC)

Compatible future engine/exporter registrations and per-profile defaults are
declared by the immutable worker release manifest. Read `RELEASES.md` before
changing pins or publishing. `h1_film.default_release` selects new initial/full
attempts; retries and viewer rebuilds preserve persisted pins. API legacy hash
tables remain frozen, and every subsequent image retains registered binaries,
recipes and readers. True contract/adapter changes still require reader support.

## Network Host Metadata (Deployed, 2026-10-25 UTC)

Worker `20261025-r3` and API `live=208` add optional `h1film.network_host`
evidence for reviewed Beta 4 network films. It maps to existing Host metadata
and facts without changing any engine/exporter/analytics/viewer/default pins.
Unknown evidence remains untagged; viewer rebuilds and old receipt replay do
not update host metadata. Six packaged films/eighteen deployed-API callbacks,
image-only apply and live operational checks pass. Existing completed games
need separately authorized full reparses. Retain the optional completion reader
and every prior binary/pin on rollback. See `BETA4.md`, `DEPLOYMENT.md` and
completed `20261025-infra-api-h1film-network-host`.

## Beta 4 Finite Loose-Weapon Exporter 10 (Deployed, 2026-10-25 UTC)

The user-authorized Weld fix is packaged in immutable worker `20261025-r2`.
Exporter 10 retains the Beta 4 profile, analytics 4, viewer 5 and every old
binary/pin. It omits loose weapons with unrepresentable transforms without
changing simulation or player validation. Five packaged films / fifteen
callbacks pass both source and deployed API live 207. The user allowed worker
activation during API CI; its compatible release was verified afterward.
Image-only apply, live engine/operational checks and focused postplan pass;
full dev has only the unapplied API version-output refresh 194 to 207.
New intake selects 10/4/5; API omission defaults stay 9. Existing attempts never
repin; recovery needs a separately authorized new explicit 10/4/5 attempt.
Retain 10 and all older binaries/registrations on rollback.
See `BETA4.md`, `DEPLOYMENT.md` and `20261025-infra-api-h1film-finite-exporter10`.

## Beta 4 Damage Attribution Exporter 9 (Deployed, 2026-10-25 UTC)

Exporter 9 adds read-only tag-reference resolution for recorded remote damage,
preserving the Beta 4 profile, analytics 4, viewer 5 and every old binary/pin.
Tracked shot lineage takes precedence; recovered damage never fabricates a
discharge ID. Ambiguous sources remain unknown, and network coverage remains
partial. Four real-film full native/WASM comparisons and packaged worker checks
pass. All twelve release-image callbacks also pass actual API `live=204`
without injected registration. Worker `20261025-r1` selects 9 for new Beta 4
intake. Omitted API/admin and inventory defaults still select 8; promotion is
API-owned in `20261025-infra-api-h1film-damage-exporter9`. Existing games need
separately authorized full reparses explicitly targeting 9/4/5; retries never
repin. Retain 9 and all older pins on rollback. See `BETA4.md` and `DEPLOYMENT.md`.

## Settings Evidence (Deployed, 2026-10-24)

`halospawns.h1FilmSettings.v1` is an independent bounded settings product on
new initial/full-reparse callbacks. Its schema, catalogue and extraction adapter
have separate versions; engine/analytics/viewer pins stay unchanged. Exact
profile adapters preserve the differing 57/60/61-field variant layouts and
recorded options offsets. Existing completion receipts without settings replay
unchanged; new receipts replay their exact settings without re-extraction.
Worker `20261024-r2` is deployed after verifying API `live=202` and its settings
contract. The API-owned migration is applied; retain its tables and compatible
ingest during rollback. No engine/exporter/default pin changed. See
[settings contract](SETTINGS.md), [release evidence](DEPLOYMENT.md) and
handoffs `20261024-infra-api-h1film-settings` /
`20261024-infra-svelte-h1film-settings`. No backfill/reparse was submitted.

## Beta 4 Network Replay Exporter 8

Deployed release `20261024-r1` adds exporter 8 under the unchanged Beta 4
profile, analytics 4 and viewer 5. It fixes network replay initialization and
native/WASM particle precision while retaining base/exporters 5/6/7 and all
older families exactly. The user's matching API `live=201` registration and
defaults were verified against its actual deployed artifact before worker
activation. Existing jobs/retries never repin. Same-profile raw-map approvals remain
valid. Rollback must retain exporter 8 once its jobs/artifacts exist.
Score carry-over on reused player slots is not fixed. See `BETA4.md` and
`DEPLOYMENT.md` for exact pins, tested scope and release status.

## Beta 4 Bot Replay Support

Deployed exporter 7 adds recorded bot playback using the same immutable Beta 4
profile, analytics 4 and viewer 5. Its new binary is additive; base/exporters
5/6 and every older family remain exact. New Beta 4 intake and omitted admin
reparse defaults select 7 in worker `20261023-r1` and API `live=195`. Existing
jobs/retries remain pinned. Existing same-profile raw-map approvals remain
valid; no cross-profile approval transfer is implied. Bot rosters allow at
most eleven bots/twelve total players, separately from network's sixteen-
participant ceiling. See [BETA4.md](BETA4.md) for parity evidence and
[DEPLOYMENT.md](DEPLOYMENT.md) for release evidence. Rollback must retain
exporter 7 once its jobs/artifacts exist; the retention fixture enforces it.

## Beta 4 Sixteen-Participant Extension

Beta 4 exporter 6 targets analytics 4 and the append-only viewer revision 5.
It supports sixteen distinct participant identities, with separate counters
when physical slots are reused. Base/exporter-5 Beta 4 and both older engine
families retain their exact binaries and four-player compatibility. Do not
repin old jobs. Revision 5 uses new projection/manifest/encoding hashes; the
revision-4 four-player contract and Xbox revision-2 default remain immutable.
The source producer's eight-initial-player metadata ceiling still fails closed;
late joins can occupy all sixteen slots. See [BETA4.md](BETA4.md) for limits,
parity evidence and deployment prerequisites. Rollback must retain exporter 6
and viewer 5 once their jobs/artifacts exist.

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

Exporter 4 uses private physical transport `HSFT0002` while
preserving the normalized `HSFT0001` export contract. The retained exporter entry
selects this wire format explicitly; older entries default to `HSFT0001` and keep
their original binaries. This is not a new simulation profile or public viewer
contract. Full-source canonical parity and rollout requirements are documented in
[TYPED_TRANSPORT.md](TYPED_TRANSPORT.md). Dev worker `combat-20261020-r1`
retains exporter 4 alongside the new exporter-5 intake default. Persisted jobs
and retries keep their pins. Retain exporter-4 API/worker support during rollback,
alongside the original exporters and viewer-4 readers.

The deployed incremental-state consumer keeps those exact exporter pins
and both transport contracts. It reuses immutable world-object records without
changing engine output or public products; it does not require another exporter
revision or API registration. The generic path remains available for older
transports/viewers and explicit `--generic-state` comparisons. Its typed path
requires exporter 4, now selected by default for new dev conversions.

The deployed typed-pose slice consumes the same packed matrices directly
in bounded numeric buffers and caches pose-run topology/scratch state. It retains
the generic decoder, schema ranges, raw pose fallback and independent error-bound
verification. `--generic-poses` isolates the transport change for offline ablation;
no new exporter, public format, quality setting or API contract is introduced.

## Registry and Engine Store

Exporter 5 adds opt-in [combat hooks](COMBAT_ANALYTICS.md) for both retained
families using the same `HSFT0002` transport. Explicit analytics revision 4
collects native schema v2; old revisions discard the extra internal field.
Dev `combat-20261020-r1` selects exporter 5 / analytics 4 for new intake after
verifying API `live=188`; admin defaults remain exporter 4 / analytics 3.
Both profiles' full callbacks pass the deployed API source. Revision-4 sidecar
rosters retain departed and between-sample players without invented positions;
earlier revisions and viewer bytes are unchanged. All prior binary records,
source identities and retries remain pinned. Retain exporter-5/native-v2 support
during rollback now that a hosted revision-4 generation exists.

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

## h1arena Snapshot 197bb65c

The public successor is now the separate [`beta4` port](BETA4.md), pinned to
release commit `e78e4daa4b6d6b3e9ca290e3ebfe7a993ed558ad`. The prerelease
snapshot below remains immutable for existing films and retries.

h1arena is the renamed continuation of Performance Build 2.0 Beta 3. The new
profile `h1arena-197bb65c-p9111-wasm-v1` targets the exact archived commit
`197bb65ca6e9cef94c126904bf39ecdd1ea5929d`, dated 2026-10-14. It is a prerelease
snapshot, not a claim about the maintainers' upcoming release. No existing Beta 3
profile, exporter, job or map review is replaced.

Although both recordings say format 2, this snapshot is incompatible with the
Beta 3 simulator: protocol 9111, a 480-byte header rather than 448, expanded
settings/resolved variants, new movement tuning, and packed FNET v2 effects.
The exact observable build is `UNIVERSAL Only - 2026-10-14 - 197bb65c`.
The separate adapter validates sections, roster bounds, MSZIP expansion and
every recorded network effect. The WASM port retains upstream movement and
extracts upstream offline transform/damage/team/quit/end handlers at build time;
live networking, rendering and physical input are not used by conversion.
The normalized export/analytics/viewer contracts are unchanged. Both this
profile's base engine and its exporter-4 entry use `HSFT0002`; exporter 4 remains
the preferred worker pin. Older profiles retain their exact transport defaults.

Each new profile carries `source.project`, the **full** `source.git_commit`,
`source.git_date`, and a source-tree SHA-256/file count/algorithm. Build manifests,
health inventories and conversion reports (`provenance.engine_source`) preserve
that identity. Python finalization rejects absent or differing provenance for
these profiles. The old Beta 3 profile deliberately has no invented Git commit.

Build from an archive, never from the changing working tree:

```powershell
node lambda/h1_film/tools/snapshot-source.mjs `
  --repository 'L:\bens_stuff\projects\h1-arena' `
  --commit 197bb65ca6e9cef94c126904bf39ecdd1ea5929d `
  --output '<new private snapshot directory>'
.\lambda\h1_film\tools\build-engine.ps1 -Port h1arena `
  -Source '<snapshot directory>\src' -BuildDirectory '<new private build directory>'
```

The archive excludes dirty/untracked work. Its manifest is checked against all
build-relevant files, including `src/tools`; the builder supplies the archived
commit/date to the build label and rejects mutations during compilation. The
shared Beta 3 exporter/compatibility helpers are also included in the new port
fingerprint, without modifying the retained Beta 3 port or binaries.

For the native oracle, set `BLAMPC_BUILD_COMMIT=197bb65c` and
`BLAMPC_BUILD_DATE=2026-10-14`, configure `engines/h1arena/native` with
`-G 'Visual Studio 17 2022' -A Win32 -DH1_SOURCE=<snapshot src>` and
`-DBLAMPC_STATIC_CRT=ON`, then build Release. Compare actual recorded films:

```powershell
node lambda/h1_film/tools/verify-native-parity.mjs `
  --native '<native build>\engine\Release\h1-film-export.exe' `
  --engine '<candidate>\h1-film.js' --assets '<matching map root>' `
  --output '<new private parity directory>' '<film.h1film>'
```

The verifier requires clean simulation hashes and byte-identical full typed
exports, not just matching player positions. The diagnostic
`--candidate-registry <private registry.json>` also allows the full local
converter to validate an unregistered candidate; it requires explicit `--engine`,
still verifies hashes/identity, and marks the report as a candidate. Cloud intake
does not expose this override.

Current local evidence lives under `L:\tmp\halospawns-h1arena-197bb65c`:
the archived source, native build, fingerprinted `wasm-final` candidate, recorded
films, parity logs and conversion products. `final-parity/parity.json` records
14 passing films across nine maps (27,480 source ticks), with byte-identical
native/WASM exports and clean recording hashes. Fixtures include local death/respawn,
enabled wall jump/crouch slide, four-player UNIVERSAL loopback and host-driven
team change/kick/end, plus a closed 2,880-tick joiner's partial copy. Synthetic
tests cover malformed/capped network sections,
cross-block MSZIP history, unsupported builds, and old-profile retention.
This is offline validation, not hosted timing, maximum-size testing or approval
of any production map binding. The four-player, 512 MiB and 432,000-tick ceilings
remain; larger upstream rosters fail closed.
The movement recording input is retained in `tests/fixtures/arena-movement.txt`.

Private engine store: `L:\tmp\halospawns-h1arena-197bb65c\engines` (both profiles
and every retained exporter, verified against the previous release registry).
Local validation image `halospawns-h1-film:h1arena-197bb65c-local` contains that store.
Network-disabled, read-only, non-root Linux worker runs pass for the network
actions fixture, the movement fixture and a real retained Beta 3 Atlas film:
initial conversion, viewer rebuild, full reparse and three identical retry
callbacks. The production Node permission boundary is enabled in those runs.
The retained Atlas viewer artifact is also byte-identical to the previous
`typed-poses-20261014-r2` image under the same offline harness.
Those offline runs make no AWS/API calls; fake map bindings are test evidence,
not approvals.
Windows Node 24.19 with `--engine-permissions` hits an existing Emscripten
`ioctl_tiocgwinsz` failure on both old and new engines. Ordinary Windows
conversion and Linux worker isolation pass; that unrelated Windows-only issue
is not changed by this integration.

On a follow-up release alignment: archive the newly requested full commit into
a **new** directory, compare source/format changes, rerun native parity and both
film corpora, then add a **new immutable profile** and artifact hashes. Keep this
snapshot and Beta 3 for existing films/retries. Never retarget this ID to the
newest checkout. If the observable tuple did not change despite simulation
changes, reject the ambiguity instead of overwriting a profile. API registration,
profile-specific raw-map review and a coordinated immutable worker release are
required before hosted conversion.

The user authorized dev worker deployment on 2026-10-15. Immutable image
`h1arena-197bb65c-20261015-r1` now retains both profiles and every exporter;
the retention fixture includes this released snapshot. All 2,734 application
files match the offline-tested image except that appended fixture. Live health
verifies the exact hashes and full source commit. API `live=183` still lacks
the new registration; its separate release and new map reviews remain pending.
No new film/reparse, map approval or prod action accompanies this worker-only
stage. See [deployment evidence](DEPLOYMENT.md#h1arena-retained-worker-deployed-2026-10-15).

## Regression Evidence

### Native analytics revision 3

The worker requests `halospawns.h1film_job.v2` with `analytics_revision: 3`
for new uploads. Versioned jobs select and echo their exact analytics revision;
explicit revisions 1/2 and unpinned v1 jobs remain supported. An already-pinned
legacy prepare is retrieved without changing its identity, and persisted
completion retries must still match the original job. Unpinned v1 jobs cannot
complete with revision 3. No engine, simulation tuple, reviewed map or viewer
contract pin changes are required for this adapter-only release. Viewer revision
2 remains selected; glass/camo/item state needs a separate retained exporter.

Revision 3 retains revision 2's conservative match-end cutoff. Its additional
`halospawns.h1NativeAnalytics.v1` product carries four source-native metrics:
integer PGCR damage-dealt points, floating-point vitality damage received, and
integer camo/overshield pickup counts. Damage received retains the exporter's
precision and includes self/environment damage; these are not Xbox-attributed
damage metrics. Each timeline records the first observed cumulative baseline
and subsequent changes at source 120 Hz, never invented pre-recording zeros.
Totals/timelines are independently nullable. Missing samples invalidate that
timeline. Exceeding 4,096 points per metric or 16,384 combined drops the affected
timeline in full while retaining its observed total; no truncation/decimation
is presented as complete coverage. End-tick ungated updates and the entire
postgame tail are excluded. Postgame-only films have no inferred native totals.

The bounded Beta 3 adapter also reads the original format-2 EVT1 section. Only
recorded enemy-kill pairs with stable roster slots and verified clock mapping
are used, and each event must match a simulated kill-counter delta at that exact
tick. Missing/unsupported clocks, capped sections and partial recordings keep
explicit availability/coverage reasons. The resolved custom-variant record
supplies reviewed mode, teamplay, score limit, respawn/suicide penalties, shields
and tracker fields. Bare built-in variants and unverified fields stay unknown;
map-clamped starting grenades and unexported time limits are not guessed.

`recording_closed` requires the validated film trailer. A known match start
requires both recording and simulation clocks at zero with an active first
snapshot. A closed recording or observed end alone never proves full-match
coverage. Full reparse, not viewer-only rebuilding, is required to populate the
new native metrics and repair existing stored match statistics.

### Match-only analytics revision 2

The 2026-10-09 correction retains the simulation profile, WASM/glue hashes,
`HSFT0001`, `halospawns.h1AnalyticsSource.v1` envelope, and released viewer
contracts. `analytics_revision: 2` versions the corrected analytics policy,
independently of viewer projection revision 2. API completion must accept
analytics revisions 1 and 2 before publishing the new worker.

Playback still contains every source tick. On the first ended snapshot, final
engine-gated scoring fields are retained, while ungated PGCR shots, damage and
pickup counts freeze at the preceding snapshot. Later replay ticks retain live
poses, objects, weapons and movement with frozen match counters. Match events
stop at the end marker. The analytics sidecar ends at that marker, and an
end-marker position sample is excluded from occupancy. Subsample events are
clamped to the last analytics sample, not to a postgame sample.

The sidecar/report includes `statistics_source_ticks` (`end + 1`, or the full
source count if no end was observed). At 30 Hz its sample count is the ceiling
of that value divided by four. Recording duration and simulation/hash coverage
remain the full film. No-end/partial films keep their observed coverage; a film
starting in postgame has no inferred PGCR baseline or occupancy.

The ungated cutoff is conservative at 120 Hz. It cannot resolve ordering of
multiple actions within the ending update, particularly objective-mode endings.
Exact sub-tick attribution requires the future retained engine/exporter-hook
work; do not claim that broader semantic acceptance is complete.

Old products and persisted revision-1 completions remain readable and retryable.
Revision 2 introduced the corrected default; revision 3 now adds the native
product above. Explicit revision-2 jobs retain this policy. Full reparse is required to repair
stored statistics, graphs and spatial products; a viewer-only rebuild changes
only that artifact. Old no-end viewer files should remain byte-identical.

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
