# Beta 5 engine

The `beta5` port pins upstream tag `beta-5`, commit
`fbbfae27d6be7e47613acce37da95ed754dccb42` in `../h1-arena`.
Its registered simulation profile is `h1-performance-beta5-p9818-wasm-v1`:
format 2, protocol 9818, 120 Hz, recorded build `Linux server`.
Worker `20261029-r4` is deployed and promoted in dev at policy revision 4,
with the compatible API reader at `live=219`.
This is the identity in all three supplied October 29 Dread films. Other
recorder build labels remain unregistered; client-view films are rejected
because they do not provide the authoritative match simulation used here.

Beta 5 selects exporter 11 / analytics 4 / viewer 5, with at most sixteen
distinct participants. Every older profile, binary, exporter and recipe is
retained. Existing attempts and receipts keep their original pins. No viewer
pose format, analytics schema, database migration or frontend pin change is needed.
Exporter 11 adds the versioned client diagnostic companion and compatible API
reader; its simulator binaries match retained exporter 10 exactly. All supplied
films are client-enriched host-world copies. Their recorded client evidence is
exported for future overlays; separate predicted-world client films remain
unsupported. See `CLIENT_DIAGNOSTICS.md` for the wire format and frontend handoff.
See `DEPLOYMENT.md` for publication/promotion status and `RELEASES.md` for the
release workflow.

## Engine and container changes

- The envelope grows from 480 to 504 bytes. Fireteams occupy byte 472;
  ledger, match ID and optional client evidence occupy bytes 480 through 503.
  The adapter validates section bounds, overlap, reserved values and flags.
- FNET version 2 adds projectile (8), copy-rule (9), detonation (10), spawn
  (11) and discard (12) records. Exact payload lengths and application counts
  are checked. The actual upstream projectile simulation and playback
  callbacks are compiled into the new engine.
- The port includes the upstream crouch-slide, wall-kick, vehicle, bot-name,
  film and network changes. Existing converter roster, first-person,
  deterministic particle, damage attribution and finite loose-weapon export
  corrections are retained. The old player-spawn correction is already in
  upstream Beta 5 and is not applied twice. Headless stubs cover presentation
  and live networking; unknown executed engine imports still abort.
- Recorded options are 13,152 bytes, optionally followed by the four-byte bot
  marker. The resolved variant has a 128-byte name and 72 signed integers.
  Option offsets were measured using the pinned source's C layout; variant
  keys are mapped by their actual Beta 5 positions.
- Existing catalogue fields retain their meanings. Beta 5's `footstep_sounds`
  percentage and `kill_restores` enum are marked unsupported in the existing
  boolean catalogue. Additional Beta 5-only sound/overtime fields are not
  mislabeled as older settings. Recording UTC and bounded initial FNET host
  evidence are supported for the new profile.

## Reproducible pins

| Input/artifact | SHA-256 |
| --- | --- |
| Upstream tree (12,679 files) | `06dfc16e2672967b01162902e9f3457f9d51acffb4cc2b7db3f59494671e6d8f` |
| Port and shared sources (57 files) | `b3d1bdc14cc2541389811f794c8010f9d38d234b92db62247367d766ebd9242a` |
| WASM | `6893f5cf29b242371bedff719d5c8e259b2453c4d49d739a613b1878e77e15fd` |
| Node glue | `dbd118fc8db944f6be355a6ad04aa8e5ec75075bb88757da2e453ff13478a45b` |

The build uses the existing pinned Emscripten 4.0.10 toolchain, with combat,
network replay corrections, damage attribution and finite world objects enabled.
`port.json` fingerprints both shared beta3 and beta4 sources. Native reference
builds use the same archived upstream source and converter instrumentation.
Private build inputs and logs are under `.build/beta5/wasm-final/`.

## Real-film acceptance

