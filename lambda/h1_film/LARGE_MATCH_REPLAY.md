# Large compact match replay recovery

The November 13, 2026 batch contains 47 host films: 27 successful uploads and
20 failed eight-player Beta 7 uploads. Frozen inventory, source hashes, CloudWatch
events and reproduction logs are in `.build/recent-failures-20261113/`.

All twenty failures occur after successful simulation and spatial extraction,
at match packaging. The old packer caps the sum of logical entries at 512 MiB
before compact storage removes duplicated diagnostic tables and compresses
recorded sections. This mistakes logical data size for stored file size.

| Reproduced upload | Map | Logical bytes | Compact body bytes |
| --- | --- | ---: | ---: |
| `5c786c60-8d5c-449f-a45e-99df8c108d2e` | HangEmHigh | 546,662,227 | 251,355,869 |
| `d62f1dd8-d4fb-47c7-8c61-88467ab7f9c2` | Carousel | 826,603,262 | 366,218,577 |

Both original recipes reproduce `AssertionError: Match replay exceeds size
limit`. Offline size probes preserve each original logical entry's hash, size
and identity. The complete verified intermediate outputs are retained locally,
including the archived Linux reproduction volume.

## Versioned fix

Viewer contract 12 / `halospawns.h1MatchReplay.v7` adds a 2 GiB aggregate logical
limit. The physical file and individual entry limits remain 512 MiB. Header
ranges, block bounds, dependency limits, decompression checks and the 32 MiB
reader cache remain unchanged. Source simulation, exact hashes, clocks, raw
diagnostics and unavailable-client evidence remain mandatory.

Beta 7 recipe 33/5/12 reuses the exact exporter-32 engine binaries. Other host
defaults remain exporter 32, and separate Beta 5 clients remain exporter 31.
All six profiles, 59 exporters and older recipes remain. The new release
requires `large_match_replay: halospawns.h1MatchReplay.v7` in its API reader
capabilities. The schema generator is `tools/build-large-match-contract.mjs`;
contracts are synchronized with the API and frontend.

| Pin | SHA256 |
| --- | --- |
| Projection 12 | `c2947bab9d94971364227a4cb7ea752cee0ad6f0ef9ee81a625b6d4f04b9260f` |
| Manifest 7 | `0d1f2cd7c88fb148c2c9048684bdf62d01f828b53bf2003b21f08aae685c9e53` |
| Encoding 7 | `ba02fa29ac2853bf1bfcc1d2d1c490b64a605cfdaa0e55c2ee3ac295269171e1` |

API 254 (`e2f5f2b`, CI 43374833145) is deployed in dev. The additive migration
`20261113010000_h1film_large_match_replay.sql` is applied. API output state was
refreshed from 253 to 254 with zero resource actions.

Rejected worker candidate `20261113-r1` has image digest
`sha256:73c531a1e26f40696cac87fa87978e57bc4934943ebbb5e27d77fac3794ceafb`.
The exact deployed-API guard rejected its viewer-12 object-name suffix before
any worker installation or policy activation. It was registered but must not be
promoted. Candidate r2 corrects only `_viewer_artifact_key` to use the v7 suffix;
all old names, including the published viewer-7/8 v1 names, remain unchanged.
Final worker/default **20261113-r2** is active at policy **31**, with image
`sha256:b206c002a3350828d5ad36a8445677b2f7d6afecd57025228f323a25f7b7f74a`.
The first live health check verified all six profiles / 59 exporters. The guarded
apply changed only the H1 image URI and digest; memory 3008 MiB, timeout 900
seconds, reserved/SQS concurrency 50 and batch size 1 remain unchanged. All six
dev postplans are no-op. Promotion evidence is
`.build/h1-promotions/20261113-063003-3f5dee8de4a746aa8a033a7be9875f18/`.

## Validation

196 Node and 118 worker tests pass. API CI 43374833145 passes 2,289 tests
(331 skips), Rust validation and lint. An isolated PostgreSQL database applies
all migrations and verifies the additive artifact constraint. The frontend
passes 1,849 viewer tests (one optional real-film fixture skip) and both builds.

The first candidate's 21 packaged cases cover every engine and both failed
canaries. Nineteen prior cases preserve every statistic and 576 match payload
entries; six retained exporter-32 recipes preserve complete viewer files.
The corrected final image passes nine cases / 27 exact deployed-API callbacks
plus separate Beta 5 client flow. Every final artifact and statistic is identical
to its first-candidate counterpart. Six final retained recipes also pass 18
exact API callbacks, with unchanged bytes and statistics.

