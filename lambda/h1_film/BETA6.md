# Beta 6.1

The immutable profile `h1-performance-beta6-p9839-wasm-v1` pins upstream
`beta-6.1`, commit `86c52285a8ebe7d107bfafae64abe722b263cedf`. Format 3,
protocol 9839, 120 Hz; default recipe exporter 14 / analytics 4 / viewer 6.
All four earlier profiles, engines and recipes remain unchanged.

## Engine pins

- WASM: `b44b2ca35378f7b8e9f58f5380f19f5302572ed19ec6dc2d794cac2397e7dc9c`
- Glue: `722e5e7bc52140f4bef40f26c9cdb419bb823ca59b6b1567379531d7f3267917`
- Source fingerprint: `03ecd5ff7150ec3648db1fe68489cee7cd40888525b62747d0819cdf0dbfb99e`
- Port fingerprint: `430c02c15238b4f03f5764761fd77d0b2405641ffbc51f5b204f261568b2b127`

Build with `tools/build-engine.ps1 -Port beta6 -Combat -NetworkReplayFixes
-DamageAttribution -FiniteWorldObjects -ClientView` against the pinned source.
The engine includes upstream format-3/MTCH reading and thin-part restoration.
Clean commit suffixes use the existing recorded-build matching contract.

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

## Dev rollout

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
