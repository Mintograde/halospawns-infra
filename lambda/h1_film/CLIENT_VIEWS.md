# Beta 5 client-view replay tracks

Status (2026-11-01): deployed in dev as worker/default `20261101-r1`, policy 7,
with API `live=224` and the applied client-view migration. Both supplied `-view`
films pass native/WASM parity and produce viewer-revision-5 artifacts. See
`DEPLOYMENT.md` for deployment evidence. Frontend adoption is handled separately.

## Implementation

`-ClientView` adds an opt-in Beta 5 engine build using the pinned upstream
client simulation, snapshot and bookkeeping implementations. The portable
WASM build replaces the corresponding offline stubs with those implementations;
live transport remains stubbed. A gated exporter helper uses consumed film
frames as sequential output indices. Recorded client game time can jump or
repeat, so it cannot serve as the world artifact's frame index.

`readEnvelope(path, {allowClientView: true})` accepts flag 64 and validates
client FNET types 64-82, fixed and batched record sizes, bounded engine writes
and frame clocks. The initial clock is required; the last CLOCK record for a
frame wins, matching playback. Region-specific write bounds are also checked
by the engine. Default intake still rejects client-view films.

`convert.mjs --client-view` requires trusted worker input, a registered client
recipe (or an explicit local candidate registry), a new
Beta 5 exporter revision (13 or later), viewer revision 5, and the viewer-only
path with analytics revision 2 and no analytics output. It checks playback
through the existing strict verification, including every recorded hash and
network application. Client simulation does not create authoritative statistics
or replace host diagnostics. Existing profile/default/attempt pins are untouched.

The first pair shares match ID `ea909505fc89c7c0`; the second shares
`134c2a61fc9fa7dd`. Match ID, filenames, frame counts and UTC alone cannot prove
authorization or aligned coverage. `tools/inspect-view-pair.mjs HOST CLIENT`
is still only an identity inspection tool, explicitly not playback validation.

## Real-film validation

Inputs are the four supplied October 31 films under
`L:\bens_stuff\xbox mod\Games\H1PB Beta 4\films`, using that installation's
`maps/dread.map`. All tests were offline and copied inputs into new work directories.

| Recording | Frames | Recorded hashes | Result |
| --- | ---: | ---: | --- |
| 13:57 client view | 328,585 | 2,739 | All hashes and 931,499 network applications pass; full native/WASM export parity |
| 14:43 client view | 5,134 | 43 | All hashes and 21,846 network applications pass; full native/WASM export parity |
| 14:43 host | 39,120 | 326 | Existing exporter-12 conversion passes; packaged with client view |
| 13:57 host | 328,586 | 2,739 | Rejected: native and existing WASM playback have the same desync |

The long host first diverges at update 314,753 (expected seed `F9D2E2C7`,
observed `C6BA2CD1`), with 13,833 seed mismatches, 116 hash mismatches and
19,163 refused network applications. The same failure reproduces in native
playback. Its valid client artifact is retained, but the pair is not packaged
as verified. No simulation checks were waived to accept it.

The final WASM build was compiled from source with the standard pinned build
tool. The native reference was relinked from the retained matching native
build after recompiling the changed film/export sources; the other generated
sources were compared before reuse. Both final client captures match on every
exported frame (333,719 total) and all 2,782 recorded hashes pass.

The existing sibling frontend decoder reads all three successful encoded
artifacts: 372,839 frames across 184 chunks, with the revision-5 source contract.
This is full codec readback in Node, not rendered browser/view-switch acceptance.
Inline bounded-pose verification covers every encoded frame. Windows uses the
non-incremental state path; the initial attempt to request incremental-state
verification failed explicitly and was not counted as a successful conversion.

The original local validation passed 62 Node tests and the build-engine PowerShell
tests, including malformed
client records, clock gaps/repeats and manifest/source/path binding. No Rust
codec changes were required. Deployment validation now passes 65 Node tests,
90 worker tests and 10 Terraform tests; see `DEPLOYMENT.md`.

## Logical replay package and clocks

Hosted intake uses `client_views.py` and the API-owned
`halospawns.h1ClientView.v1` protocol. Client source versions under
`films/client-views/unprocessed/<upload_id>/` use the existing films queue with
separate role routing and HMAC preparation/completion/failure endpoints. The API
requires explicit ownership or audited admin approval of the host and clock-host
generations. The worker independently hashes each source and the reviewed map,
validates the retained host completion proof and extracts this client's clocks.
Host and clock-host copies may differ; both must be independently verified and
match the recorded match/profile/map. Match IDs never authorize attachment.

Exporter 13 / analytics 2 / viewer 5 is in `client_view_recipes`, never in host
defaults. Immutable client world and timeline objects use the API's upload/attempt
generation prefix. The external timeline retains original frame CLOCK segments,
ordered CLIENT_CLOCK rows and source/clock/host-generation provenance. Immutable
completion caching prevents reconversion after a lost callback. Terminal
attempts are acknowledged without simulation. No host statistics are emitted.

`validateViewTracks` also accepts the API's resolved asset descriptors.
`bindViewTimelines(package, {trackId: Uint8Array})` checks each original timeline's
byte length, SHA-256 and generation/source binding before enabling seeks. It
supports independent clock-host sources. Fetches remain frontend-owned; use one
package snapshot and key caches by package/generation/hash. Missing timeline or
alignment coverage returns `null`. This shared helper does not implement the UI.