Both failed canaries preserve all 337 original logical entries. The browser
decoder verifies 13 playable worlds / 865,686 ticks and retains the two clients
whose original simulations desynchronize as explicitly unavailable. The size
fix does not convert those failed client worlds into playable views.

## Recovery and rollback

Recovery is limited to the twenty frozen failures. All 47 local film hashes and
their approved map hashes match the frozen conversions. All twenty failed
versioned S3 source objects were also downloaded and hash-verified. Recovery
uses fresh audited upload tickets and exact retained source bytes. Original
failed tickets, conversions, recipes and source versions remain immutable.

The before snapshot contains 358 conversions, 1,817 receipts, 1,512 H1 attempts,
360 map approvals and 309 selected games. It fingerprints every original game,
replay and artifact row as well as the historical records.

Keep migration 20261113010000, the v7 readers/capability and all old/new recipes
on rollback. Roll back defaults separately from reader compatibility. Do not
purge queue messages or rewrite original frozen jobs.

Local release tests now use anonymous disk volumes for temporary work, removed
automatically with each container. This matches Lambda's disk-backed ephemeral
storage while retaining the 3008 MiB process memory limit. A tmpfs would charge
large intermediate files to the local test container's memory allowance.

Two unused local Docker volumes were archived and byte-verified before reclaiming
space. Their tar files and `archived-*-volume.json` audits remain in the evidence
directory. Published historical ECR images and all engine recipes remain intact.

## Completed live recovery

The twenty failed November 13 eight-player Beta 7 uploads are recovered in dev
with worker/default `20261113-r2`, policy 31, API 254 (`e2f5f2b`, CI
43374833145), and additive migration `20261113010000_h1film_large_match_replay.sql`.
The old packer incorrectly capped aggregate logical entries at the physical
file's 512 MiB limit. Viewer 12 / match v7 permits 2 GiB logical data while
retaining the 512 MiB physical/per-entry caps and all verification. Beta 7
uses 33/5/12 with exact exporter-32 binaries; all six profiles / 59 exporters
and every old recipe remain. Other defaults and separate client 31 are unchanged.
All twenty fresh audited recoveries are processed and selected: 153 playable
worlds / 8324325 ticks / 69441 hashes with zero mismatches; 14
original desynchronized client views remain explicitly unavailable. All 47 original
upload rows, 309 previous games, old artifacts, statistics and history remain.
Totals are 378 conversions / 1837 receipts / 1512 H1 attempts /
360 approvals / 329 games. Queue and DLQ are empty.
196 Node / 118 worker tests, API CI, 1849 viewer tests and both builds pass.
Nine final packaged cases / 27 exact callbacks, six retained cases / 18 callbacks,
and separate client flow pass. All 19 earlier corpus cases preserve statistics
and 576 match payload entries; the two canaries preserve all 337 logical entries
offline and every live payload except the expected new host upload identity.
First live health, all six postplans, all 20 API/CDN checks and real Chrome
desktop/mobile playback, paused seeks and perspective switching pass.
Candidate r1 was registered but never installed/activated: the exact API guard
rejected its viewer-12 filename suffix. Do not promote r1. Final r2 fixes only
that suffix and retains every old name. Frontend readers stay local/uncommitted;
no frontend or prod deployment. Keep migration, v7 readers/capability and every
recipe on rollback. See `lambda/h1_film/LARGE_MATCH_REPLAY.md`, `DEPLOYMENT.md`
and completed handoff `20261113-infra-api-svelte-large-match-recovery`.

Both live canary files pass full CDN SHA256 verification. The twenty CDN
manifests cover 3,696 logical entries; each manifest's hash, source binding and
range responses are verified. Host upload identity changes the canary
compressed indexes by 13 and 10 bytes; after verifying just that expected identity
change, every host chunk, client world, recorded section and diagnostic matches
the offline original. Real Chrome at 1440 and 390 pixels verifies paused player 0
seeks at tick 1200, available client switching and explicit unavailable views,
with no JavaScript errors or dialog overflow. An initial local browser load
reported an unsupported contract; a fresh load and both complete checks pass.
The exact API, new source data and frontend code were unchanged between them.

Final evidence: `postcheck.json`, `snapshot-after.json`,
`live-verification.json`, `live-browser.json`, `dev-postplans.log` and
`recovery-status.json` in `.build/recent-failures-20261113/`.
