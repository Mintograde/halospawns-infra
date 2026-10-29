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
