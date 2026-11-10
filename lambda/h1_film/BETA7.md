# Beta 7

The `beta7` port pins upstream tag `beta-7`, commit
`9eb48a465a70f711eaa61db3248f82dc46421924`, source tree
`b44e6af3703378afc3bfce6a9a82ae6af742f4cc5447db940e6069eadd4e2a11`.
Profile `h1-performance-beta7-p9844-wasm-v1` accepts format 3 / protocol 9844 /
120 Hz. Linux server labels and clean labels with the exact Git suffix follow
the established recorded-build contract. The Beta 6 `ec92e0bb` exception remains
exclusive to Beta 6.

The new recipe is exporter 25 / analytics 5 / viewer 11. It retains compact
storage, diagnostic tables, recorded inputs and clocks, supported embedded
client worlds, explicit unavailable-client evidence, and three-shot definition
2. Viewer 11 / `halospawns.h1MatchReplay.v6` binds the new engine and protocol
without changing any retained contract, encoding or binary pin.

## Upstream changes

- Options are 13,356 bytes (13,360 with the local-bot trailer); the resolved
  variant has 78 fields / 440 bytes. `weapon_set` is appended. Timing offsets
  move by 32 bytes. Beta 6's reset fields retain their positions.
- FNET type 16 is a 16-byte detail check, not a simulation application; type
  17 is a 124-byte grenade-stick record. Client event 83 is 16 bytes. Exact
  lengths, domains and closing client boundaries remain checked.
- A format-3 RSTR section records up to 16 players while the compatibility
  envelope still counts only the first eight. The parser uses the complete
  recorded roster after checking the bounded eight-slot relationship. It never
  modifies the film or invents missing participants.
- Hosted bots grow to 15 while local bots stay limited to 11. The headless port
  implements the recorded bot identity predicate and bounds local team arrays.
  Upstream death-camera code is included; presentation-only hooks have no-op
  implementations. Unexpected live networking remains a trap.
- An idle client's diagnostic account can retain `own_player=-1` until its
  first shot, pull or received hit. Viewer 11 preserves that sentinel and the
  original account bytes. The embedded film still needs its independently
  validated player binding; a known but different diagnostic player fails.
  Earlier recipes retain their original strict account-player check.

Every source tick, seed, recorded world hash and network application must pass.
Unavailable clients require the existing complete, source-bound evidence;
corrupt or unrelated embedded recordings still fail the entire conversion.

## Validation and maps

No user replay was available. Exact-source native recorders generated solo,
four-player local, four/eleven local bots, player-hosted network, hosted bots,
complete embedded-client, Linux dedicated and Linux dedicated with 15 bots
recordings. The Linux executable reports commit `9eb48a46`, protocol 9844.
Native and WASM full export bytes are compared for hosts and clients; packaged
tests then validate initial, full-reparse and viewer-rebuild callbacks.

The final native/WASM comparisons cover eight hosts (14,406 ticks / 123 hashes)
and three client worlds (3,604 ticks / 33 hashes), with identical complete
exports and no seed/hash mismatches. These are generated exact-source
recordings, not recordings supplied by a player. The preserved older-film
corpus supplies the longer multiplayer and existing failure-policy regression
coverage. A real Beta 7 player recording remains useful additional coverage.

The local frontend also opens the packaged solo, player-hosted and sixteen-player
Linux fixtures, verifies every stored entry hash and decodes all five available
worlds through its normal range reader. The idle client's original `-1` account
identity and independently recorded player 4 remain distinct.

Evidence lives under `.build/beta7-fixtures/`, `.build/beta7-final-parity-r2/`,
`.build/beta7-client-parity/`, `.build/beta7-wasm-final/` and
`.build/beta7-deploy/`. An abruptly terminated early harness recording had an
unbound partial client and was correctly rejected; it is excluded from the
release corpus. Closed-match recordings replace it.

Carry forward Beta 6's 70 exact approvals through the existing audited engine
transfer service. Copy the shared game release to `halo1_pc_pb2_beta7` through
the release service and assign the new engine. Map bytes and origin release
pins are shared; source approvals and every older release remain unchanged.
The preview/snapshot/apply/verify workflow already supports later engine copies
without duplicating map assets. No historical reparse is part of this release.

For a later beta, reuse the existing API workflow after registering its reviewed
immutable engine release:

1. Create the played release from the preceding release through the audited
   game-release service, sharing its UI map resource and catalogue policy.
2. Read eligible source bindings and preview explicit batches of at most 50
   through `POST /v1/admin/h1film-approval-transfers/preview`.
3. Save each selection, returned snapshot and operation UUID. Submit that exact
   request to `POST /v1/admin/h1film-approval-transfers`; retries reuse the UUID.
4. Assign the new played release with the engine's `expected_revision` through
   `PATCH /v1/admin/h1film-engines/<engine_profile>`.
5. Compare every copied source pin and lineage, confirm the previous approvals
   are unchanged, and verify both release-map listing and collection queries.

This deliberately reuses the existing transaction, stale-preview and audit
rules. It needs no direct SQL clone or duplicate map upload. Beta 7's frozen
requests and verification examples are in `.build/beta7-deploy/`; the owning API
contracts are documented in sibling `docs/h1film-engine-management.md` and
`docs/h1film-game-releases.md`.

Deployment and final validation results are recorded in `DEPLOYMENT.md`.

Candidate `20261110-r2` was published and registered, but its exact deployed-API
callback check rejected a legacy encoding hash in viewer-11 metadata. The guard
stopped before installation or default activation. Do not promote that candidate.
Release `20261110-r3` fixes only the Python encoding-fingerprint selector; its
registry, engine binaries, all eight Beta 7 replay files and statistics are
unchanged. The regression check now compares every supported match encoding's
reported fingerprint with its canonical document. API 237's rejection was
correct and needed no further API release.
