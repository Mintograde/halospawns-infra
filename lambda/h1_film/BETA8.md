# Beta 8

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
runs then rather than only during configure. No player-supplied Beta 8 film
was available. Do not describe generated fixtures as live player canaries.

The API migration `20261114040000_h1film_beta8.sql` is additive. Keep it, the
v8 reader/capability and every engine recipe on rollback. API 266 is deployed
from `eebd1fd` through CI 43611516616; all 216 packaged Python files match the
committed source. Local validation passed 213 Node, 121 worker, 2,381 API,
1,851 viewer and 861 site tests; both frontend builds pass. API CI also passes.

The existing audited approval-transfer and game-release services carry forward
the 70 PB2 maps to `halo1_pc_pb2_beta8` without copying map assets. Their origin
release remains `placeholder_halo1_cache_7_a3a1b6f5281766d8`. The 22 MCC
multiplayer maps follow the existing automatic catalogue policy for registered
Beta 7+ engines; their system approvals must not be copied as manual audits.
No historical reparse or frontend/prod release is part of this change.

Release evidence and frozen administrative requests live under
`.build/beta8-deploy/`; final worker deployment and postplans will be recorded
here after verification.