```powershell
node lambda/h1_film/tools/package-view-pair.mjs HOST_CONVERSION CLIENT_CONVERSION NEW_OUTPUT
```

The output directory contains `replay.views.json` using
`halospawns.h1ReplayViews.v1`, plus independent immutable host/client
`replay.120hz.hsrdc` tracks. This gives one logical package without changing the
world codec or requiring both tracks to download together. It is not a ZIP or
a new combined binary container.

The packager requires successful conversion reports, revalidates the staged
films and playback logs, checks film/map/artifact hashes, verifies roles and
matching engine profile/map/match/recording player, and binds alignment to the
host copy's client diagnostics. It writes a new staging directory and renames
only after verifying the copied artifacts. Failed conversions are rejected.

`runtime/view-tracks.mjs` provides browser-safe `validateViewTracks` and
`mapViewFrame`. A host frame maps to host tick `first_update + frame + 1`.
A client frame maps through its recorded CLOCK segments and the paired host
copy's CLIENT_CLOCK samples, using the pinned upstream pairtime offset/cap
rule. Unlike upstream's convenience fallback, missing samples and times outside
the measured range return `null`; ambiguous repeated client time does too.
The frontend must display unavailable coverage instead of silently clamping.

The short client starts at game tick 34,009, mapping to host frame 34,044.
Its final frames remain playable as a standalone track, but cross-track
switching outside measured alignment coverage returns unavailable. Each client
needs its own recording-bound clock evidence; another machine's authoritative
film does not automatically supply that evidence.

The manifest carries exact source, engine, exporter, map and artifact pins.
Its relative artifact paths are local package paths, not an API delivery
contract. Hosted integration must additionally bind immutable generations and
resolve authorized asset descriptors. Host analytics remain authoritative.

## Local artifacts and reproduction

Useful ignored artifacts in this workspace:

- `.build/client-view-wasm-final/build-candidate.json`: complete source build provenance.
- `.build/view-native-final-short`, `.build/view-native-final-long`,
  `.build/view-wasm-final-short`, `.build/view-wasm-final-long`: final reference
  logs, summaries and full exported tick streams.
- `.build/client-view-port/final-long-parity.json`: full long-client stream comparison.
- `.build/view-converted-v2-short-host`, `.build/view-converted-v2-short-client`,
  `.build/view-converted-v2-long-client`: successful conversion reports and artifacts.
- `.build/view-package-short/replay.views.json`: verified 14:43 logical package.
- `.build/view-host-native-long/summary.json` and
  `.build/view-converted-v2-long-host.partial/report.json`: rejected long-host evidence.
- `.build/client-view-port/frontend-readback.json`: all-chunk frontend decode results.
- `.build/client-view-port/acceptance.json`: consolidated source/map/artifact
  hash checks, strict final reference-log verification and package mapping checks.

Registered client exporter 13 pins:

- Upstream: `fbbfae27d6be7e47613acce37da95ed754dccb42`.
- WASM: `0405e296d1d98f4c5c69de088c6e738dd5b9f301afabdbf50820bf2aae9e940b`.
- Glue: `ef6ef93363fac552ce02642513f79f983cd265bfc6bce1b12facc61fa05627f8`.
- Map: `94daca13bd3c06107ea8540175eb85c3932ad36a6277d26ad46047b89dc7b730`.

Build in a new directory, using the exact upstream source:

```powershell
.\lambda\h1_film\tools\build-engine.ps1 -Source .build/beta5/source -BuildDirectory NEW_BUILD_DIRECTORY -Port beta5 -Combat -NetworkReplayFixes -DamageAttribution -FiniteWorldObjects -RosterRecovery -ClientView
node lambda/h1_film/tools/run-view-reference.mjs ENGINE FILM MAP NEW_OUTPUT --capture
node lambda/h1_film/tools/linux-candidate/compare-streams.mjs NATIVE_TICKS WASM_TICKS
```

Native CMake supports the corresponding `H1_CLIENT_VIEW=ON` option. The
reference runner checks both process completion and strict playback verification;
an engine process returning zero does not by itself establish parity.

For conversion, use the usual film/assets/engine/encoder/map-catalog/output
arguments plus `--trusted-local --client-view
--exporter-revision 13 --viewer-revision 5 --analytics-revision 2
--source-viewer-only --skip-readback`. A separate unregistered experiment can
add `--candidate-registry PATH` with exact candidate hashes. The map catalogue
must retain the reviewed profile-specific map binding. `--skip-readback` skips
the built-in external viewer readback; inline pose verification still runs, and
the artifacts above received a separate complete frontend decoder check.

## Hosted integration handoffs

- `20261031-infra-api-h1film-client-view-tracks` in
  `../../../halospawns-api/HANDOFFS.md`: role-aware viewer-only sources/attempts,
  authenticated association, frozen provenance/generations, asset delivery and
  a new `halospawns.h1ClientView.v1` reader requirement before exporter registration.
- `20261031-infra-svelte-h1film-client-view-tracks` in
  `../../../halospawns-svelte/HANDOFFS.md`: session-owned host/client selection,
  clock-aware seek/coverage, cancellation, participant mapping and rendered tests.

Cloud adoption and dev promotion are complete under
`20261031-api-infra-h1film-client-view-protocol`. Client-view conversion never
enters the authoritative game/statistics callback path. Beta 5 host defaults
remain 12/4/5. The rollout submitted no live game association, historical
reparse, frontend deployment or prod mutation. The user owns the ongoing viewer
integration; use the API's hosted package shape and external timeline binding.