The three user-supplied files are from the in-place Beta 5 upgrade despite
their `H1PB Beta 4` parent directory. Each uses `dread.map` (74,690,664 bytes).
The final reproducible WASM and native reference produce byte-identical full
exports, with zero seed or recorded-state-hash mismatches:

| Film timestamp (2026-10-29) | Ticks | Recorded hash checks | Network applications | Distinct participants |
| --- | ---: | ---: | ---: | ---: |
| 15-56-19 | 2,718 | 23 | 3,266 | 4 |
| 15-47-30 | 74,760 | 623 | 226,090 | 8 |
| 15-56-54 | 38,126 | 318 | 83,976 | 4 |

All are partial recordings. Their all-remote initial FNET rosters provide real
dedicated-server evidence (`neutral` host style), replacing the previous
synthetic-only coverage. The longest film also exercises late joins. These
fixtures do not establish coverage for every map, local Beta 5 bots, Windows
recorder labels or client-view playback. The existing eight-initial-identity
recording limit remains enforced; later joins can use physical slots through 15.

Local validation passes 41 Node and 76 Python worker tests. The API's small
recording-evidence reader extension passes 1,766 unit tests (six skipped) and
full lint. Worker publication additionally checks seven packaged real films
covering all four profiles and their initial/full/viewer callbacks and receipt
retries; deployment evidence records the completed results.

## Map approvals and API compatibility

The user explicitly authorized carrying all Beta 4 approvals forward as-is.
All 70 eligible Beta 4 approvals were transferred and verified. Transfer uses the
API-owned preview/snapshot/transaction service, in bounded batches, preserving
raw S3 object versions and hashes, map/release identity, GLB hashes, exporter
evidence and immutable source/transfer lineage. This is a transfer of the
current approvals; it does not automatically approve future maps or profiles.
Both batches (50 and 20 maps) had zero blocked or existing destinations; every
copied pin and lineage was verified and every Beta 4 source row is unchanged.

API commit `e916ba48b849ee1f3e16a655d9cebef0abab74dd` admits the reviewed Beta 5
profile's UTC and host evidence. Engine hashes and processing defaults still
come only from the immutable worker manifest. Promotion must verify actual
callbacks against the deployed API ZIP before activating the release.

No historical reparse, frontend deployment or production rollout is part of
this work. Keep the Beta 5 reader and all retained engines when rolling back
the default release after Beta 5 attempts exist.

## October 30 upload investigation (2026-10-31 UTC)

The nine films supplied by the user failed at 00:42:56-00:43:06 UTC
(October 30, 20:42:56-20:43:06 EDT). API 221 accepted all upload presigns and
failure callbacks. Worker `20261029-r4` rejected them during inspection with
`validation_failed`, before prepare/map resolution. Every film records
`map_bytes: 0`; `cloud.inspect_film` requires a positive value. The supplied
local files match the uploaded SHA-256 and sizes.

### Comparison and offline verification

Controls were the three accepted October 29 Dread films at 15-47-30, 15-56-19
and 15-56-54 from the release corpus. The audit compares every named envelope
field, section directory, options word-difference offsets, recorded settings,
FNET record types/counts/compression/masks, and diagnostic tables. It does not
claim equality of the different matches' individual actions or events.

Common to controls and failures:

- FLM1 format 2, protocol 9818, 120 Hz, build `Linux server`, 504-byte header,
  13,152-byte options, 416-byte resolved variant, 196-byte names section.
- Flags 42 (`0x2a`), authoritative host-world copies enriched with client
  evidence, first update zero, normal closed trailer, hash period 120.
- FNET v2 and valid LDC1 v11 with all thirteen table layouts, no diagnostic
  cap flags. No host-ledger, raw-pad or EVT1 section in either corpus.
- All October 30 files have the same resolved FFA 50 variant bytes as the
  two FFA controls. The short control instead uses Team Slayer 50.

Differences:

- Controls record Dread's 74,690,664-byte map size; all nine failures record
  zero. This is the common admission blocker, not a new protocol or build.
