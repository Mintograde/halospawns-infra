# Beta 6.1

## Initial client roster availability (2026-11-08, local)

The follow-up implementation preserves a usable match when an embedded client
has a proven initial roster mismatch. New recipe **18/4/9** uses
`halospawns.h1MatchReplay.v4` / `H1MV0004`, with the same lossless compact storage
as v3 and an explicit `roster_mismatch` unavailable-view reason. All old recipes
remain immutable. The engine WASM/glue are identical to exporter 17; no player
slot is removed, merged or renumbered. This work is **not deployed**. Dev remains
worker/default `20261108-r4`, policy 14, API 230, with default 17/4/8.

Only the new embedded-client recipe requests structured encoder evidence for
an initial count disagreement: a nonempty roster of at most sixteen distinct
indices in 0-15, plus the original recorded count. The world still fails
encoding. One verification-only replay uses the same source, map, engine and
original deadline, rechecks source/map hashes, and must exit successfully with
every recorded tick/hash/application accounted for, zero seed/hash mismatches
and zero refused applications. A completed desync retains its separate existing
reason. Host failures, crashes, timeouts, malformed rosters, incomplete evidence
and unrelated encoder errors remain conversion failures.

The supplied Prisoner film now converts with **two playable worlds**: host and
client 2. Client 0 remains unavailable for desync; client 1 is unavailable for
roster mismatch after all 48,778 ticks, 407 hashes and 295,717 applications pass.
Native full-stream inspection confirms the extra slot 4 persists throughout
the recording, with no object/body or activity counters. That observation is
diagnostic, not a rule for discarding the slot. Original client sections,
diagnostics, inputs, clocks and failure evidence remain in the artifact. The
frontend labels the disabled perspective and excludes it from ghost selection.

Validation includes 84 Node, 103 packaged worker, 96 Rust encoder (one ignored),
2,057 API unit (six skipped), and 1,781 frontend tests (one optional fixture
skip); both frontend builds pass. Twelve real/synthetic packaged cases include
the supplied failure and eleven retained cases, plus the separate Beta 5 client
flow. Five older-format artifacts are byte-identical; all 457 entries and track
evidence across six retained Beta 6 cases are unchanged, as are the compared
game/statistics/settings products. All 36 local API schema/pure-builder and
storage-scope callback checks pass under Lambda Python 3.12 with the API 230
dependency set; the separate retained Beta 5 client callback also passes.
Chrome 156 opens both usable worlds, checks
26 original record tables/ranges, and rejects unavailable-world access. The
additive SQL constraint migration passes isolated PostgreSQL acceptance and
rejection checks. An explicit retained 17/4/8 run still rejects this film.

Rollout requires the additive API migration/readers, release capability
`client_roster_mismatch: halospawns.h1MatchReplay.v4`, compatible frontend reader,
then normal immutable worker publication and guarded promotion. The viewer-9
object suffix is `viewer-delta.v4.hsrv`; old object names remain unchanged.
Recovery requires a fresh attempt under 18/4/9; never repin the failed attempt.
Evidence is in `.build/film-c76122dd-investigation/`; see `DEPLOYMENT.md` and
handoff `20261108-infra-beta6-clean-client-roster`.

## Prisoner client roster investigation (2026-11-08)

Upload `c76122dd-3063-4d91-b3e2-ed8f98b1d4e3`, local file
`a521028b-543f-4786-ab97-1ac8f2f62d70.h1film`, fails on worker `20261108-r4`
with API 230. The exact retained S3 version and local file match SHA-256
`eb2afa3659e54d977149893cc1833e1a9850bb0678dcd9b9a4fe13684c5f188a`
(23,703,272 bytes); the approved Prisoner map also matches its frozen pin.
AWS logged `conversion_failed` at 12:19:24 UTC after 75.1 seconds, using
1,751 MiB of 3,008 MiB. This was neither a timeout nor an out-of-memory failure.

The exact frozen job reproduces offline. The host verifies all 48,777 ticks and
407 recorded hashes. Embedded `client-0` has 10 seed mismatches and 5/407 hash
mismatches, first divergence at update 350; the existing policy correctly makes
that track unavailable. The actual blocker is `client-1` (recorded player 1):
its header declares four players, but the initial engine export contains five,
with `Seizen` in slots 3 and 4. The encoder rejects the roster and terminates
its producer, causing the secondary `Simulator failed / null !== 0` error.

