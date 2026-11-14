# Beta 8

Active in dev as worker/default `20261114-r3`, policy 34, API 266 (`eebd1fd`,
CI 43611516616). Frontend readers and settings changes remain local/uncommitted.

The `beta8` port pins `beta-8`, commit
`3194e680896cead7326c2a3fcb9e35e85de1d7cc`, source tree
`ea459ac467d60bcb6e19dc908161601cdf4d9347e44a49c08f969f12bd561f60`.
Profile `h1-performance-beta8-p9848-wasm-v1` accepts format 3 / protocol 9848 /
120 Hz. Its recipe is exporter 35 / analytics 5 / viewer 13. The new
`halospawns.h1MatchReplay.v8` retains the 2 GiB logical / 512 MiB physical and
per-entry limits, client clocks and diagnostics, unavailable-view evidence,
all existing gameplay metrics and strict verification.

## Source integration

- The options layout grows to 13,360 bytes (13,364 with the local-bot trailer).
  The 78-field variant remains 440 bytes. Timing offsets move by four bytes.
- MAP_SOURCE flag `0x80` and optional MAP1 metadata use the existing bounded
  Workshop-source reader. Recorded source identity and original bytes remain.
- FNET 18 carries a four-byte client-teleport decision: player 0..15 and a
  signed teleporter source, with `-1` representing refusal. FNET 19 records the
  enabled rule and is not counted as a simulation application. The port links
  the original `blampc_net_client_teleports.c` implementation. Existing type
  16 detail checks and type 17 grenade-stick records retain their checks.
- Mythic is bot skill 4. Local bots remain bounded at 11, hosted bots at 15.
  Source-generated settings include all seven presets, 78 variant fields and
  109 labels/choices. Old profiles' metadata remains unchanged.
- The original extra-settings and team-color modules are linked. New HUD,
  audio and D3D presentation hooks have headless implementations; unexpected
  live networking and rendering still trap.
- Conversion sets `BLAMPC_FILM_START_HOST=1` so Beta 8's theater default cannot
  silently open an embedded client's world. Explicit extracted client films
  still replay independently.
- MSVC x86 retains the friendly spawn bonus in x87 through the following
  distance-rating multiplication. WASM f32 introduced two additional rounding
  points. A Beta 8-only generated helper preserves that native evaluation,
  including its float accumulator and final assignment. Two one-ULP rating
  differences in the generated network fixture became byte-identical; no
  tolerance, rounding of exported values or hash-verification exception was
  introduced. Native disassembly and comparison evidence are retained under
  `.build/beta8-deploy/`. Every earlier port and binary is unchanged.

## Validation and operations

Generated recordings cover solo, four local players, four/eleven Mythic bots,
player-hosted network, embedded client worlds, Linux dedicated and a Linux
dedicated match with 15 bots plus a client. Native recorders are built from
the archived source; Windows build invocations explicitly set
`BLAMPC_BUILD_COMMIT=3194e680`, `BLAMPC_BUILD_DATE=2026-11-14` and
`BLAMPC_BUILD_LABEL=BETA 8` during **build**, because the upstream label target
runs then rather than only during configure. No player-supplied film from the
exact Beta 8 source was available. Two local protocol-9848 recordings identify
the earlier dirty build `03594c11+`; they are not substituted for the pinned
`3194e680` source. Do not describe generated fixtures as live player canaries.

The API migration `20261114040000_h1film_beta8.sql` is additive. Keep it, the
v8 reader/capability and every engine recipe on rollback. API 266 is deployed
from `eebd1fd` through CI 43611516616; all 216 packaged Python files match the
committed source. Local validation passed 213 Node, 121 worker, 2,381 API,
1,854 viewer and 862 site tests; the settings cases include Mythic labels and
default comparison. Both frontend builds and API CI also pass.
The frontend's match-asset gate, API-catalog normalization, large logical data,
unavailable-view evidence and both-world seek tests include viewer 13.

All ten generated native/WASM host/client worlds have identical full exported
streams: 16,812 ticks / 146 hash samples, with no mismatches. The generated
solo, player-hosted and 16-player Linux packaged replays also pass real Chrome
desktop/mobile range reads, all 56 payload hashes, every available world index
and beginning/middle/end chunk seeks. This checks the browser reader with local
fixtures, not a new live upload or a hosted frontend deployment.

The existing audited approval-transfer and game-release services carry forward
the 70 PB2 maps to `halo1_pc_pb2_beta8` without copying map assets. Their origin
release remains `placeholder_halo1_cache_7_a3a1b6f5281766d8`. The 22 MCC
multiplayer maps follow the existing automatic catalogue policy for registered
Beta 7+ engines; their system approvals must not be copied as manual audits.
No historical reparse or frontend/prod release is part of this change.