- All nine change `video.firing_input_polling` 120 to 30,
  `tuning.pistol_spread` 0 to 2, and enable `wall_jump` and `crouch_slide`.
  Most also change wall-jump cooldown 5,000 to 200 ms, slide threshold 110
  to 100 and slide cooldown 5,000 to 1,000 ms. Exhibit keeps the previous
  cooldowns/threshold; Hotbox has 200 ms slide cooldown and threshold 110.
- Larger/changed rosters, departures, detonation records and one discard
  record extend the control coverage. Some files mix raw and MSZIP FNET
  blocks. The current reader accepts these layouts. Match seeds, UTC,
  identities, durations, section sizes/offsets and event counts also differ.
- Atlas and Hotbox contain nonempty client correction tables; the controls
  have none. Exhibit has only 319 client clock samples for 1,199 world hash
  samples: client evidence is partial. The 20-24 Tinkered film has 234 client
  shots but 231 host verdicts. Preserve missing evidence and clock distinctions.
- Jaywalk's initial remote mask is `0x3ff` (slots 0-9), despite its eight-player
  envelope. It has no join records supplying the missing initial identities.
  It cannot receive the normal neutral-host proof under the current checks.

An isolated copy of `runtime/convert.mjs` permits recorded size zero only for
this experiment, with an explicitly supplied local map. Original film bytes,
engine binaries, recorded seed/hash checks, network application checks, encoder
verification and diagnostic validation remain intact. Containers use the deployed
`20261029-r4` image with networking disabled and read-only film/map mounts.
This is an experiment, not a deployable missing-size implementation.

| October 30 film | Source ticks | Hash samples | Initial / total declared participants | Offline result |
| --- | ---: | ---: | --- | --- |
| 19-50-25 Atlas | 73,062 | 609 | 8 / 10 | Pass |
| 19-41-55 Alpha Ruins | 58,981 | 492 | 7 / 9 | Pass |
| 19-32-44 Jaywalk | 64,233 | 536 | 8 / 8; initial mask has 10 slots | Desync at tick 1 |
| 19-22-57 Hotbox | 63,861 | 533 | 5 / 12 | Pass |
| 19-16-16 Exhibit | 143,808 | 1,199 | 2 / 8 | Pass |
| 20-28-19 Tinkered | 37,680 | 314 | 7 / 7 | Pass |
| 20-24-19 Tinkered | 26,280 | 219 | 5 / 8 | Pass |
| 20-11-10 Worthy | 92,033 | 767 | 5 / 5 | Pass |
| 20-01-13 Dread | 69,558 | 580 | 7 / 8 | Pass |

The eight passes verify 565,263 ticks and all 4,713 recorded hashes, with zero
seed/hash mismatches, complete accepted network applications, encoded viewer
artifacts, analytics output and client diagnostic companions. All three controls
also pass. A read-only dev query finds exactly one active, eligible Beta 5 binding
for each of the eight scenarios; every local map SHA-256 matches its binding.
Cloud product finalization, API callback acceptance and hosted recovery were
not exercised; they require the coordinated missing-size contract first.

Jaywalk fails identically in the released WASM engine and existing Beta 5 native
reference: 64,232 seed mismatches, 535/536 world-hash mismatches and 260,444 refused
network applications; first divergence is update 1. Pinned upstream
`fbbfae27d6be7e47613acce37da95ed754dccb42` defines
`BLAMPC_FILM_ROSTER_MAX 8` (`src/host/blampc_film.c:406`) and caps initial
roster capture at that limit (`:5508`). Its names and packed team data cannot
describe ten initial players. This is strong evidence of truncated initial
roster metadata, and is separate from the map-size failure. Do not suppress
these mismatches or publish its failed candidate as a valid replay.

### Linux server connection

Both control and failing films have the `Linux server` build label and the
controls already contain dedicated-host evidence. Eight failures also verify
all-remote initial rosters. Linux/dedicated-host playback is therefore supported.