The bounded verification-only WASM replay and the independent native reference
both finish all 48,778 client-1 ticks with zero seed/hash mismatches, all 407
hash checks and 295,717 network applications with zero refusals. Under the
retained 17/4/8 policy, a clean verdict cannot become desync evidence. The last embedded client
(`client-2`, player 2) independently passes native playback: 48,780 ticks and all
407 hashes. Part lengths/checksums and source/map hashes remain valid.

This is a reproducible roster/slot reconstruction inconsistency, not evidence
that the entire recording is unusable. Publishing this client world would need
verified roster reconciliation or an upstream correction; hash success alone
does not prove the duplicate slot is safe to publish or discard. The follow-up
above instead preserves the other verified worlds and records why this one is
unavailable. No deployment, retry, repinning or source mutation was performed.
Evidence: `.build/film-c76122dd-investigation/`, especially `diagnosis.json`,
`exact-conversion/conversion.partial/client-1.partial/`, `first-rosters.json`
and the two native reference summaries. See handoff
`20261108-infra-beta6-clean-client-roster`.

## Missing recorded map size

The November 8 upload failures exposed nineteen recognized Beta 6 host films
with a zero recorded map-cache size. Inspection succeeded, but the Python
intake guard allowed this only for Beta 5 and rejected the films before prepare
or simulation. The converter, analytics adapter and API evidence schema had
the same Beta 5-only restriction.

Beta 6 now uses the existing `halospawns.h1MissingMapSize.v1` evidence marker.
The original zero remains frozen in the film evidence; the separately approved
map binding retains its positive measured size, SHA-256 and S3 version.
Resolution still requires one exact profile/scenario approval. Ambiguous maps,
unreviewed profiles, missing markers, nonzero mismatches and changed map bytes
remain rejected. Simulation and recorded-hash verification are unchanged.

The additive release capability
`beta6_missing_map_size: halospawns.h1MissingMapSize.v1` fences registration
and activation against older API readers. Retain the compatible worker and API
when rolling back policy; all existing engine/exporter/recipe pins remain.
This correction requires no database migration. See `DEPLOYMENT.md` for the
release and scoped recovery outcome.

Some embedded clients also export an initial roster different from their film
header. The encoder still rejects that world. For exporter 16 or later, only
this exact roster rejection on an embedded Beta 6 client permits one bounded
verification-only replay, with output discarded and the same source, map,
engine and original deadline. Only a cleanly exited, complete simulation with
the existing source-bound desync evidence can mark the client unavailable.
A clean verdict, crash, timeout, incomplete evidence or other encoder error
still rejects conversion. Hosts and the older strict recipes retain their
existing behavior. The supplied Chillout client independently reproduces in
native and WASM: first divergence at update 5,180, 11 seed mismatches and
317 of 616 hash mismatches, with 432,199 network applications and 135 refusals.

Live completion also exposed historical object-name compatibility: workers
retain the `viewer-delta.v1.hsrv` suffix for match viewers 7/8. API 230 accepts
that exact name alongside the container-version suffix only for the registered
match tuples. Typed format/version, all contract hashes, upload/generation scope
and content hash remain mandatory. The release checker now validates storage
scope as well as schemas and analytics builders. Existing objects and saved
completion manifests are preserved unchanged.

## Compression research

Offline compression research is available in
[`tools/match-size-poc/README.md`](tools/match-size-poc/README.md).
The lossless prototype reduces three complete multiplayer exports by 54–59%
with roughly 1-3 seconds of local repacking. The approximately 80% target has
not been reached. Full byte recovery,
range checks, shared-pose experiments and processing tradeoffs are documented
there. The versioned production format below replaces the experimental wrapper.

The immutable profile `h1-performance-beta6-p9839-wasm-v1` pins upstream
`beta-6.1`, commit `86c52285a8ebe7d107bfafae64abe722b263cedf`. Format 3,
protocol 9839, 120 Hz; new default recipe exporter 17 / analytics 4 / viewer 8.
All four earlier profiles, engines and recipes remain unchanged.

## Lossless compact match storage

The user authorized making compact storage the standard for Beta 6+ on
2026-11-08 UTC. It is deployed in dev as worker/default `20261108-r2`, policy
13, with API 228 and the additive artifact migration. Viewer 8 /
`halospawns.h1MatchReplay.v3` / `H1MV0003`
preserves every logical entry byte and hash from viewer 7. Exporter 17 reuses
exporter 16's exact engine binaries and availability policy. Old 14/4/6,
15/4/6 and 16/4/7 recipes remain pinned and supported. Future engine profiles
must register this format explicitly; unknown recorded builds stay rejected.

