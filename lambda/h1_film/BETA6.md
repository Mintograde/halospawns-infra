# Beta 6.1

The immutable profile `h1-performance-beta6-p9839-wasm-v1` pins upstream
`beta-6.1`, commit `86c52285a8ebe7d107bfafae64abe722b263cedf`. Format 3,
protocol 9839, 120 Hz; new default recipe exporter 16 / analytics 4 / viewer 7.
All four earlier profiles, engines and recipes remain unchanged.

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

## Engine pins

- Exporter 15 WASM: `ab521a65d720ead578c5736762143edbb21ef61f6cb6ecfeee2204f777b17cac`
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

## Single-file match replay

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
maximum-size recordings remain additional acceptance opportunities. Invalid
reconstruction or playback fails closed.

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
complete match uploads remain rejected. Do not omit their failed worlds, clear
verification failures, or replace recorded hashes to make them pass. Further
upstream playback/recording investigation is required. Local evidence is under
`.build/nov7-multiplayer-fix/`, including restored parts, native/WASM summaries,
per-part checks and the discarded seat experiment. See `DEPLOYMENT.md` for the
release's packaged and deployed-API checks.

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