The pinned source has a plausible server-layout bug: `film_map_bytes`
(`src/host/blampc_film.c:1293`) opens a working-directory-relative
`maps\\<scenario>.map`, returning zero when opening/seeking fails. Actual game
loading honors `--maps-root` through `cache_files_set_root_directory`
(`src/host/main.c:2685`). A server using a separate maps root can therefore play
the map while recording size zero. Linux's `linux_fopen` normalizes backslashes
(`src/linux_server/platform/linux_win32.c:718`), so the separator alone is not
the explanation. Server configuration/logs are still needed to confirm the
specific cause for these recordings. Upstream playback explicitly treats zero
as an absent size check (`blampc_film.c:6326`).

### Support path

1. Add explicit, versioned missing-size evidence for this reviewed Beta 5
   case. Preserve the original zero/unknown recording value separately from
   the positive size of the selected map. Do not edit film headers or substitute
   an inferred size as if it were recorded.
2. Coordinate API evidence validation, map resolution, conversion identity,
   reparse inventory/preflight, worker inspection/job validation and Node map
   checks. Current API `H1FilmEvidence.map_size_bytes`, conversion consistency,
   `resolve_map`, reparse `resolver_count`, worker job schema and Node
   `resolveMap` all assume a positive recorded size. Removing only the first
   rejection does not make the intake contract work.
3. For missing size, require an unambiguous active/eligible reviewed binding
   scoped to exact engine profile and scenario, or a separately audited explicit
   selection. Pin raw S3 version/SHA-256/actual size and existing GLB identity.
   Zero candidates stays missing; multiple candidates must remain ambiguous.
   Verify all recorded simulation hashes before publishing any products.
4. Add early initial-roster consistency validation for Jaywalk's mask mismatch.
   Fix the upstream recorder to capture a versioned complete initial roster for
   future films. Historical Jaywalk recovery needs sufficient exact initial
   identity/team evidence and a converter proven against every recorded hash;
   the mask alone cannot restore the missing names/teams. Recoverability is not
   established by this investigation.
5. Regression-test all twelve films plus missing/ambiguous/ineligible/wrong-map,
   old job/receipt, full-reparse and viewer-only cases. Add a manifest contract
   requirement so incompatible APIs cannot activate the new reader semantics.
   Validate actual worker products against the deployed API, publish a new
   immutable compatible worker release, then perform separately authorized
   bounded recovery. No engine binary change was needed for the eight passes.
6. Fix the producer's size probe to use the actual cache root (ideally the
   already-open map) for future recordings; that cannot repair old headers.

Evidence and reproducible scripts:
`L:/tmp/halospawns-beta5-failures-20261031/` (`comparison.json`, `summary.json`,
`reviewed-map-bindings.json`, `probe-*.json`, conversion reports/logs and
`native-jaywalk/summary.json`). No runtime source, live data, release/default,
map approval or upload state was changed. Follow-up contract/worker work:
`20261031-api-infra-beta5-missing-map-size` in root handoffs.

## Missing recorded map size: local worker contract

The worker candidate implements `halospawns.h1MissingMapSize.v1`. Inspection
preserves `map_size_bytes: 0` and adds `map_size_evidence` with that exact value,
only for `h1-performance-beta5-p9818-wasm-v1`. Positive recorded sizes retain
the old wire shape. Job validation requires the marker for zero and forbids
it for positive sizes. The selected raw source retains its positive size,
version and SHA-256. Node conversion requires a trusted catalogue for zero,
resolves exactly one profile/scenario entry and verifies its actual size/hash.
All existing simulation integrity checks remain. Beta 5 initial FNET masks
outside the captured roster fail early without invented identities.

Coordinated validation found one remaining analytics adaptation check comparing
the resolved map size with the recorded zero. `analytics.py` now admits this
exact Beta 5 case while retaining positive bounded resolved sizes, profile,
scenario and simulated-map SHA-256 checks. Regression coverage includes invalid
sizes, wrong hashes/scenarios and other profiles. Include this fix in the release.