World entries retain their inner viewer-5 compression, hashes, clocks and
direct byte ranges. Nonworld source sections use independently hashed 256 KiB
Zstandard pages, falling back to identity when smaller. Expanded FNET, PAD and
diagnostic tables are reconstructed from same-track original recorded sections;
these derived entries consume no additional payload storage. There is no
cross-client coordinate substitution, tick approximation or further quantization.

Entry offsets address logical bytes; each entry's `storage` descriptor maps
those bytes to physical blocks or one stored dependency. `logical_size_bytes`
and the physical container size are validated independently, with a 512 MiB
limit. Dependencies are acyclic and bound to original track references. The
shared browser/Node reader verifies physical block hashes and original decoded
entry/range hashes, bounds source reconstruction to 128 MiB, network blocks to
16 MiB and its decoded cache to 32 MiB. Browser reconstruction yields and honors
cancellation. World seeks do not reconstruct diagnostics.

The three supplied multiplayer artifacts shrink by 54.0–58.6%; all 332 original
entries and 332 reverse cold ranges match byte-for-byte. Local production
packing takes 1.4–3.5 seconds, independent of simulation/encoding. The API adds
the compact capability and an additive format/version/profile constraint.
See `DEPLOYMENT.md` for the actual activation and complete packaged validation.
Frontend changes remain local and uncommitted for user testing.

Packaged release comparison against `20261107-r5` (local Docker, two CPUs,
3,008 MiB; individual runs, not a controlled performance benchmark):

| Film | Previous bytes | Compact bytes | Reduction | Initial packing, old → compact | Harness, old → compact |
| --- | ---: | ---: | ---: | ---: | ---: |
| Octagon | 177,043,708 | 73,362,140 | 58.6% | 1.62 → 2.28 s | 51.34 → 55.61 s |
| Dread | 352,861,808 | 162,337,938 | 54.0% | 2.97 → 4.19 s | 113.78 → 110.72 s |
| Prisoner | 373,605,404 | 166,388,094 | 55.5% | 3.24 → 4.19 s | 112.74 → 112.78 s |

The harness includes simulation, all three product modes and receipt checks;
these are not live Lambda timings. Initial packing adds 0.67-1.21 seconds.
Across all three product modes, the added packing cost is 0.65-1.21 seconds.
Whole-harness variation does not establish a speedup or a reliable slowdown.
Chrome 156 separately verifies all 15 playable worlds and 58 representative
record tables across these files; the slowest complete table reconstruction
takes 1.45 seconds locally, while world seeks do not decode those tables.
Evidence: `.build/compact-match-deploy/processing-comparison.json` and
`browser-verification.json`.

Revision-8 pins:

- Projection: `5501eb4b77cfca3aa76863bf33ff9819715ca22a07da6b7e5df51006a26783ef`
- Manifest: `0b08473d1afc9c971e6d23eeb382a4a536f8efe101a13cfcb10942e43b30c211`
- Encoding: `93ac8cc18444e40461cd3d6c1c71dfbf0e21b2f332db25185ebce7e32dbfbe69`

## Partial client availability

The user authorized excluding desynchronized client worlds on 2026-11-07.
Exporter 16 reuses exporter 15's exact engine bytes and adds a runtime policy:
only a completed, source-bound embedded-client desync can become unavailable.
Engine/encoder exits, complete ticks/hashes, recorded network application totals,
source/map checksums and an explicit desync verdict are required. Unknown errors,
timeouts, crashes, invalid source data and host failures still reject the match.

Viewer 7 / `halospawns.h1MatchReplay.v2` / `H1MV0002` retains every original
track ID, clocks, raw recorded inputs and diagnostic tables. Available tracks
have fully verified worlds; unavailable clients carry bounded failure counts
and the first mismatch update, with no world or verification claim. Host-only
statistics remain authoritative. The frontend falls back to the host for these
players and labels their client perspective unavailable. No partial prefix of a
failed simulation is published. The old 14/4/6 and 15/4/6 recipes remain strict.

API/worker requirements retain the v1 reader and add the v2 partial-match reader.
The new API migration only extends the container format constraint. Preserve
all versions, pins, approvals and stored attempts on rollback. See DEPLOYMENT.md
for the activation status and real-film evidence.

Revision-7 pins:

- Projection: `e19c41417dd3c4e6843037a94fb8d993e4861bfd6d345a9965f82b4ed8effdbb`
- Manifest: `48c262a470909bdcbc5ac86ebc7cea602bf9a01d4c7db9943de7aab8e44701be`
- Encoding: `55c04603d2c7f12677819f6be9443a4e3b40c91a65f817ee55be1ef5c26dc15d`

## Engine pins

- Exporter 15/16/17 WASM: `ab521a65d720ead578c5736762143edbb21ef61f6cb6ecfeee2204f777b17cac`
- Retained base/exporter 14 WASM: `b44b2ca35378f7b8e9f58f5380f19f5302572ed19ec6dc2d794cac2397e7dc9c`
- Glue: `722e5e7bc52140f4bef40f26c9cdb419bb823ca59b6b1567379531d7f3267917`
- Source fingerprint: `03ecd5ff7150ec3648db1fe68489cee7cd40888525b62747d0819cdf0dbfb99e`
- Exporter 15 port fingerprint: `37749550853f4cb4696178af407cd7b6fe9002a3d805b7e7e19851789f407a25`
- Retained exporter 14 port fingerprint: `430c02c15238b4f03f5764761fd77d0b2405641ffbc51f5b204f261568b2b127`

Build with `tools/build-engine.ps1 -Port beta6 -Combat -NetworkReplayFixes
-DamageAttribution -FiniteWorldObjects -ClientView` against the pinned source.
The engine includes upstream format-3/MTCH reading and thin-part restoration.
Clean commit suffixes use the existing recorded-build matching contract.

Exporter 15 brings the WASM bot shim into agreement with upstream's network-film
guard: saved local lobby bot settings do not create players in network playback.
The adapter validates those settings independently of the active recorded roster.
Local films still create and validate their recorded bots. The shared adapter
also counts closing client FNET changes at `frame_count`, which upstream applies
in `blampc_film_play_end`; host changes retain their exclusive end boundary.
The exact application-count, refused-event, seed and world-hash checks remain.
Exporter 14 and its recipe are retained unchanged for persisted attempts.

## Retained revision-6 single-file match replay

`halospawns.h1MatchReplay.v1` (`H1MV0001`) is a revision-6 viewer container with
a hashed JSON index and bounded, individually hashed entries. One artifact
contains the authoritative host world and every embedded client world (up to
sixteen parts). Inner worlds retain revision-5 `HSRDC002` encoding. World indexes
and chunks have separate hashes for range reads. No Beta 6 companion is needed.

MTCH v1/v2 whole and thin parts retain their player, trust claims, early-ending
flag and whole-part hash. Thin parts are restored with the pinned engine and
verified before replay. The converter explicitly extracts the host: upstream's
default MTCH playback can select a client. Every world must pass tick, seed and
recorded-hash verification. One deadline covers the complete conversion.
Host analytics alone feed game statistics.

Exports preserve gametype, input script, events, RSTR rosters, raw and normalized
FNET records, host LDG1 tables, PAD inputs and all thirteen LDC1 v12 tables.
Packed aim/seen rows and PAD3 samples are expanded without dropping originals.
Diagnostic tables have row/chunk indexes and hashes. Clock mappings, frame
counts, recorded trust and independent simulation evidence remain separate.
Unknown alignment stays unavailable. Standalone authoritative films also retain
any recorded account. Reviewed settings include eighteen new Beta 6 fields;
private recorder options are not copied into public artifacts.

The API stores a closed typed proof under artifact metadata `h1film.match_replay`
and returns its validated summary as `h1_match`. Worlds and tables live inside
the immutable artifact; original films remain canonical sources.

Contract pins:

- Projection: `17891e012b67f5b7e998cf1cc724a1728d18b3df5556559e90fc4ee47c0dc2c2`
- Manifest schema: `451182094d27300e49d198933a92cea49bb1ce7c22a72ee244acb74907cd449d`
- Encoding: `e330926579e3b6cfa18dd8591dc00d896f774aa4ae174b3d05bb934c507ac724`

The local frontend uses one URL for perspective changes and comparison ghosts,
verifying the API-bound manifest, world indexes and chunks with bounded HTTP
ranges and existing resident-history limits. New diagnostic tables are indexed
and preserved; the Beta 5 overlay UI does not yet present every new Beta 6 table.

## Acceptance