Candidate `20261114-r2` was published and registered, but never installed or
activated. The exact API guard rejected its viewer-13 object name ending in
`viewer-delta.v1.hsrv`; the required suffix is `viewer-delta.v8.hsrv`.
Final `20261114-r3` corrects that filename selector and expands the retained
filename/encoding regression matrix through viewer 13. All source pins, engine
binaries and replay contracts are unchanged. Do not promote r2 or relax the API
guard. The early r3 packaged callback passes against the exact API 266 ZIP.
All 13 final packaged cases / 39 callbacks and the separate Beta 5 client flow
pass. Six legacy cases preserve all previous statistics, complete replay bytes,
object names and separate-client clocks. All seven Beta 8 cases preserve r2's
statistics and complete replay bytes. The broader r2 regression also passed the
large eight-player Beta 7 and missing-ID Beta 6 recordings, with all eight old
cases / 24 callbacks byte-identical to r1.

The first r3 packaged run stopped before conversion because local Docker disk
space was exhausted. Only this task's reproducible Beta 8 compilation cache,
the unused local r2 image copy, and two exact task build-context cache records
were removed; retained binaries, evidence and remote releases remain. The same
immutable r3 image resumed publication with the original non-root, read-only,
3008 MiB, two-CPU and disk-backed-temporary-storage checks.

## Dev deployment evidence (2026-11-14)

The installed/default release is `20261114-r3`, image
`sha256:d0169dcf23fd6e2341aa14c1d9b3d7a0e49fab80e0604dd22e239c2eb25f3556`,
with policy revision 34. The first live health check passed all seven profiles
and 66 exporters, and the guarded compare-and-swap activation succeeded.
Every old recipe and default remains; Beta 8 adds 35/5/13. Memory/concurrency
remain 3008 MiB / 50, worlds remain sequential, and separate Beta 5 client 31
is unchanged. API 266 accepts all 39 final packaged callbacks plus the separate
client preparation/completion flow using the exact deployed ZIP.

The 70 PB2 approvals were copied in audited 50/20 batches, preserving source
pins, corrected exporter and transfer lineage. They match the complete Beta
4/5/6/7 sets. The played release `halo1_pc_pb2_beta8` is assigned at engine
settings revision 1. Both release-map listing and collection queries return
the shared maps without duplicating assets. The existing automatic policy also
approved all 22 MCC multiplayer maps (20 catalogue / two Workshop audits),
with exact original source/GLB pins and no manual reviewer or copied lineage.
Campaign/UI maps remain excluded. These administrative requests initially
registered the r2 engine identity; r3 retains that exact identity and bindings.

All 428 original conversions, 2,226 receipts, 382 old approvals and 2,090 settings
snapshots have unchanged server-computed row hashes. There are now 474 approvals.
No film upload or historical reparse was dispatched. Public API health is 200;
the film queue and DLQ have zero visible, delayed or in-flight messages. All 15
Terraform tests pass. All six final dev plans are no-op. There is no AWS session
blocker, frontend deployment or production action.

Terraform components touched: `app-api` recorded the CI version-output refresh
265 -> 266 with zero resource actions; `map-processing` updated only the H1
Lambda image and `H1_WORKER_IMAGE_DIGEST` (0 additions / 1 update / 0 destroys).
The exact entry points were:

```powershell
.\scripts\plan.ps1 dev app-api
.\.build\beta8-deploy\refresh-api-state.ps1
.\scripts\promote-h1-film.ps1 -Stack dev
.\scripts\plan.ps1 dev
```

The guarded scripts ran these saved-plan commands from the infra root:

```powershell
terraform -chdir=components/terraform/app-api plan -refresh-only -no-color -var-file=dev-app-api.terraform.tfvars.json -out=L:/bens_stuff/projects/halospawns-infra/.build/beta8-deploy/api-refresh.planfile
terraform -chdir=components/terraform/app-api apply -no-color L:/bens_stuff/projects/halospawns-infra/.build/beta8-deploy/api-refresh.planfile
.\scripts\plan.ps1 dev map-processing
terraform -chdir=components/terraform/map-processing plan -no-color -var-file=dev-map-processing.terraform.tfvars.json -out=L:/bens_stuff/projects/halospawns-infra/.build/h1-promotions/20261114-162642-a37a2407b7c94eceafcfabba12fd5a71/worker.planfile
terraform -chdir=components/terraform/map-processing apply -no-color L:/bens_stuff/projects/halospawns-infra/.build/h1-promotions/20261114-162642-a37a2407b7c94eceafcfabba12fd5a71/worker.planfile
```

Evidence: `.build/beta8-deploy/` contains the source/API checks, native parity,
frozen map requests, transfer/catalogue/MCC verification, original/final history
fingerprints, final packaged comparisons, Chrome results and `postplans.log`.
Live health/default and exact-API callback results are in
`.build/h1-promotions/20261114-162642-a37a2407b7c94eceafcfabba12fd5a71/`.
The failed candidate's separate evidence is preserved. Keep the additive
migration, v8 readers/capability, game release, approvals and every old recipe on
rollback; returning the default to r1 cannot process new Beta 8 films.