Validation now passes 49 Node / 79 Python worker tests, 1,808 API tests, 109
focused isolated PostgreSQL cases, API Ruff and source-only packaging. The
twelve-film corpus gives eleven successes and the expected Jaywalk roster
rejection. All 33 initial/full-reparse/viewer-rebuild callbacks pass the API's
schemas and pure builders, including settings, graphs, spatial events and
diagnostics. The eight missing-size films retain all 565,263 ticks / 4,713 hashes;
three positive-size controls also pass. Initial and manual jobs validate, and
idempotent callback retries retain their exact payloads.

Evidence/scripts: `L:/tmp/halospawns-api-beta5-acceptance-20261031/summary.json`.
These are offline source overlays on retained image `20261029-r4`, using an
offline-only manifest identity. They are not a newly published immutable image
or hosted acceptance, and the local source-only API ZIP is not deployable.

The API prerequisite under `20261031-api-infra-beta5-missing-map-size` is now
implemented locally: strict zero/Beta-5 coupling, omission from legacy receipts,
unambiguous reviewed profile/scenario resolution, conversion/reparse consistency,
and the new release requirement in registration/status/activation. Activation
also prevents a worker rollback that drops a registered contract, even with
unchanged recipes. The worker job schema was regenerated from the API model.
No migration or frontend edit is required. User-managed rollout is API first,
then the normal worker publication and exact-image/deployed-API acceptance
workflow. No producer recorder, deployment, stack pin, live retry or source
bytes were changed. Support is local and remains undeployed.

### Jaywalk recovery follow-up

A deeper read-only examination found useful roster evidence inside Jaywalk's
FNET damage records. Missing initial slot 8 appears with handle `-327679992`
and team 9 in 337 records (ticks 248-62595); slot 9 appears with handle
`-327614455` and team 10 in 759 records (ticks 1264-63453). The film has no
join or team-change records, and its initial remote mask is `0x3ff`.
This supplies a concrete ten-player reconstruction candidate, rather than
requiring guessed team values. The subsequent user-authorized offline experiment
below verifies the reconstruction; hosted acceptance remains pending.

The `film_net_deal` payload carries `damage_data` at offset 24, with owner
handle at damage offset 8 and signed 16-bit owner team at offset 16. The
initial NAME block still contains only eight names. Adjacent matches are not
proof of slot-to-name identity. The upstream world hash covers objects,
clock and global RNG, not names, so a successful simulation would not by
itself authenticate those two names.

Evidence: `L:/tmp/halospawns-beta5-failures-20261031/jaywalk-roster-recovery-candidate.json`.

### Jaywalk recovery experiment: successful, local only

The user's follow-up authorized an isolated recovery experiment. Both the native
and WebAssembly candidates restore the initial roster from eight to ten in
private playback memory, set slots 8/9 to the evidenced teams 9/10, and leave
their names empty. Neither film headers on disk nor retained engine artifacts
are changed. The runner fences the exact film and map SHA-256; the generated
C patch also requires Jaywalk's exact header tuple and an explicit experiment
flag. The eight-entry names array and all simulation checks remain intact.

| Check | Recovery disabled (native control) | Recovery enabled (native and WASM) |
| --- | ---: | ---: |
| Source ticks played | 64,233 | 64,233 |
| RNG seed mismatches | 64,232 | 0 |
| World hashes differing | 535 / 536 | 0 / 536 |
| Network events applied | 4,535 | 264,979 |
| Network events refused | 260,444 | 0 |

The control uses the same experimental native binary without the recovery
flag and reproduces the original tick-1 failure. Original and staged film/map
hashes match before and after each run. No verifier was bypassed.