Sample: `2026-11-07 09-48-16 carousel.h1film`, 713,132 bytes,
SHA-256 `798dc9e5572514db6cecdd69fdc8f797531fd1c8bb8ad640de0ebc58d138a4f5`.
Map SHA-256 `ad0ff4008fab19b12421136653fdf801a6e0635abd58e3051b015221bbdab5f4`.
Match `c7aad6a5c643a303`; Linux-server host and player-0 client build
`2026-11-06 - BETA 6.1 - 86c52285`.

Full native/WASM exports match byte-for-byte: 9,815 host ticks, 9,816 client ticks,
and all 82 hashes per view. The browser codec decodes every tick and its normal
session loader opens the host and embedded view catalogue. Upstream
`film-ledger.py` agrees on 775,761 preserved/expanded bytes across 26 entries.
Packaged checks cover initial import, viewer rebuild, full reparse and idempotent
callbacks. The sample's final single artifact is 4,620,033 bytes.

Synthetic two-part fixtures exercise whole views and shared-network thin parts;
restored views match exactly. They contain two copies of the solo client, not
two independently recorded players. Real multiplayer, early/late clients and
maximum-size recordings were additional acceptance opportunities at the initial
rollout. The multiplayer results below add real coverage. Invalid reconstruction
and all playable-world verification failures still fail closed.

### November 7 multiplayer recordings

`2026-11-07 15-30-56 octagon_b.h1film` now passes complete conversion with all four
embedded clients. Its player-1 view has two legitimate OWN_DELETE records at
terminal frame 55,003: the old adapter expected 294,893 applications while both
engines applied 294,895. Native/exporter-15 full exports of that view are
byte-identical (`ba688aee34a6fc16b0ce5a99eec77908566b76cc0a70cc110b5fbf9c380b7c8f`),
with all 459 recorded hashes matching and no refused events or seed mismatches.

The supplied Dread and Prisoner hosts pass, as do all eight embedded views of
players 0-3. Both player-4 views still fail independently in native and exporter
15, after the saved-bot issue is corrected:

| Film / part | First divergence | Seed mismatches | Hash mismatches | Refused changes |
| --- | --- | --- | --- | --- |
| Dread / client-0, 25,387 frames | Hash at frame 480 | 86 | 83/212 | 70 |
| Prisoner / client-1, 67,917 frames | Seed at frame 2,757 | 112 | 76/566 | 71 |

Whole-part sizes/checksums and original source/map hashes match. An isolated
native experiment retaining only the recording client's local seats produces
the same divergence counts; it is not part of the released engine. These two
matches remain rejected under retained 14/4/6 and 15/4/6 recipes. The subsequently
authorized 16/4/7 policy preserves each verified host and four passing clients,
marking the player-4 client unavailable with its original recorded data. It does
not clear failures or change recorded hashes. Repairing those client worlds
still requires upstream playback/recording investigation. Local evidence is under
`.build/nov7-multiplayer-fix/`, including restored parts, native/WASM summaries,
per-part checks and the discarded seat experiment. See `DEPLOYMENT.md` for the
release's packaged and deployed-API checks.

Partial-artifact checks are in `.build/partial-match-deploy/artifact-audit.json`:
Dread is 352,861,808 bytes and Prisoner 373,605,404 bytes, each with five playable
worlds and one unavailable client. Octagon has five playable worlds and no
unavailable client (177,043,708 bytes). Every original client account and decoded
diagnostic table was compared byte-for-byte, including the failed clients.

## Dev rollout

The first candidate, `20261107-r1`, was published and registered but stopped
before installation: two retained client schema snapshots still capped the
shared recipe definition at viewer revision 5. `20261107-r2` refreshes those
bounds to match the API and retains the same registry, engines and recipes.
The snapshot tool now refreshes client schemas alongside the host contract.
Both immutable publication records remain available for audit. The map
transfers prepared against r1 remain valid because their engine pins are equal.

The user authorized worker releases, API git-push CI, migrations and local
frontend changes. Deploy the compatible API and forward migration
`20261107010000_h1film_match_replay.sql`; publish and register the worker.
Transfer Beta 5 approvals through the audited service, preserving versions,
hashes and lineage. Copy `halo1_pc_pb2_beta5` to `halo1_pc_pb2_beta6` through the
release service and assign it to the engine. Map origin and played release
remain distinct.

Promote using `atmos workflow promote-dev --file h1-film`, which tests archived
callbacks against the exact deployed API. Retain new readers, the migration,
engine and all old recipes on rollback. Existing attempts must not be repinned.
Exact deployment results are in `DEPLOYMENT.md`. Frontend stays local;
historical reparses and prod are outside this rollout.