The packaged `20261029-r4` encoder accepts the recovered WASM tick stream,
verifies all 64,233 incremental source states and all 64,233 bounded viewer
poses, and produces a ten-participant revision-5 120 Hz replay (32 chunks,
55,446,683 bytes), analytics and the original client diagnostics. All 75
diagnostic chunks / 132,270 rows read successfully, and diagnostic section
bytes exactly match the source film. No browser playback or API callback
acceptance is claimed by this experiment.

- Film SHA-256: `e78fad3ea52a04a711ab483eb3a17d9ff9eb594d62939f41b7dc5aa36bf5a6f8`.
- Raw map SHA-256: `5637281003141313be9261f6359d9f33c621f2bacb422999b4002e4a05f1e775`.
- Native candidate SHA-256: `2e254efee075123db82f3f3406660530a2caefb8cdd5ff7d25da0c3c4f446524`.
- WASM candidate SHA-256: `6470f43936c86445656bede327730f63c39d12dd11d45f20037202cf21cdf361`.
- Replay SHA-256: `2d2db649a43cfbb3cb8ab6a84c87ac38fb5fc7fe0cb7242eecac49bd241744b6`.

Evidence/build scripts and local artifacts are under
`L:/tmp/halospawns-beta5-failures-20261031/jaywalk-recovery/`:
`prepare-native.mjs`, `build-wasm.mjs`, `run-native.mjs`, `encode-recovery.mjs`,
`build-evidence.json`, `wasm-build-evidence.json`, each run's `summary.json`,
`encoding-summary.json`, `artifact-inspection.json` and `candidate/`.
The WASM candidate relinks the read-only development cache; its recorded cache
baseline is not byte-identical to the deployed engine. These are experimental
builds, not release artifacts or a new registered exporter pin.

Remaining before hosted support: an audited recovery contract and immutable
worker recipe, coordinated API acceptance (including explicit unknown-name
semantics or independently verified names), the missing-size support described
above, and a separately authorized bounded retry. Keep the normal worker's
initial-roster rejection until that contract exists. The original uploads,
attempts, map approvals, default release and production remain unchanged.
# Promotion of missing-size and initial-roster recovery

The user's 2026-10-31 follow-up authorizes promoting the Jaywalk experiment for
future matching films. Exporter 12 adds evidence-bound initial-roster recovery;
exporters 10/11 and all earlier profiles remain byte-pinned. It accepts only
the reviewed Linux-server, tick-zero, all-remote FFA subset with a contiguous
9-16 player mask, an eight-player names block, distinct teams, consistent
damage owner handles/teams for every missing slot, and no join/team changes.
Unknown or conflicting evidence fails before simulation. The original film is
never rewritten. Every seed/hash/network check remains mandatory.

API prepare and completion freeze `halospawns.h1InitialRosterRecovery.v1`.
Slots without recorded names remain unknown, with explicit participant metadata;
the recovery does not identify people from adjacent recordings. A new
`initial_roster_recovery` release requirement prevents incompatible activation.
Beta 5 defaults become 12/4/5; other defaults and viewer revision 5 remain.

The reproducible WASM build is `.build/beta5/roster-recovery-v1` (WASM SHA256
`529da30900a89ef47c757a19c42ae050b089582de777640b2d13b103b46236f7`);
glue stays `dbd118fc8db944f6be355a6ad04aa8e5ec75075bb88757da2e453ff13478a45b`.
The native build uses the same CMake patches and verifies unchanged generated
sources before relinking retained objects. It reproduces all 64,233 Jaywalk
ticks, all 536 hashes and all 264,979 network applications without mismatches
or refusals. Packaged initial/full/viewer callbacks and receipt retries pass;
the sibling API validates ten participants. Evidence is in `.build/h1-roster`
and `.build/beta5/roster-native-v1`. The dev promotion is now verified as
worker/default `20261031-r1`, policy revision 5, API `live=222`; see
`DEPLOYMENT.md` for the sixteen-film corpus and exact deployed-API evidence.

The older investigation sections below describe the evidence available at
their dates and are superseded by this explicit promotion for supported films.
