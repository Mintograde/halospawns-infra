# H1 film Lambda integration

## PB2 recorder labels deployed (2026-10-31 UTC)

User-authorized dev worker/default **20261031-r2**, policy revision **6**, is
active with API **live=223**, source `a3d1cdb`. The API was published through
[normal CI](https://github.com/Mintograde/halospawns-api/actions/runs/41204178525).
All 185 Python source files in its deployed ZIP match that commit exactly;
ZIP SHA-256: `b56d237d3bc0227bee72f8ab2155d9f928be14646e825945eed35147fc5f556d`.

Worker image digest:
`sha256:82e2941c1af14636dcc244144ed15e36f6015dbb1e90330900e9f6e5a3d96cfc`.
It was built from committed `24e8f10` in `.build/h1-build-label-source`, with
the stack selection committed as `c2fe5fc`. Registry SHA-256:
`eb326a18e12d5e6fd8be5b06cfd0df6f21cc2f416dd242840a2c13f41a7c5ecb`.

`halospawns.h1RecordedBuild.v1` opts Beta 4/5 into clean source-commit suffix
matching. Display text can vary while format/protocol/rate and the registered
commit still match. Original film labels are preserved; canonical engine
identities, four profiles, fifteen exporter entries, recipes and map approvals
remain unchanged. Beta 5 remains 12/4/5. Unknown commits and modified-source
suffixes remain unsupported. See `COMPATIBILITY.md` and `BETA5.md`.

Validation:

- Both supplied October 31 Windows Dread films match native/WASM full exports
  across 109,134 ticks and all 910 recorded hashes, without editing either film.
- 54 Node tests, 83 local/packaged worker tests, 1,881 API unit tests (four
  optional skips), API Ruff and CI pass. Focused isolated PostgreSQL checks
  preserve original labels and reject rewritten retry identities; 104 cases
  passed before the schema fix, then both affected canonical/alternate-label
  persistence cases passed after it (two optional cases skipped).
- Eighteen release-image films cover all retained engine families, previous
  missing-size/roster-recovery cases and both new recordings. All 54 initial,
  full-reparse and viewer-rebuild callbacks pass the exact deployed API ZIP
  and Linux dependencies, plus admission, failure and receipt checks.
- The guarded saved plan applied only `aws_lambda_function.h1_film[0]`: the
  image and producer digest, **0 added / 1 changed / 0 destroyed**. First live
  health and exact registry/image verification passed; activation was fenced
  to API 223 and prior policy revision 5.
- The focused worker postplan is no-op. Before/after read-only snapshots match
  all 74 conversion pins/jobs, 299 receipts, 232 H1 attempts and 220 map approvals
  (70 Beta 5), plus API/worker limits, concurrency and event-source settings.
- Full dev has no resource actions; only the existing unapplied API version-
  output refresh from 213 to 223 remains. AWS dev account/session checks passed.

Commands (publication from the isolated source checkout; promotion/plans from root):

```powershell
.\scripts\publish-h1-film.ps1 -Tag 20261031-r2 -EngineRoot <beta5-engine-store> -PreviousRegistry <r1-registry> -CorpusPath <eighteen-film-corpus>
.\scripts\plan.ps1 dev map-processing
atmos workflow promote-dev --file h1-film
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Evidence: `.build/h1-build-label-release/`,
`.build/h1-build-label-source/.build/h1-contracts/20261031-r2-ea52c9f76ab048509286b61d85fd62e2/`,
and `.build/h1-promotions/20261031-131635-fab06a5164124708bc8cd2a89071c7f7/`.
No migration, live retry/reparse, frontend change or prod action was submitted.
Policy rollback must retain the recorded-build readers/rules and all old pins.

## Beta 5 missing-size and roster recovery deployed (2026-10-31 UTC)

The user authorized promoting the Jaywalk experiment and missing-map-size
support. Dev worker/default **20261031-r1**, policy revision **5**, selects
Beta 5 **12/4/5**. API **live=222**, source `4ef8cc1`, was published through
[normal CI](https://github.com/Mintograde/halospawns-api/actions/runs/41164828034).
Its deployed ZIP matches all 184 Python source files and SHA256
`772c9b0883bdb76774156cf998d0b4deda992c6298a97b41368448f6e51a7d14`.

Worker image digest:
`sha256:d76587729e918ec13d71a63e59f1b290e764bf6958f941c5378c772268d79d13`.
It was built from committed `7501b2d` in the isolated
`.build/h1-roster-release` checkout. Four profiles/fifteen exporter entries and
all older recipes remain. Beta 4 stays 10/4/5; retained families stay 5/4/4.
The new WASM hash is recorded in `BETA5.md` and the immutable release manifest.

Zero recorded size now requires the reviewed Beta 5 evidence contract and one
eligible profile/scenario map approval with exact measured size/hash/version.
Exporter 12 reconstructs only initial rosters proved by the film's all-remote
FFA mask and consistent damage-owner handles/teams. Prepare and completion
freeze `halospawns.h1InitialRosterRecovery.v1`; names absent from the recording
remain unknown. All simulation integrity checks remain mandatory.

Validation:

- 52 Node and 80 local/packaged worker tests, plus build orchestration checks.
- 1,840 API unit tests and 110 focused isolated PostgreSQL tests; six/two
  optional tests skipped respectively. API Ruff and CI build/test/lint pass.
- Sixteen packaged films pass initial/full/viewer callbacks, failure handling
  and receipt retries. All 48 success callbacks also pass the exact deployed
  API ZIP using its Linux dependencies.
- Jaywalk's native/WASM full exports match byte-for-byte for all 64,233 ticks.
  All 536 world hashes and 264,979 network applications verify with zero seed
  mismatches or refusals. Original film/map bytes remain unchanged. Ten
  participants are accepted; slots 8/9 have explicitly unknown names.
- The other eleven Beta 5 films retain identical viewer bytes, native analytics
  and final counters compared with the preceding exporter-11 acceptance run.
- The reviewed saved plan applied only `aws_lambda_function.h1_film[0]`:
  image and producer digest, 0 added / 1 changed / 0 destroyed. First live
  health and exact release/registry verification pass. Default activation is
  fenced to API 222 and prior policy revision 4.
- The focused worker postplan is no-op. Full dev has no resource actions;
  only the existing unapplied API version-output refresh 213 to 222 remains.
  Read-only before/after checks preserve 59 conversions, 284 receipts, 232
  H1 attempts, all 220 approvals (including 70 Beta 5), and worker/API limits,
  concurrency and queue settings.

Commands, run from the isolated checkout for publication and repo root for promotion:

```powershell
.\scripts\publish-h1-film.ps1 -Tag 20261031-r1 -EngineRoot <beta5-engine-store> -PreviousRegistry <r4-registry> -CorpusPath <sixteen-film-corpus>
.\scripts\plan.ps1 dev map-processing
atmos workflow promote-dev --file h1-film
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Evidence: `.build/h1-roster/`,
`.build/h1-roster-release/.build/h1-contracts/20261031-r1-51d73a42117d4c5b89975a33befbdd61/`,
and `.build/h1-promotions/20261031-034023-0a0383d9e2ee4be0b0e5a768d8964a9e/`.
No migration, live retry/reparse, frontend release or prod action was submitted.
Policy rollback must retain the new worker/API readers and immutable old pins.

## Diagnostic companion downloads enabled (2026-10-30 UTC)

The user-reviewed uploads-ingest change is applied in dev. The saved plan
updated only `module.uploads_bucket.aws_s3_bucket_policy.this` (0 added, 1
changed, 0 destroyed), allowing generation-bound `h1-client-diagnostics.v1.*.h1diag`
files through the existing distribution `E3EQNW63YKDA8U` read grant. The worker,
API and frontend required no deployment; object versions and contents are unchanged.

Both real companions changed from 403 to valid 32-byte 206 responses with
`H1DG0001`, correct Content-Range and CORS for `http://127.0.0.1:5173`. Full
downloads pass `https://dev.halospawns.com` CORS and match SHA-256 hashes at
2,748,426 and 1,647,398 bytes. The sibling `.hsrv` remains readable; the existing
completion manifest, original `.h1film` and original `.map` remain 403. Live
policy equals the reviewed plan, CloudFront configuration/ETag is unchanged,
and all S3 public-access blocks remain enabled. Nine Terraform tests pass and
the focused postplan is no-op. The full dev postplan has no resource actions,
only the existing unapplied API version-output refresh 213 to 221. No
invalidation, reparse or prod action.

Evidence: `.build/h1-diagnostics-cdn-20261030/` (saved plan, apply, policy review,
before/after HTTP checks and postplans). See `ASSET_DELIVERY.md` and completed
handoff `20261030-api-infra-h1-diagnostics-cdn-access`.

## PB2 Beta 5 catalogue classification deployed (2026-10-29 UTC)

API **live=220** (`7bba3c1`) now classifies H1 games by the verified engine's
assigned game release, independently of the map's original release. Worker and
default **20261029-r4**, policy revision **4**, remain unchanged. API CI:
[40970963827](https://github.com/Mintograde/halospawns-api/actions/runs/40970963827).
All 183 deployed Python source files match the committed source; deployed ZIP
SHA-256 is `4f17d33a381cc7cbe1c60b54ca621c153f251f58e3027086d258c854f481b730`.

The user authorized creating the dev release from PB2 Beta 4 and correcting
existing verified Beta 5 games. The audited release service created
`halo1_pc_pb2_beta5`, display name `Halo Performance Build 2.0 Beta 5`, short name
`PB2 Beta 5`, ID `e45586ef-99cc-47e5-ae8a-21879e0ab4bc`. It retains the original
game/platform/cache fields and reviewed `absent` ui.map policy, with new names,
description and copy provenance. It does not invent a map upload or discovery
fingerprint. Creation audit: `1339817c-8e1e-4cbc-9c6f-ab801fa113e1`.

Applied API-owned additive migration `20261029010000_h1film_game_releases.sql`,
then assigned `h1-performance-beta5-p9818-wasm-v1` to the release through the
audited engine service at settings revision 2. New initial conversions freeze
the played release and settings revision in API-only immutable columns. Existing
conversion identities, worker jobs and completion contracts remain unchanged.
Legacy null pins retain map-based classification; explicit admin overrides take
priority during retries and full reparses. Contract and rollback guidance:
`../halospawns-api/docs/h1film-game-releases.md` (relative to the repository root).

Both release-map listing and map collection queries return the same **70**
approved maps for Beta 5. Map IDs, raw/GLB assets, origin Beta 4 release and all
Beta 4/Beta 5 approvals are unchanged. Membership is derived from currently
eligible approvals for assigned engines, so stale/retired approvals cannot
silently grant compatibility. No duplicate map records or release tags are needed.

Two existing games were corrected through the audited game-release override
service after checking their immutable Beta 5 conversion engine:

- `2c30be17-93af-402a-90f3-9b15137f63b0`, audit
  `d005f155-0565-4068-b063-607b9c3ca68d`.
- `a38181f5-e000-46f3-81b8-4729b02ffbe0`, audit
  `52442e76-7903-44c6-8758-5ce544fb232a`.

Live database queries confirm `PB2 Beta 5` in both game-list runtime summaries.
Before/after checks prove old jobs, identities, receipts, reprocess attempts,
map approvals, the Beta 4 catalogue release and all other game fields unchanged.
No replay conversion or artifact rewrite was submitted.

Validation: 1,778 unit tests, 124 database integration tests and 17 frontend
context tests pass; Ruff and CI pass. The exact deployed API ZIP accepts all
21 archived initial/full/viewer callbacks across seven films/four profiles,
including failure and receipt checks. Public health is 200; worker digest and
r4/revision-4 policy are unchanged. Focused app-api and full dev plans have no
resource actions, only the unapplied API version-output refresh 213 to 220;
existing `asset_delivery_mode` warnings remain. Evidence: `.build/beta5-release/`, including
`verified.json`, `classification-{before,after,audits}.json`, and
`deployed-callbacks/`. Frontend tests remain local and uncommitted; its existing
runtime-summary rendering already handles Beta 5. No frontend or prod deployment.

## Beta 5 client diagnostics deployed (2026-10-29 UTC)

Worker/default **20261029-r4** is active in dev at policy revision **4**, with
API **live=219**. Image digest:
`sha256:9cd2a88623b9e9dfe98f6da4298c74603de4045b25796cd438a366b3da817f0b`
(435,198,725 compressed bytes). It was built from committed `b8d975b` in the
isolated `.build/h1-diagnostics-release` checkout. Beta 5 now selects exporter
**11 / analytics 4 / viewer 5**; all four profiles, fourteen exporter entries,
prior recipes and all 70 transferred map approvals remain available.

Exporter 11 preserves LDG1 v5 / LDC1 v11 diagnostic sections in the versioned,
indexed `halospawns.h1ClientDiagnostics.v1` companion. Shot/verdict identities,
client target poses, aim/seen/net/correction samples, trigger pulls, screen
events, input arrival and predicted endpoints retain their original clocks and
row indices. The companion is immutable and tied to the viewer generation;
the API validates its source/map/engine/hash/version bindings and returns its
delivery URL with the selected replay asset. World replay bytes and combat
statistics are unchanged. See `CLIENT_DIAGNOSTICS.md` for the complete contract.
The browser reader and frontend handoff are local and uncommitted; overlay UI
and separate `_client.h1film` predicted-world playback remain future work.

Validation:

- All three supplied Beta 5 films preserve every diagnostic section byte and
  match 1,018,808 independent upstream field comparisons, plus decoded poses,
  aim directions, round links and verdict geometry. All 623 shots pair exactly.
  Companions are 105,415 / 2,748,426 / 1,647,398 bytes. Their packaged hashes
  match the independently verified files; viewer hashes match release r2.
- All 48 Node and 78 local/packaged worker tests pass. Seven packaged films
  cover every profile; all 21 initial/full/viewer callbacks, failures and
  receipt serialization/retries pass against the exact deployed API 219 ZIP.
- API unit tests: 1,775 pass, six skipped. Normal CI: 1,777 pass, 214 skipped,
  four Rust tests and lint pass. The frontend's three focused reader tests and
  standalone build pass (existing large-chunk warning).
- Focused/full preplans allow only the H1 image/digest update. Apply is
  0 added / 1 changed / 0 destroyed. Live engine/registry hashes and health pass.
  Memory 3,008 MiB, timeout 900 seconds, ephemeral storage 8,192 MiB, concurrency
  5 and enabled batch-one queue mapping are retained; queue/DLQ counts are zero.
- Final desired/effective default check agrees on r4/revision 4. Focused
  postplan is no-op; full dev postplan has no resource actions, only the
  unapplied API version-output refresh from 213 to 219. Existing undeclared
  `asset_delivery_mode` warnings are unchanged.

The first activation found a separate API activation allowlist still rejecting
the new contract. It left policy revision 3/r2 unchanged while the compatible
r4 worker was installed. API commits `c96ed90` / `738f473` fix that gate and add
actual activation/rollback/unknown-contract regression tests, following reader
commit `0ec700c`. The retry verifies API 219 and activates revision 4 without a
second resource update. API CI:
[40965036417](https://github.com/Mintograde/halospawns-api/actions/runs/40965036417).
Exact deployed ZIP SHA-256:
`5bdb304e4ae56212e926db62b4ecd194b997a45a76d563b3995b368c6b7578c9`.

Release r3 was published but never installed or promoted; r4 includes the final
unknown-identity and clock-index reader fixes. Immutable tags were not reused.
No database migration, historical reparse, live upload, Weld recovery, frontend
deployment or prod action was performed. Policy rollback may select r2 while
retaining the r4 worker and API 219 companion/activation readers for pinned jobs.

Evidence:

- Promotion: `.build/h1-promotions/20261029-222415-77bea7d7d50b4186a67aa9a741f0e4d1/`.
- Initial apply: `.build/h1-promotions/20261029-221452-c7c4e07cdb4c4be3b713432f26c82ab1/`.
- Packaged corpus: `.build/h1-diagnostics-release/.build/h1-contracts/20261029-r4-abe6aa28f2c643728c14bf9de43e8857/`.
- Callback archive SHA-256: `c5482e429cf57781bd4458b302bbc69e9f224d697b7081cb7f4c1b4560144e48`.
- Reference decoding, plans, policy and operational checks: `.build/beta5/diagnostics-*`.

```powershell
# From the isolated committed checkout, using absolute private input paths:
.\scripts\publish-h1-film.ps1 -Tag 20261029-r4 -EngineRoot <beta5-engine-store> -PreviousRegistry <r2-registry> -CorpusPath <seven-film-corpus>
# Root stack pins image_tag and default_release to 20261029-r4.
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
atmos workflow promote-dev --file h1-film
.\scripts\promote-h1-film.ps1 dev -CheckOnly
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

## Beta 5 deployed (2026-10-29 UTC)

Worker **20261029-r2** is installed and promoted in dev at policy revision
**3**, with compatible API **live=217**. Immutable image digest:
`sha256:d5744b3a9ccaa34e6f3123f9f06288c858d3b593b463b21e6d307fc980517342`
(425,167,035 compressed bytes). Both `image_tag` and `default_release` select
this release. The new `beta5` port/profile uses exporter 10 / analytics 4 /
viewer 5 and pins upstream `beta-5` / `fbbfae27d6be7e47613acce37da95ed754dccb42`.
All four profiles, thirteen exporter entries and prior recipes are retained.
See `BETA5.md` for exact binary pins, source-layout changes and tested scope:
protocol 9818 / `Linux server` authoritative recordings; other recorder labels
and client-view films remain unsupported.

The user explicitly authorized all Beta 4 approvals to carry forward. All
**70** eligible approvals were copied with the API-owned audited transfer
service from the matching API source, under the existing sole admin approver.
The bounded previews had zero blockers. Transfers preserved every raw S3
version/hash/size, map/release/scenario identity, GLB hash and exporter evidence;
each destination has source-binding and transfer lineage. All original Beta 4
rows were compared afterward and remain unchanged. Operations:
`baa4fd58-d760-4237-8a4b-2cbcd8f04ff7` (50) and
`34c21a84-6875-42e7-93f6-7c3887d3f81a` (20). The new display name is
`H1 Performance Beta 5`. Preview, frozen requests, results and verification are
retained under `.build/beta5/map-*.json`; no raw SQL mutations were used.

API commit `e916ba48b849ee1f3e16a655d9cebef0abab74dd` extends only the reviewed
timestamp/network-host evidence reader. It passed normal
[build/publish CI](https://github.com/Mintograde/halospawns-api/actions/runs/40956754525)
and deployed as 217. The actual deployed ZIP SHA-256 is
`35759d484103d8954393256762ff25a1cd54bab6fd771a6939009a3c6feeefc7`.
The promotion verified that ZIP's hash and Linux dependencies and fenced API
217 through activation. Engine/default registration remains manifest-owned;
no migration, API hash-table update or frontend pin change was needed.

Validation and rollout:

- Final reproducible WASM exports match native bytes for all three supplied
  Beta 5 Dread films: 115,604 ticks, 964 recorded hashes, zero seed/hash
  mismatches. The longer film has eight distinct participants and late joins.
- All 41 Node and 76 local/packaged worker tests pass. API source passes 1,766
  unit tests (six skipped) and full lint. Container health and rejection pass.
- Seven packaged films cover Beta 3, retained arena, Beta 4 and Beta 5. All
  initial/full/viewer callbacks and receipt retries pass. All 21 success
  callbacks plus failure/receipt checks pass against the actual deployed API.
  All three Beta 5 products retain settings and real `neutral` host evidence.
- Focused/full preplans contain only the H1 image/digest resource update.
  The guarded apply is **0 added / 1 changed / 0 destroyed**. Live worker health,
  all retained hashes, release/registry provenance and API `/health` pass.
- Final desired/effective default is `20261029-r2`, revision 3. Memory 3,008
  MiB, timeout 900 seconds, ephemeral storage 8,192 MiB, concurrency 5 and the
  enabled batch-one SQS mapping are unchanged. Queue and DLQ counts are zero.
- Focused postplan is no-op. Full dev postplan has no resource actions, only
  the unapplied API version-output refresh 213 to 217. Existing undeclared
  `asset_delivery_mode` warnings are unchanged.

Exact release commands:

```powershell
.\lambda\h1_film\tools\build-engine.ps1 -Source .build/beta5/source -BuildDirectory .build/beta5/wasm-final -Port beta5 -Combat -NetworkReplayFixes -DamageAttribution -FiniteWorldObjects
.\scripts\publish-h1-film.ps1 -Tag 20261029-r2 -EngineRoot .build/beta5/engines -PreviousRegistry .build/beta5/previous-registry.json -CorpusPath .build/beta5/corpus.json
# Set map-processing.h1_film.image_tag and default_release to 20261029-r2.
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
atmos workflow promote-dev --file h1-film
.\scripts\promote-h1-film.ps1 dev -CheckOnly
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Promotion evidence:
`.build/h1-promotions/20261029-212535-0744496dc30542b6b3c70fc807c36a79/`.
Packaged corpus:
`.build/h1-contracts/20261029-r2-251bcb5d9e53406883fb67e24fb980e4/`.
Published callback archive SHA-256:
`c88581d5ce1dc75017e01a55d0013301e4d19c13b0822caa3c6e0be140ab167f`.
Build/parity, approval transfer, plans and operational evidence: `.build/beta5/`.

No live upload/reparse, Weld recovery, historical backfill, queue mutation,
frontend deployment or prod action was submitted. Existing attempts retain
their pins. Keep Beta 5 readers and all engines when rolling back the default;
the previous worker/default release remains available.

## Host-style extension deployed (2026-10-29 UTC)

The user authorized publication and dev promotion while the compatible API was
deploying. Worker **20261029-r1** is installed and is the effective default at
policy revision **2**, verified against API **live=215**. Immutable image digest:
`sha256:ccd005c4bfddc978db259b54adb6758a3b89dad82926ae6f5020bc82ada49a25`
(405,091,675 compressed bytes). The release date is UTC; local publication was
the evening of October 28.

This release adds `network_host: halospawns.h1NetworkHost.v2` for evidence-based
`on_off` / `neutral` / unknown classification. All three profiles, twelve
exporters, existing map approvals and processing recipes remain unchanged:
Beta 4 uses 10 / 4 / 5; Beta 3 and retained arena use 5 / 4 / 4. New initial/full
attempts resolve the new release; old attempts and receipts keep their pins.
See `BETA4.md` and completed handoff `20261027-infra-api-h1film-host-style`.

The image was built from committed source
`005d008c8a919eee88c69e0955889c54221e74b4` in the isolated checkout
`.build/h1-release-source-20261029-r1/`. This excludes the user's pending
uncommitted Xbox local-host edit to `lambda/replay_parser/handler.py`, which
the H1 Dockerfile otherwise copies as a shared dependency. The original
working-tree edit and its tests remain untouched.

The user's API release from commit
`bfa39fcd9c4ebef10888be7948164aa152ceca3c` reached alias 215 through normal CI.
The downloaded ZIP SHA-256
`3cbd73db679a425cbad48311f24d70e3f7aacb7047b6675d3ad46b65f4adf9e1`
matches AWS. Its reader and release-requirement compatibility were verified
before publication; the promotion then tested against the actual deployed ZIP
and its Linux dependencies, fencing that same API version through activation.

Validation:

- All 32 Node tests and 74 packaged Python worker tests pass. Read-only/non-root
  container health and job rejection pass.
- Four packaged real films cover Beta 3 Prisoner, retained arena Dread, Beta 4
  Weld and local bot Dread. All initial/full/viewer callbacks and immutable
  receipt retries pass. Weld verifies 88,043 ticks and all 734 recorded hashes.
- All twelve success callbacks, terminal failure callbacks and receipt
  serialization pass against deployed API 215 without manual registry injection.
  Neutral classification retains synthetic coverage; a real dedicated-server
  film remains a private-corpus follow-up.
- Focused and full dev preplans have only the H1 image/digest resource update;
  the full plan also has the state-only API version-output refresh 213 to 215.
  Renderer version 287 to 288 is external refresh drift, not a resource action.
- The guarded saved-plan apply is **0 added / 1 changed / 0 destroyed**.
  Live worker health, every retained engine hash, registry digest and producer
  image pass. The API `/health` check passes. Memory 3,008 MiB, timeout 900
  seconds, concurrency 5 and enabled batch-one queue mapping are unchanged.
  Queue visible/in-flight/delayed counts and DLQ depth were zero after promotion.
- Final `-CheckOnly` confirms desired/effective `20261029-r1`, revision 2.
  The focused postplan is no-op. The full dev postplan has no resource actions,
  only the unapplied API version-output refresh 213 to 215. Existing undeclared
  `asset_delivery_mode` warnings remain unchanged.

Exact release commands (the isolated checkout contains the committed scripts):

```powershell
git worktree add --detach .build/h1-release-source-20261029-r1 005d008c8a919eee88c69e0955889c54221e74b4
Push-Location .build/h1-release-source-20261029-r1
.\scripts\publish-h1-film.ps1 -Tag 20261029-r1 -EngineRoot L:/tmp/halospawns-weld-270337d1/release-r2/engines -PreviousRegistry L:/bens_stuff/projects/halospawns-infra/.build/h1-releases/20261027-r1-publication/registry.json -CorpusPath L:/bens_stuff/projects/halospawns-infra/.build/h1-film-corpus.json
Pop-Location
# Set map-processing.h1_film.image_tag and default_release to 20261029-r1.
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
atmos workflow promote-dev --file h1-film
.\scripts\promote-h1-film.ps1 dev -CheckOnly
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Promotion evidence:
`.build/h1-promotions/20261029-001918-98062403d9a84b5fa6d8ccbe27017c0e/`.
Release logs, pre/postplans and operational snapshots:
`.build/h1-host-style-release-20261029-r1/`. Packaged corpus evidence:
`.build/h1-release-source-20261029-r1/.build/h1-contracts/20261029-r1-40efd38bbaac4871a9638c3feb31b22d/`.
Published callback archive SHA-256:
`3dd1102b59ba87a146695d290bc55274666b503604a6f71edda0eb74d7365e60`.

No live upload/reparse, Weld recovery, historical backfill, queue mutation,
migration, frontend deployment or prod action was submitted. Historical games
need separately requested full reparses. Keep the release-aware readers and
all retained recipes on rollback. The previous 20261027 release is retained.

## Immutable release defaults deployed (2026-10-27 UTC)

Dev worker **20261027-r1** is installed at immutable ECR digest
`sha256:49ae52a3cb361b673aaac02c2871409808a21f91cfc5f47591050cdf03f0ae16`
(405,087,024 compressed bytes). API **live=213** has release resolution enabled.
The effective default is **20261027-r1**, policy revision **1**. Beta 4 uses
exporter 10 / analytics 4 / viewer 5; Beta 3 and retained arena use 5 / 4 / 4.
All three profiles, twelve exporters, maps, old jobs and receipts are retained.
New completions include the requested release and actual producer image.

Read [RELEASES.md](RELEASES.md) for the normal publish/promote workflow. Once a
compatible image is installed, changing `h1_film.default_release` and running
`atmos workflow promote-dev --file h1-film` promotes new initial/full attempts.
Compatible exporter/profile additions come from the immutable manifest, without
API hash/default commits or frontend pin updates. New contract/adapter behavior
still requires compatible readers. Retries and viewer-only rebuilds retain pins;
policy rollback does not route old attempts to historical shared runtimes.

API-owned migration `20261026010000_h1film_releases.sql` was dry-run checked and
applied to linked dev. It adds the immutable release catalogue, singleton policy
and append-only activation audit with RLS and no browser grants. API commits
`0a456adb5646c2eeed554c0a6fb73b5c02fb9291` and
`d12255bfab06a2425e3643bc7aa85210f4f221c1` passed normal CI:
[initial release](https://github.com/Mintograde/halospawns-api/actions/runs/40446489044),
[scoped-preview policy](https://github.com/Mintograde/halospawns-api/actions/runs/40447554791).
API configuration bootstrap published 210, CI published 211/212, and final
release enablement published identical code as 213. Its downloaded ZIP SHA-256
`7ba1b41da942f6e4be9a376cfdd00c59c5c46a2ebcad5cbc1c5b915bfd92cf21`
matches AWS's code hash. No CI workflow or GitHub environment variable changed.

Validation:

- Four packaged real films cover every profile: Beta 3 Prisoner, retained arena
  Dread, Beta 4 Weld and bot Dread. Initial/full/viewer callbacks and immutable
  receipt retries pass. All twelve success callbacks, every terminal failure
  reason for initial/manual attempts, and receipt serialization pass against the
  exact deployed API 213 ZIP and Linux dependencies without manual hash injection.
- 74 packaged Python worker tests, 31 Node tests, read-only/non-root container
  checks and live worker registry/engine health pass. The cold-health child
  timeout is now 60 seconds; the deployed health checks passed.
- Latest API CI: 1,735 passed / 187 skipped, Rust checks/tests and Ruff pass.
  Opt-in database/private-product tests are not enabled in CI. Separately, 17
  relevant PostgreSQL tests passed locally, including concurrent promotion,
  immutable registration, fresh initial/full resolution, stale previews, rollback
  and existing batch/job retry pins. A synthetic future exporter 11 is accepted
  as manifest data without another API registration constant.
- Frontend: all 756 site tests, `pnpm build:site` and `pnpm build` pass. Tests cover
  dynamic targets, stale policy rejection and scoped preview/journal fencing.
  Existing bundle-size warnings remain. Frontend is uncommitted and undeployed
  for the user's local testing against dev.
- Publication checkpoint recovery, image-derived manifest equality and guarded
  artifact ordering passed with AWS writes stubbed; completed-publication resume
  was also verified against S3 without a rebuild or overwrite.

Only `app-api` and `map-processing` were changed. API bootstrap:
**2 added / 3 changed / 1 destroyed** (the destruction is replacement of the
configuration-invocation marker, not a service). Final flag enablement:
**1 added / 3 changed / 1 destroyed**, again the marker. Worker saved plan:
**0 added / 1 changed / 0 destroyed**, only its image and digest environment
value. The workflow rejected an initial verifier assertion before any deployment;
the checker was corrected to use wire aliases during serialization. All later
checks passed. A repeated promotion was a worker no-op and kept policy revision 1.
The focused API and worker postplans are no-op. The final full dev postplan
reports no changes for all six enabled aggregate components, including no
pending API version-output refresh. Existing undeclared `asset_delivery_mode`
warnings remain unchanged.

The API role gained only `lambda:GetFunction` on `halospawns-h1-film-dev`.
Release commands use direct IAM Lambda invocation; no HTTP control route or
new credential exists. API processing/uploads/release flags are true, limit 16;
worker memory 3,008 MiB, timeout 900 seconds, reserved concurrency 5 and batch-one
event source remain unchanged/enabled. Queue visible/in-flight counts and DLQ
depth were zero at the final read. API `/health` passes. No AWS/session blocker.
No upload, live reparse, Weld recovery, queue mutation, frontend deployment or
prod action was submitted. Infra/frontend changes remain uncommitted.

Exact commands from the infra root (API commands use its sibling directory):

```powershell
# API migration and CI
Push-Location ../halospawns-api
.\scripts\apply-migrations.ps1 -DryRun
.\scripts\apply-migrations.ps1
# The two commits above were pushed to main through normal build-and-publish CI.
Pop-Location

# Immutable image plus private real-film corpus
.\scripts\publish-h1-film.ps1 -Tag 20261027-r1 -EngineRoot L:/tmp/halospawns-weld-270337d1/release-r2/engines -PreviousRegistry L:/tmp/halospawns-h1film-hosts-20261025/release-r3/previous-registry.json
.\scripts\publish-h1-film.ps1 -Tag 20261027-r1 -ResumePublication

# API bootstrap: release flag initially false
.\scripts\plan.ps1 dev app-api
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/app-api' plan -no-color '-var-file=dev-app-api.terraform.tfvars.json' '-out=L:/bens_stuff/projects/halospawns-infra/.build/h1-release-api-bootstrap.planfile'
terraform '-chdir=components/terraform/app-api' show -json 'L:/bens_stuff/projects/halospawns-infra/.build/h1-release-api-bootstrap.planfile'
terraform '-chdir=components/terraform/app-api' apply -no-color 'L:/bens_stuff/projects/halospawns-infra/.build/h1-release-api-bootstrap.planfile'

# Worker install and policy activation, after CI compatibility checks
atmos workflow promote-dev --file h1-film
# Workflow internally runs scripts/plan.ps1 dev map-processing and reviews/applies
# .build/h1-promotions/20261027-035807-5e497bddf27e443d95d609c49756b0f9/worker.planfile

# Final release flag true
.\scripts\plan.ps1 dev app-api
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/app-api' plan -no-color '-var-file=dev-app-api.terraform.tfvars.json' '-out=L:/bens_stuff/projects/halospawns-infra/.build/h1-release-api-enable.planfile'
terraform '-chdir=components/terraform/app-api' show -json 'L:/bens_stuff/projects/halospawns-infra/.build/h1-release-api-enable.planfile'
terraform '-chdir=components/terraform/app-api' apply -no-color 'L:/bens_stuff/projects/halospawns-infra/.build/h1-release-api-enable.planfile'

# API 213 callback/health/policy checks, idempotency and postplans
atmos workflow promote-dev --file h1-film
.\scripts\promote-h1-film.ps1 dev -CheckOnly
.\scripts\plan.ps1 dev app-api
.\scripts\plan.ps1 dev
```

Final promotion evidence:
`.build/h1-promotions/20261027-040844-b62960d760774dc7aa50187999643a35/`.
Archive SHA-256: `ce778f2711db7eb18654c3193e8f25872a2e4bf4cb951769c45dbf2fa7edc03b`.
Plans, applies, publication logs and validation output are under `.build/h1-release*`.
Changed files are the two components' `h1-film.tf`, `stacks/dev.yaml`, the H1
workflow and publish/test/verify/promote scripts, worker Docker/intake/health,
registry/schema snapshots, verification tools/tests and these runbooks. API
changes are in the two commits above; frontend changes cover shared request
builders and admin reparse controls/tests/journals.

## Network Host Metadata Deployed (2026-10-25 UTC)

User-authorized dev worker **20261025-r3** is active at immutable ECR digest
`sha256:fb3070bf0342ea8e00d29b1ca80edf3123844bbaeb3ad875c8bede76ef0a93fc`
(404,940,352 compressed bytes). Tested and published image ID:
`sha256:5b7b709edc96cf571acbf485bfadc7289ea4c21a8490504f8d6a02e8ba1cc4ea`.
Initial/full-reparse callbacks carry validated Beta 4 network-host evidence;
API derives the existing Host metadata/fact and the existing frontend badge.
Viewer-only rebuilds and immutable receipt retries do not update host metadata.
All three profiles, twelve exporters, encoder and existing job/default pins
remain unchanged: worker intake is 10/4/5, API omissions remain 9.

The user authorized deployment while API CI was running. CI run `40222631057`
for user commit `28c84d3e7d648de55131b70fd0e41c271fa0f265` completed before
activation, promoting **API live=208**. Downloaded ZIP SHA-256
`0395276b8db345098370a0cff42400d4e3af4c2b08f67a86b4534d65ba3fbbfe`
matches AWS's code hash. Packaged `schemas/h1films.py`,
`services/h1film_ingest.py` and `h1film_contract.py` match tested source after
line-ending normalization. All eighteen actual release-image callbacks pass
the deployed ZIP and its Linux dependencies without registry injection. Both
H1 flags remain true, participant limit 16 and API health passes.

Six network-isolated packaged films pass initial/viewer/full callbacks and
immutable receipt retries: both supplied Weld copies, October 24 Dread,
October 22 network Dread, bot Dread and Birdhouse. Both Weld copies identify
only `Bot 1`; the bot film identifies no network host. Viewer/spatial hashes,
participants, game data, native combat and settings match prior accepted
products exactly; only optional host proof and runtime telemetry differ.
All 73 worker tests pass locally and packaged; all 30 Node tests and read-only,
non-root container health/job rejection pass. The earlier 451 focused API
tests (four optional corpus skips), 26 game-detail tests and Ruff also pass.

Commands run from the infra root (`$release` is the evidence directory):

```powershell
$release = 'L:/tmp/halospawns-h1film-hosts-20261025/release-r3'
.\scripts\publish-h1-film.ps1 -Tag 20261025-r3 -EngineRoot L:/tmp/halospawns-weld-270337d1/release-r2/engines -PreviousRegistry "$release/previous-registry.json" -BuildOnly
& "$release/verify-release.ps1"
& "$release/activation/verify-deployed-api.ps1"
.\scripts\publish-h1-film.ps1 -Tag 20261025-r3 -EngineRoot L:/tmp/halospawns-weld-270337d1/release-r2/engines -PreviousRegistry "$release/previous-registry.json"
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/map-processing' plan -no-color '-var-file=dev-map-processing.terraform.tfvars.json' "-out=$release/activation/reviewed.planfile"
terraform '-chdir=components/terraform/map-processing' show -json "$release/activation/reviewed.planfile"
terraform '-chdir=components/terraform/map-processing' apply -no-color "$release/activation/reviewed.planfile"
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Focused/full/saved preplans and apply change only the H1 image:
**0 added / 1 changed / 0 destroyed**. Saved JSON review permits only
`image_uri` and computed `last_modified`; applied plan SHA-256:
`8e6b8cc3eb1684b60b209791f329c86b61d4e351d4421b32c8205114a92c66ea`.
The update completes in 30 seconds. Preplans observe external renderer version
286 to 287 without any renderer action. Focused postplan is no-op; full dev has
no resource actions, only the unapplied API version-output refresh 194 to 208.
Existing undeclared `asset_delivery_mode` warnings remain unchanged. No
aggregate or app-api apply was performed.

Live verification at 18:55 UTC confirms Active/Successful, every retained
engine hash and unchanged encoder, environment/IAM, x86_64, 3,008 MiB memory,
900-second timeout, 8,192 MiB temporary storage, concurrency 5 and enabled
batch-1 queue mapping. First cold health inventory hits its existing 20-second
child timeout; the second read-only health check passes. Profile
`halospawns-dev`, account `283279960672`, region `us-east-1`: no session blocker.
No job/retry/reparse, DB migration, map approval, direct API code/alias write,
frontend deployment or prod action occurred. Existing completed games need
separately authorized full reparses to gain Host tags. Retain the compatible
optional completion reader and all existing pins on rollback.

Feature files: `runtime/adapters/beta4-v2-120.mjs`, `recorded.py`, `cloud.py`,
`contracts/h1film-completion.v1.schema.json`, `tests/beta4.test.mjs`,
`tests/test_cloud.py`, `tools/verify-api-products.py`, `tools/verify-cloud.py`,
API host schema/normalizer/tests and the frontend game-detail regression test.
Activation changes: `stacks/dev.yaml`, this file, `BETA4.md`, `COMPATIBILITY.md`,
root `AGENTS.md`, `ATMOS_MIGRATION_PLAN.md`, both root handoffs and API status
docs. Components: ECR publication and `map-processing` image-only apply.
Evidence, plans, exact API artifact and checks: `$release/activation/` above.
Coordination `20261025-infra-api-h1film-network-host` is complete.

## Weld Fix Deployed (2026-10-25 UTC)

User authorized and completed dev deployment of additive Beta 4 exporter 10, retaining
analytics 4/viewer 5 and every existing engine and persisted pin. Image
`20261025-r2` is active at immutable manifest digest
`sha256:38504af28c13473949a81da05c6d693e6b22f8888bfe30691e1f86803fe44307`
(404,939,576 compressed bytes). The tested/published image ID is
`sha256:a8525998b0ee7c624d89ffbb1d9bb47a583208eab1de7efc9adfbdf5246ae641`.

Weld completes all 88,043 ticks and 734 recorded hashes, with verified 120/30 Hz
readback. Actual release-image checks cover Weld, October 24 Dread, October 22
network Dread, bot Dread and Birdhouse. All fifteen initial/viewer/full callbacks
pass both updated API source and the actual deployed API 207 ZIP with its
Linux dependencies. All 73 worker tests
pass locally and packaged; 28 Node and 149 focused API tests pass, as does Ruff.
The four earlier films retain viewer/spatial bytes, gameplay, settings and
combat data; differences are exporter provenance and runtime telemetry only.
Native Weld reference still has two isolated hash mismatches; WASM matches all
recorded hashes. See `BETA4.md` for the exact fix and limitation.

The registry and retention fixture add 10; new worker intake explicitly asks
for 10/4/5. API source registers the same hashes and allows explicit 10/4/5
reparses, with omission defaults left at 9. The user committed/pushed API
`afe7c5c0e2fc27794fd46f7e4c0d75344916b3a4` and explicitly authorized worker
activation while CI was running, accepting a brief single-user dev compatibility
gap. The reviewed image-only apply completed while API 206 was still live.
CI run `40216737366` then completed successfully and promoted API **live=207**.
Its downloaded ZIP SHA-256 is
`109786397b2d40b159a816fee66c9d042e71d2a26f898e54af844046628929a3`, matching AWS's
code hash. Both changed contract/schema modules match tested source after
line-ending normalization; all fifteen callbacks pass without registry injection.
Both H1 flags remain true, the API participant limit is 16, and HTTPS health
passes. Coordination `20261025-infra-api-h1film-finite-exporter10` is complete.

Commands run from the infra root:

```powershell
.\scripts\publish-h1-film.ps1 -Tag 20261025-r2 -EngineRoot L:/tmp/halospawns-weld-270337d1/release-r2/engines -PreviousRegistry L:/tmp/halospawns-weld-270337d1/release-r2/previous-registry.json -BuildOnly
.\scripts\publish-h1-film.ps1 -Tag 20261025-r2 -EngineRoot L:/tmp/halospawns-weld-270337d1/release-r2/engines -PreviousRegistry L:/tmp/halospawns-weld-270337d1/release-r2/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/map-processing' plan -no-color '-var-file=dev-map-processing.terraform.tfvars.json' '-out=L:/tmp/halospawns-weld-270337d1/release-r2/activation/reviewed.planfile'
terraform '-chdir=components/terraform/map-processing' show -json L:/tmp/halospawns-weld-270337d1/release-r2/activation/reviewed.planfile
terraform '-chdir=components/terraform/map-processing' apply -no-color L:/tmp/halospawns-weld-270337d1/release-r2/activation/reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Focused/full/saved preplans and apply: **0 added / 1 changed / 0 destroyed**;
only the H1 `image_uri` and computed `last_modified` change. Preplans observe
the external renderer version refresh 285 to 286 without a renderer action.
Applied exactly the reviewed plan, SHA-256:
`43dfea3a7cbf794dd4d5c982ba806266fc343c07d51c919fdb1c67ba4369ceec`.
The image update completes in 20 seconds. Focused postplan is no-op; full dev
postplan has no resource actions, only the unapplied API version-output refresh
194 to 207 (preplan saw 206). No app-api or aggregate apply was performed.

Worker is Active/Successful; live health verifies all three profiles, twelve
exporters and unchanged encoder
`7335dd63d12605c944e618c844b4688aa148a5292e03b904cf152b57182bc21e`.
Cold health inventory reached its existing 20-second child timeout; the second
read-only invocation passed. Environment, IAM, x86_64, 3,008 MiB memory,
900-second timeout, 8,192 MiB temporary storage, concurrency 5 and the enabled
batch-1 queue mapping are unchanged. Final worker/API verification passes at
17:34 UTC. Profile `halospawns-dev`, account `283279960672`, region `us-east-1`:
no session blocker. No job/retry/reparse, migration, map approval, direct API
code/alias write, frontend deployment or prod action was performed.

The failed Weld upload still needs a separately authorized new explicit
10/4/5 processing attempt; the failed exporter-9 attempt remains pinned.
Retain exporter 10 and every older engine/registration on rollback. Evidence,
actual deployed API ZIP, plans, apply and live checks:
`L:/tmp/halospawns-weld-270337d1/release-r2/activation/`.

Changed files: `engines/beta3/export.c`, `engines/beta3/stream.h`,
`engines/beta4/wasm/CMakeLists.txt`, `tools/build-engine.ps1`,
`tests/build-engine.test.ps1`, `profiles/registry.json`, `cloud.py`,
`tests/test_cloud.py`, `tests/fixtures/retained-profiles.json`, `stacks/dev.yaml`
and rollout/status/handoff documents. API changes are `h1film_contract.py`,
`schemas/h1film_reparse.py`, `tests/unit/test_h1film_beta4.py` and `HANDOFFS.md`.
Components: ECR image publication and `map-processing` image-only apply.

## Damage Attribution Deployed, 2026-10-25 UTC

At the user's explicit authorization, published and activated **20261025-r1**
in dev. New Beta 4 intake selects **exporter 9 / analytics 4 / viewer 5**.
The worker resolves remote weapon damage from exact map tag references while
preserving actual damage, shot/hit counts, viewer bytes, settings and every
existing profile/exporter/retry pin. All 770 formerly unknown damage events in
the supplied October 24 Dread film gain attribution. Exact semantics, hashes
and native/WASM evidence are in `BETA4.md`.

Immutable ECR manifest digest:
`sha256:464fe1714bd2a28289d54ea230dc32e69d056190d88f62f65f8bfc69e46ba553`
(395,346,693 compressed bytes). Tested and published image ID:
`sha256:03a0ff965708aad3c6315d9e0a10446459dbc4e57fa8654eb771958eae680480`.
Publication preserved that exact tested image. The previous registry was
extracted from immutable `20261024-r2`; all three profiles, all ten previous
exporters and the encoder remain unchanged. Exporter 9 is additive and is now
protected by the retained-profile fixture. Existing jobs never repin.

The user allowed activation before API CI completed. CI actually finished
before the apply: **API live=204**, run `40148636713`, commit
`af99fdd11d772ed0d6e8b7c78f460df3efff2fd7`. Its downloaded ZIP SHA-256 is
`0b587eff6713c84c7b91fa509378d9253eb213c03eebdd081a5f881e5a34c6ec`, verified
against AWS's code hash. Four relevant contract/schema/normalizer modules match
tested source after line-ending normalization. All twelve release-image
callbacks pass the deployed ZIP's actual Linux dependencies without registry
injection. A preliminary snapshot of preceding API 203 correctly rejected 9;
that evidence is retained separately. Both H1 flags stay true and the limit
stays 16. No direct API code/alias write or migration was performed by infra.

Release validation:

- 23 focused intake tests, all 73 worker Python tests locally and packaged,
  28 Node tests, and read-only/non-root container health/job rejection pass.
- Four actual release-image films (supplied Dread, network Dread, bot Dread,
  Birdhouse) pass initial/viewer-rebuild/full-reparse and immutable receipt
  retries with network disabled, fake API/S3, two CPUs and 3,008 MiB.
- All twelve callbacks pass deployed API schemas, normalization, settings,
  graph and spatial builders. Entire callbacks match the accepted candidate
  except measured runtime durations/memory; viewer/occupancy hashes, damage,
  native analytics, settings, game and participant/team data are unchanged.
- The earlier four complete native/WASM comparisons cover 239,296 ticks and
  1,996 hashes per engine. All player-owned damage is attributed in these films.
  Partial network shot/damage coverage remains honest; no synthetic hits.

Commands run from the infra root:

```powershell
.\scripts\publish-h1-film.ps1 -Tag 20261025-r1 -EngineRoot L:/tmp/halospawns-h1-damage-20261024/engines -PreviousRegistry L:/tmp/halospawns-h1-damage-20261024/release-r1/previous-registry.json -BuildOnly
.\scripts\publish-h1-film.ps1 -Tag 20261025-r1 -EngineRoot L:/tmp/halospawns-h1-damage-20261024/engines -PreviousRegistry L:/tmp/halospawns-h1-damage-20261024/release-r1/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/map-processing' plan -no-color '-var-file=dev-map-processing.terraform.tfvars.json' '-out=L:/tmp/halospawns-h1-damage-20261024/release-r1/activation/reviewed.planfile'
terraform '-chdir=components/terraform/map-processing' show -json L:/tmp/halospawns-h1-damage-20261024/release-r1/activation/reviewed.planfile
terraform '-chdir=components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-damage-20261024/release-r1/activation/reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Focused/full/saved preplans show only the H1 image resource update:
**0 added / 1 changed / 0 destroyed**. JSON review permits only `image_uri`
and computed `last_modified`. Saved plan SHA-256:
`dd034f2defa5952fa616dad8e2beb8552fe4d4e5d5b5f37dc63d5aec13272f4c`.
Applied exactly that saved plan. The full preplan also shows the unapplied
state-only API version-output refresh from 194 to 204; no API resource action
is needed. Existing undeclared `asset_delivery_mode` warnings are unchanged.
No aggregate or app-api apply was performed. Focused postplan is no-op; full dev
postplan has no resource actions, only that unapplied state-only API version
output refresh from 194 to 204.

Live worker health passes on its first read-only invocation at 01:05 UTC:
Active/Successful, all three profiles and eleven exporters match the registry,
and encoder `7335dd63d12605c944e618c844b4688aa148a5292e03b904cf152b57182bc21e`
is unchanged. Environment, IAM, x86_64, 3,008 MiB, 900-second timeout, 8,192 MiB
temporary storage, concurrency 5 and enabled batch-1 SQS mapping are identical
to the prior release. API 204 and HTTPS health pass.

Components: ECR image publication and `map-processing` image-only apply.
Activation changes `cloud.py`, its intake/retained-job test, the retention
fixture, `stacks/dev.yaml` and release/status/handoff docs. Account
`283279960672`, profile `halospawns-dev`, region `us-east-1`: no session blocker.
No jobs, retries, backfill, hosted conversion canary, map approvals, database
migrations, frontend deployment or prod actions were submitted.

Existing games, including `6cac5969-a72b-4ea1-a1e9-0e792af350a6`, need separately
authorized **full reparses targeting 9/4/5**; deployment alone does not replace
their stored stats. API 204 supports explicit 9 but omitted API/admin and
inventory defaults still use 8; their promotion remains API-owned in
`20261025-infra-api-h1film-damage-exporter9`. Worker new intake explicitly asks
for 9. Retain 9 plus all older registrations, binaries and receipt readers on
rollback. Slot score carry-over and partial-accuracy UI remain separate.
Private evidence: `L:/tmp/halospawns-h1-damage-20261024/release-r1/`, with
downloaded API ZIP, plans/apply, product comparisons and live checks in
`activation/`.

## Recorded Settings Deployed, 2026-10-24

After the user confirmed API/migration deployment and authorized infra rollout,
verified **API live=202**, then published and applied **20261024-r2** in dev.
Initial/full reparses now emit `halospawns.h1FilmSettings.v1` with independent
adapter/catalogue revision 1 and a 217-key typed catalogue. Recorded rules,
timing, tuning and recorder-local preferences retain availability/provenance;
viewer-only work and existing immutable receipts remain unchanged. See
[SETTINGS.md](SETTINGS.md) for exact scope and configured-versus-observed semantics.

Immutable ECR manifest digest:
`sha256:bd25629c4549eb17ee57588f2f7eea4fc50463898afbcbf7d2b973fe42ee5d48`
(385,763,825 compressed bytes). Tested and published image ID:
`sha256:1e77e7d9f1004be1f5fefc53d26c124b9dfb99bb4eb14831e1cd1a93514a533f`.
Publication retained that exact tested image. The previous registry came from
the immutable r1 image; all three profiles, ten exporters, encoder and existing
analytics/viewer/default/retry pins are unchanged. No new WASM was built.

The user's API CI run `40113308788` released commit
`89881069d1022ba41b99310f4eb5944ecea560b8`. The actual deployed ZIP SHA-256 is
`3e6350e12f6c74b95df0e6fa903d7019525a851dd92d84bb7c6a6d7de7d885a0`, verified
against AWS's code hash. Five settings/ingest schema, service and repository
modules match tested source after line-ending normalization; the packaged
217-definition catalogue matches the producer exactly. Both H1 flags remain
true and the participant limit remains 16. API owns the already-applied,
forward-only `20261024010000_h1film_settings.sql` migration. Infra did not run it.

Release validation:

- 73 Python tests pass locally and against the actual packaged Linux runtime;
  28 Node tests and read-only/non-root container health/job rejection pass.
- Actual r2 image conversions cover Beta 4 network, Beta 4 bots, Beta 3 and
  h1arena with network disabled and API/S3 mocked. Initial/full/viewer products,
  full-reparse settings equality and three identical receipt deliveries pass.
- All twelve packaged callbacks pass the downloaded API ZIP's actual Linux
  dependencies, schemas, normalizer, graph/spatial builders and settings public
  projection. All twelve preparation callbacks also pass. Settings survive
  normalization unchanged; the public catalogue and producer agree exactly.
- Game/participant/team metadata, native analytics, settings and viewer hashes
  match preparation evidence for all four films. The earlier Beta 4 comparisons
  against r1 also retain stats and viewer bytes; settings are additive.

Commands run from the infra root:

```powershell
.\scripts\publish-h1-film.ps1 -Tag 20261024-r2 -EngineRoot L:/tmp/halospawns-h1-network-20261024/release-r1/engines -PreviousRegistry L:/tmp/halospawns-h1-settings-20261024/release-r2/previous-registry.json -BuildOnly
.\scripts\publish-h1-film.ps1 -Tag 20261024-r2 -EngineRoot L:/tmp/halospawns-h1-network-20261024/release-r1/engines -PreviousRegistry L:/tmp/halospawns-h1-settings-20261024/release-r2/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/map-processing' plan -no-color '-var-file=dev-map-processing.terraform.tfvars.json' '-out=L:/tmp/halospawns-h1-settings-20261024/release-r2/activation/reviewed.planfile'
terraform '-chdir=components/terraform/map-processing' show -json L:/tmp/halospawns-h1-settings-20261024/release-r2/activation/reviewed.planfile
terraform '-chdir=components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-settings-20261024/release-r2/activation/reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Focused, full and saved preplans contain only the H1 image resource update:
**0 added / 1 changed / 0 destroyed**. JSON review permits only `image_uri`
and computed `last_modified`. Saved plan SHA-256:
`53247b886f6ee048114dca1560bd478a346709cacf56bf368a017e8423f565cc`.
Applied exactly that saved plan. Focused postplan is no-op. Full dev postplan
has no resource actions; only the unapplied state-only API version-output
refresh from 194 to 202 remains. Existing undeclared `asset_delivery_mode`
warnings are unchanged. No aggregate or app-api apply was performed.

Live worker is Active/Successful at the published digest. Cold health inventory
reached its existing 20-second child timeout; the second read-only invocation
verified every retained profile/exporter hash, provenance and encoder
`7335dd63d12605c944e618c844b4688aa148a5292e03b904cf152b57182bc21e`.
All operational configuration is unchanged: environment, IAM, x86_64, 3,008 MiB,
900-second timeout, 8,192 MiB temporary storage, concurrency 5 and enabled
batch-1 SQS mapping. API live=202 and HTTPS health remain verified. No limit
was altered to obtain a passing health result.

Components: ECR image publication and `map-processing` image-only apply.
Activation changes `stacks/dev.yaml` plus deployment/status/handoff docs;
implementation adds `settings.py`, schema/catalogue, fixture/tests and offline
tools, and extends `cloud.py` finalization/receipt validation. API-product
verification now checks settings preservation, public projection and catalogue.
Account `283279960672`, profile `halospawns-dev`, region `us-east-1`: no session
blocker. No jobs, retries, backfill, hosted film-conversion canary, approvals,
direct API writes, database migrations, frontend deployment or prod changes.

Existing completed games require separately authorized full reparses; deployment
and viewer rebuilds do not populate them. Frontend integration and filter
operators remain separate; API advertises `filtering_supported: false` while
typed indexes are ready. Keep compatible settings ingest, tables and immutable
receipt readers during rollback, along with every retained engine/exporter pin.
Private evidence: `L:/tmp/halospawns-h1-settings-20261024/release-r2/`, with
plans, apply, API ZIP acceptance and live checks in `activation/`.
Handoffs: `20261024-infra-api-h1film-settings` (completed) and
`20261024-infra-svelte-h1film-settings` (frontend-owned follow-up).

## Network Replay Fixes Deployed, 2026-10-24

After the user's compatible API release and explicit instruction to proceed,
verified **API live=201** and applied immutable dev worker **20261024-r1**.
The reviewed `map-processing` apply changed only the H1 image: **0 added /
1 changed / 0 destroyed**. The stack now pins r1. No direct API code or alias
write was performed; the user's normal CI/S3 updater owns that release.

ECR manifest digest:
`sha256:fb93fdba821906237ce819cb2966b2d5100090aafc67cbe9940b46e6f4576291`
(385,755,344 compressed bytes). Published image ID:
`sha256:ea1162f9840e7e88226996ee733379ecf6c925fc2910088ebf99ec1efedabdb4`.
It adds Beta 4 exporter 8 WASM
`97faa72b6116ad254ec3b87dbb203c0a482665c1eadec73b8516b89323785761`,
retaining glue, analytics 4, viewer 5, the profile and all earlier binaries.
The retention fixture now includes 8. Same-profile map approvals remain valid.
The unresolved slot-score carry-over is explicitly outside this release.

API CI run `40102723467` released commit
`90c0a252c70578ecdfffd2311253df90ae4e7151`. The actual Lambda ZIP SHA-256 is
`329837834b8a9022535628f34d5c589dbde49fdedb1996b0ac245567e0498725`, matching
AWS's code hash. Eight contract/schema/service modules match tested source
byte-for-byte. All 21 real-film initial/rebuild/reparse callbacks pass the
downloaded ZIP's actual Linux dependencies and API product builders in a
network-disabled container. API health, both H1 flags and limit 16 pass.

The release bundle was copied from the exact deployed r2 image, then staged
with the validated candidate. Previous-registry and all binary audits pass.
All five supplied films and both retained real Dread films pass packaged
conversion/rebuild/reparse/retries, all 21 callbacks pass API product builders,
and the existing viewer decodes 449,561 ticks and 21 cold chunks. Native/WASM
parity remains the ten-film/3,763-hash evidence in `BETA4.md`. Tests pass:
28 Node, 62 worker Python, 1,584 API unit and 29 isolated PostgreSQL cases;
API Ruff and read-only/non-root container health also pass.

The tested local image ID was
`sha256:b460ddcfe483ee0d08950594480a2aae37fc46c69b1ab96e6fff6acec99fbfad`.
A complete packaged application-file hash comparison confirms the published
image differs only in the appended exporter-8 retention fixture (generated
Python bytecode excluded); runtime, engine, encoder and dependency files are
unchanged. API source-only ZIP packaging passes, but that ZIP omits Linux
dependencies/native extensions and must not be published as a Lambda release.

Commands run from the infra root:

```powershell
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
.\scripts\publish-h1-film.ps1 -Tag 20261024-r1 -EngineRoot L:/tmp/halospawns-h1-network-20261024/release-r1/engines -PreviousRegistry L:/tmp/halospawns-h1-network-20261024/release-r1/previous-registry.json -BuildOnly
.\scripts\publish-h1-film.ps1 -Tag 20261024-r1 -EngineRoot L:/tmp/halospawns-h1-network-20261024/release-r1/engines -PreviousRegistry L:/tmp/halospawns-h1-network-20261024/release-r1/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/map-processing' plan -no-color '-var-file=dev-map-processing.terraform.tfvars.json' '-out=L:/tmp/halospawns-h1-network-20261024/release-r1/activation/reviewed.planfile'
terraform '-chdir=components/terraform/map-processing' show -json L:/tmp/halospawns-h1-network-20261024/release-r1/activation/reviewed.planfile
terraform '-chdir=components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-network-20261024/release-r1/activation/reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Preparation baseline plans had zero resource actions, with only the unapplied
API version-output refresh from 194 to 200. After the API release and r1 pin,
focused, aggregate and saved preplans contained exactly one resource action:
the H1 image update. JSON review confirms only `image_uri` and computed
`last_modified` change. Saved plan SHA-256:
`dc6a48a2a5a58c911b1ecd660ce52c285c51979a42ea3be9c2f751ca9f5fb509`.
Renderer version drift (269 to 278) was refresh-only, not a renderer update.
The focused postplan is no-op. The full dev postplan has no resource actions;
only the API's state-only version-output refresh from 194 to 201 remains
unapplied. Existing undeclared `asset_delivery_mode` warnings remain.

The live worker is Active/Successful at the published digest. The first cold
health inventory reached its existing 20-second subprocess limit; the second
read-only health request passes all three profiles, ten explicit exporters,
source provenance and encoder hash
`7335dd63d12605c944e618c844b4688aa148a5292e03b904cf152b57182bc21e`.
All operational configuration matches the pre-apply baseline: environment,
IAM role, x86_64 architecture, memory 3,008 MiB, timeout 900 s, temporary storage
8,192 MiB, concurrency 5 and the enabled batch-1 SQS mapping. API `live=201`
and HTTPS health remain verified after activation. No health timeout or worker
limit was changed to obtain a passing result.

Account `283279960672`, profile `halospawns-dev`, region `us-east-1`, has no
session blocker. No jobs/retries, map approvals, database migrations, frontend
or prod resources were changed. Live health is not a hosted film-conversion
canary. Existing films need separately authorized full reparses to receive
these simulation fixes; never repin an existing attempt or overwrite the tag.
Retain exporter 8 and API timestamp support during rollback once their
jobs/artifacts exist.
Private evidence: `L:/tmp/halospawns-h1-network-20261024/release-r1/`.
Activation evidence is in its `activation/` directory, including the deployed
API acceptance products, reviewed plan, apply, live verification and postplans.
Coordination: `20261024-infra-api-h1film-network-exporter8`.

Implementation files changed: `profiles/registry.json`, `cloud.py`,
`tests/fixtures/retained-profiles.json`, `tests/beta4.test.mjs`,
`tests/test_cloud.py`, `tests/test_registry.py`, compatibility/deployment/Beta 4
documentation and root handoff/status logs. API changes are the exact registry,
three profile-specific default selections, the explicit batch target schema,
unit/PostgreSQL tests and release/handoff documentation. Activation changes
`stacks/dev.yaml` plus the deployment/status/handoff documentation in both repos;
no Terraform module source changes. Components: ECR image publication and the
reviewed `map-processing` image-only apply. The image was not rebuilt from newer
upstream sources or rebuilt after publication.

## Recorded UTC Support Deployed, 2026-10-23

At the user's request after their API release, verified **API live=200**, then
published and applied dev worker **20261023-r2**. Beta 4 container `created_utc`
now flows through conversion, viewer manifests, completion evidence, observed
game dates and API recording-time provenance. See
[BETA4.md](BETA4.md#recorded-utc-support-deployed-2026-10-23) for semantics and
compatibility. Zero/older timestamps remain unknown; there is no filename,
filesystem or upload-time fallback. All binary/exporter/viewer pins are unchanged.

The downloaded API ZIP SHA-256 is
`318b8f9b56a7d4ddf99a2e25ec3a5a6456ca1b98c449624a5dbee914092e7804`.
Its completion schema, ingestion normalizer, H1 contract and analytics modules
match tested source byte-for-byte. The packaged worker's initial/rebuild/reparse
callbacks also pass the actual deployed API's Linux dependencies and pure
builders offline. HTTPS health passes; both H1 flags and limit 16 remain intact.
No direct API or alias write was performed.

Immutable ECR manifest digest:
`sha256:c1709ce2b3deee718afca2be5564beebf4133bdf372c5d1a62ab97855c5519a4`
(376,180,194 compressed bytes). Tested and published local image ID:
`sha256:78f78c578db61cf7c1ead3ca44d8954f51771ab4bd9f4f0fb669bd64076b8b8c`.
The engine bundle is unchanged from `L:/tmp/halospawns-h1-bots-20261023/engines`;
the previous registry snapshot and all release evidence are under
`L:/tmp/halospawns-h1-utc-20261023/release-r2/`.

Exact release commands from the infra root:

```powershell
.\scripts\publish-h1-film.ps1 -Tag 20261023-r2 `
  -EngineRoot L:/tmp/halospawns-h1-bots-20261023/engines `
  -PreviousRegistry L:/tmp/halospawns-h1-utc-20261023/release-r2/previous-registry.json -BuildOnly
.\scripts\publish-h1-film.ps1 -Tag 20261023-r2 `
  -EngineRoot L:/tmp/halospawns-h1-bots-20261023/engines `
  -PreviousRegistry L:/tmp/halospawns-h1-utc-20261023/release-r2/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/map-processing' plan '-no-color' '-var-file=dev-map-processing.terraform.tfvars.json' '-out=L:/tmp/halospawns-h1-utc-20261023/release-r2/reviewed.planfile'
terraform '-chdir=components/terraform/map-processing' show -json L:/tmp/halospawns-h1-utc-20261023/release-r2/reviewed.planfile
terraform '-chdir=components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-utc-20261023/release-r2/reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Focused, aggregate and saved preplans contain one resource action: the H1 image
update in place. JSON review confirms only `image_uri` and computed
`last_modified` change; apply completes **0 added / 1 changed / 0 destroyed**.
Saved plan SHA-256:
`182311329b2e261ee63d38c071e6f28415870b10a728f61ef9ca96aa2ea3611d`.
Renderer version drift (267 to 269) is refresh-only, not a renderer update.
The aggregate preplan also observes the API's state-only version-output change
from 194 to 200; no API resource action or separate component apply is needed.
The focused postplan is no-op. The full dev postplan has no resource actions:
only that same unapplied API version-output refresh remains; all other
components are no-op. Existing undeclared `asset_delivery_mode` warnings
remain. Dev profile `halospawns-dev`, account `283279960672`,
`us-east-1`, has no session blocker.

The worker is Active/Successful at the published digest. The first live health
request verifies all three profiles, nine explicit exporters and the unchanged
encoder hash `7335dd63d12605c944e618c844b4688aa148a5292e03b904cf152b57182bc21e`.
Environment hash, IAM role, architecture, memory 3,008 MiB, timeout 900 s,
temporary storage 8,192 MiB, concurrency 5 and enabled batch-1 SQS mapping
match the pre-apply baseline. Existing intake gates and limits are unchanged.
This is live health verification, not a hosted timestamp conversion canary.

The actual release image (no worker/runtime source overrides) passes the real
eight-participant film's initial conversion, viewer rebuild, full reparse and
three identical retry callbacks with networking disabled. All 645 source hashes,
API products (681 spatial events), 77,354 browser-decoded ticks and three cold
chunks pass. UTC is `2026-10-22T23:19:56Z`; compressed replay chunks remain
byte-identical to r1. Read-only/non-root container gates and all 28 Node / 61
worker Python tests pass again. Offline timings are not Lambda throughput claims.

No upload/retry, backfill, map approval, database migration, frontend deployment
or prod action was performed. The only infrastructure configuration change is
`stacks/dev.yaml` in `map-processing`. Do not overwrite `20261023-r2`; retain
exporter 7 / viewer 5 and API timestamp parsing during rollback.
Existing completed films need separately requested full reparses to populate
game dates; saved callbacks and old attempt pins remain immutable. API rollback
must keep the optional timestamp contract once its completions exist.

Validation commands, from their respective repositories:

- Infra: `node --test lambda/h1_film/tests/*.test.mjs` (28 passed) and
  `.venv/Scripts/python.exe -m unittest discover -s lambda/h1_film/tests -p 'test_*.py'`
  (61 passed).
- API: `.venv/Scripts/python.exe -m pytest tests/unit -q` (1,578 passed).
  With `HALOSPAWNS_TEST_POSTGRES=1`, the H1 PostgreSQL suite filtered by
  `-k 'recorded_utc or reprocess_fences_pin_and_viewer_projection'` passed the
  22 existing reparse cases; after correcting new test fixtures, the focused
  `-k 'recorded_utc or beta4-utc' --tb=short` run passed all three new cases.
  Ruff on the four modified API modules and the two modified/new test files
  passes; the worker completion JSON schema equals the generated API schema.
- API: `scripts/build-lambda.ps1 -SkipDependencyInstall -OutputPath L:/tmp/halospawns-h1-utc-20261023/api-source-only.zip`
  passes. This source-only ZIP is not a publishable Linux/native release.
- Viewer workspace: `node node_modules/vitest/vitest.mjs run src/tests/analyticsAvailability.test.js`
  (nine passed). Direct installed Vitest avoids the local pnpm invocation's
  attempted production dependency refresh; dependencies were not changed.
- The network-disabled local worker harness, real API product validation and
  full browser decode are recorded in `L:/tmp/halospawns-h1-utc-20261023/`.
  Browser validation additionally proves identical compressed replay chunks
  against the prior artifact. No frontend application code or build changed.

Release evidence in `release-r2/`: `image-build.log`, `publish.log`,
`published-image.json`, `cloud/`, `cloud.log`, `api-products.json`, `viewer.json`,
test logs, `api-live-200-verification.json`, `map-plan.log`, `full-plan.log`,
`reviewed-plan.log`, `reviewed-plan-summary.json`, `reviewed.planfile`,
`apply.log`, `post-map-plan.log`, `post-full-plan.log`, `worker-before.json`,
`worker-deployed-verification.json` and `worker-health-verified.json`.

## Bot Replay Support Deployed, 2026-10-23 UTC

The user released the API and explicitly authorized image publication and the
dev worker apply. Dev now runs **20261023-r1** with API **live=195**. New Beta 4
uploads and omitted admin full-reparse requests automatically select exporter
7 / analytics 4 / viewer 5. Existing approvals for unchanged maps under the
same simulation profile remain valid; no new engine approval is required.
No upload/retry, map approval, migration, frontend deployment or prod action
was performed. Failed upload `3ac851bd-1281-4539-95d3-f6f947b6fb3b` is untouched.

Published immutable ECR manifest digest:
`sha256:a2c440a86ac32287818de0904c58c15489b1afc80bcebadb284ddcd415fa2b14`
(376,179,569 compressed bytes). Published local image ID:
`sha256:478d9a08e2a6477bcddb90f923834b6f1d54f864721826046e6fe6838bc52bb8`.
The release adds exporter 7 to the append-only retention fixture; runtime,
engine and encoder bytes remain those validated in the local candidate.

The original tested local candidate image ID was
`sha256:95e0aae768736b51fd5bd25e11350b81322b872a20c7227d71eb7a53cef2c44f`.
This is a local image ID, not an ECR manifest digest. The retained private
engine bundle is `L:/tmp/halospawns-h1-bots-20261023/engines`; its prior-release
registry is alongside it as `previous-registry.json`. The image contains
exporter 7 with WASM SHA-256
`14d516e3f8c48968f43800c115dbc995d8c03a722f4901e1ddd23fc9fb136f95`,
unchanged Beta 4 glue and all prior binary pins. Exact parity and packaged
validation results are in [BETA4.md](BETA4.md#bot-replay-support-2026-10-23-utc).

The downloaded API `live=195` ZIP has SHA-256
`8e7d23689913a39d94423aff232383dde7d91d4704d19e535e90fe5a8b4f6a97`.
Its contract, intake, admin defaults, batch inventory and batch schema modules
match the tested source byte-for-byte. HTTPS health passes; both H1 flags
remain true and the participant limit stays 16. The API was released through
the user's normal pipeline; this rollout made no direct API or alias write.

Exact release commands from the infra root:

```powershell
.\scripts\publish-h1-film.ps1 -Tag 20261023-r1 `
  -EngineRoot L:/tmp/halospawns-h1-bots-20261023/engines `
  -PreviousRegistry L:/tmp/halospawns-h1-bots-20261023/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/map-processing' plan '-no-color' '-var-file=dev-map-processing.terraform.tfvars.json' '-out=L:/tmp/halospawns-h1-bots-20261023/reviewed.planfile'
terraform '-chdir=components/terraform/map-processing' show -json L:/tmp/halospawns-h1-bots-20261023/reviewed.planfile
terraform '-chdir=components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-bots-20261023/reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Focused, aggregate and saved plans contain one resource action: the H1 image
URI update in place, plus its tag/digest outputs. The JSON review checks that
only `image_uri` and computed `last_modified` change. Apply completes with
**0 added / 1 changed / 0 destroyed**. Existing renderer version drift is
refresh-only, not a renderer update. The aggregate plan also observes API
output `app_lambda_function_version` advancing from 194 to 195; no API
resource action is needed and its state-only output refresh was not applied.

The focused postplan is no-op. The full dev postplan has no resource actions:
all components are no-op except that same API version-output refresh. No
additional component apply is needed for bot support.

The worker is Active/Successful at the exact published digest. Its first live
health request passes all three profile hashes, all nine explicit exporter
hashes and the tested encoder hash
`7335dd63d12605c944e618c844b4688aa148a5292e03b904cf152b57182bc21e`.
Memory 3,008 MiB, timeout 900 s, temporary storage 8,192 MiB, concurrency 5,
enabled batch-1 SQS mapping, intake mode and limits 512 MiB / 432,000 ticks /
16 participants are unchanged. This is health verification, not a hosted bot
conversion or Lambda throughput measurement. Retention/container checks and
all 27 Node tests pass for the release.

Do not overwrite `20261023-r1`. Rollback must retain exporter 7 and viewer 5
once their jobs/artifacts exist; existing attempts must never be repinned.

Commands run locally:

```powershell
.\lambda\h1_film\tools\build-engine.ps1 -Port beta4 -Combat `
  -Source L:/tmp/halospawns-beta4-e78e4daa/src `
  -BuildDirectory L:/tmp/halospawns-h1-bots-20261023/wasm-r1
node lambda/h1_film/tools/verify-native-parity.mjs `
  --native L:/tmp/halospawns-h1-16-players-20261022/native/engine/Release/h1-film-export.exe `
  --engine L:/tmp/halospawns-h1-bots-20261023/wasm-r1/h1-film.js `
  --assets 'L:/bens_stuff/xbox mod/Games/H1PB Beta 4' `
  --output L:/tmp/halospawns-h1-bots-20261023/parity-r1 `
  'L:/bens_stuff/xbox mod/Games/H1PB Beta 4/films/2026-10-22 19-19-56 dread.h1film' `
  L:/tmp/halospawns-h1-bots-20261023/fixtures/one-bot-ffa/input.h1film `
  L:/tmp/halospawns-h1-bots-20261023/fixtures/eleven-bots-ffa/input.h1film `
  L:/tmp/halospawns-h1-bots-20261023/fixtures/eight-bots-teams/input.h1film `
  'L:/bens_stuff/xbox mod/Games/H1PB Beta 4/films/2026-10-22 18-15-33 dread.h1film'
.\scripts\publish-h1-film.ps1 -Tag 20261023-r1 `
  -EngineRoot L:/tmp/halospawns-h1-bots-20261023/engines `
  -PreviousRegistry L:/tmp/halospawns-h1-bots-20261023/previous-registry.json -BuildOnly
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Before publication, the initial focused/aggregate plans stopped at
`data.aws_ecr_image.h1_film` because the candidate tag was absent; the other
five components were no-op at that time. Publication resolved that blocker.
Existing undeclared `asset_delivery_mode` warnings remain. Dev profile
`halospawns-dev` in account `283279960672`, `us-east-1`, has no session blocker.

Evidence/logs live under `L:/tmp/halospawns-h1-bots-20261023/`: `parity-r1/`,
`cloud-r1/`, `cloud-network/`, `api-products.json`, `viewer.json`, test logs,
`image-build-r1.log`, initial `map-plan.log` and `full-plan.log`, `publish.log`,
`published-*-plan.log`, `reviewed-plan.log`, `reviewed-plan-summary.json`,
`reviewed.planfile`, `apply.log`, `post-*-plan.log`,
`worker-deployed-verification.json`, `worker-health-verified.json` and
`api-live-195-verification.json`. The release container's
read-only/non-root health check passes. The sibling API's IDE module is not
attached, so API validation uses its documented Python 3.12 `.venv`.
The API source-only packaging check also passes (`scripts/build-lambda.ps1
-SkipDependencyInstall -OutputPath L:/tmp/halospawns-h1-bots-20261023/api-source-only.zip`).
That ZIP omits dependencies/native extensions and is not a deployment artifact;
use the normal API release pipeline. Both repositories pass whitespace checks
and focused Ruff checks.

Changed implementation files are the Beta 4 `wasm/bot-replay.c`,
`wasm/headless-extra.c`, `wasm/CMakeLists.txt`, the Beta 4 reader,
`runtime/convert.mjs`, `profiles/registry.json`, `cloud.py` and their tests;
the only infrastructure configuration change is `stacks/dev.yaml` in
`map-processing`. API changes are `h1film_contract.py`,
`schemas/h1film_reparse.py`, `services/h1films.py`,
`services/admin_replay_reprocess.py`, `services/h1film_reparse.py` and unit/
PostgreSQL tests. Compatibility/deployment documentation and both repositories'
handoffs/roadmaps record the completed dev releases. Exporter 7 is now also
required by `tests/fixtures/retained-profiles.json`.

## API Sixteen-Player Limit Enabled 2026-10-22

At the user's request after their API release, verified dev API `live=193`
and `$LATEST` have identical code SHA-256, downloaded the deployed ZIP and
verified its digest, and compared the relevant configuration, H1 profile,
participant/native/combat/ingest/target modules plus all revision-5 contracts
and the registry against the tested checkout. ZIP SHA-256:
`59c6ef2bae2f1af36ca6155afa1af8ca3da2a7a71877253353a0ae5400fded68`.

Applied only the reviewed `app-api` plan: **1 added / 3 changed / 1 destroyed**.
The replacement is the configuration-promotion invocation record, not an API
Lambda or data store. Changes are `H1FILM_MAX_PLAYERS` 4 to 16, its contract
data, the updater's expected configuration hash and the normal guarded alias
promotion. The API is now **live=194**, Active/Successful, with the exact same
code hash, limit 16 and both existing H1 flags still true. HTTPS `GET /health`
returns 200/ok. Worker `20261022-r2` and its limit 16 are unchanged.

Saved plan SHA-256:
`b0398fe5ad7342f956b3a3bf632e5531459d3e44ed03ab19716664e6df168e76`.
Configuration hash:
`79b4ab455fc440b28f382f5eaf2778d436cf736dd98d115be790b1ed5ad57c50`.
The full preplan contains only the same app-api actions; all other components
are no-op. Focused and full dev postplans are no-op (all six dev components).
Existing undeclared
`asset_delivery_mode` warnings are unrelated. No AWS/profile/session blocker
(`halospawns-dev`, `283279960672`, `us-east-1`).

Frontend is deliberately **not deployed**: the user will test it locally
against dev before releasing it. This does not require another coordinated
backend release. Profile-specific map review and actual upload/playback
acceptance remain separate; this apply does not approve maps, retry the failed
upload, submit jobs, change the worker, migrate a database or touch prod.

Exact commands from the infra root:

```powershell
.\scripts\plan.ps1 dev app-api
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/app-api' plan '-no-color' '-var-file=dev-app-api.terraform.tfvars.json' '-out=L:/tmp/halospawns-h1-16-players-20261022/api-limit-release/reviewed.planfile'
terraform '-chdir=components/terraform/app-api' apply -no-color L:/tmp/halospawns-h1-16-players-20261022/api-limit-release/reviewed.planfile
.\scripts\plan.ps1 dev app-api
.\scripts\plan.ps1 dev
```

Evidence/logs: `L:/tmp/halospawns-h1-16-players-20261022/api-limit-release/`.
No Terraform/application source changes were needed in this follow-up; the
previously prepared `stacks/dev.yaml` and app-api contract were applied.
Documentation updated: this file, H1 README/BETA4, root AGENTS/HANDOFFS/migration
log, and API HANDOFFS/ROADMAP/pose-contract release status. The earlier sections
record historical prerequisites; this section supersedes their pending API step.

## Beta 4 / Sixteen Participants Deployed 2026-10-22

The user authorized the dev worker release independently of their API release.
`halospawns-h1-film-dev` now pins **20261022-r2**, Active/Successful, with
`H1_MAX_PLAYERS=16`. ECR digest:
`sha256:ba537f69bc040ead2f16e6ce80f4a6757780f16801e75f7cd9fb377a5d1c45aa`.
Tested/published image ID:
`sha256:58b3755e4da84677b16621f4c87438ace788777c13690f9a5d11db49e71c8b2f`.
Packaged encoder SHA-256:
`7335dd63d12605c944e618c844b4688aa148a5292e03b904cf152b57182bc21e`.

The full bundle adds Beta 4 exporter 6 / analytics 4 / viewer 5, remote-player
replay, stable distinct identities through physical slot reuse, sixteen-player
analytics/pose support and append-only viewer contracts. All three profiles,
eight explicit exporters and old pins are retained. The retention audit uses
the actual previous deployed registry; its new Beta 4 entries were appended
to the repository retention floor after release. Exact limits and simulation
evidence are in [BETA4.md](BETA4.md).

The supplied Dread film passes all 195 recorded hashes and full native/WASM
byte parity. Final read-only/non-root/network-disabled packaged initial,
viewer-rebuild, full-reparse and pinned-retry checks pass. Actual frontend
decoding retains eight distinct participants/seven concurrent players, all
23,345 ticks and three cold chunks. Sixteen-player synthetic/DB boundaries
pass; this is not a sixteen-concurrent or maximum-size performance claim.
Worker tests: 57 Python, 26 Node, 94 encoder/one ignored and seven pose-codec.
API: 1,501 unit and seven isolated PostgreSQL tests; Ruff and source-only ZIP
packaging pass (that ZIP is not publishable). Viewer: 1,574 tests; standalone
and site builds pass with existing bundle-size warnings. Retained Beta 3 and
prerelease films preserve all 42 chunk descriptors/hashes, native analytics
and final counters.

### Applied Scope and Remaining Release Steps

Only `map-processing` was applied: **0 added / 1 changed / 0 destroyed**,
changing the H1 image digest and `H1_MAX_PLAYERS` from 4 to 16. The reviewed
saved plan SHA-256 is
`41c7a5f35528f04f70bf588278a82cf8a36b9647f75101c07ce79e59ff485eed`.
Memory 3,008 MiB, timeout 900 seconds, reserved concurrency 5 and the enabled
batch-one films SQS mapping remain unchanged. ECR received one immutable
image; no queue message, upload retry, map approval or prod action occurred.
Processing queue and DLQ both have zero visible/in-flight messages afterward.

The initial Lambda health-only invocation hit its existing 20-second child
timeout during cold startup; a repeat succeeds with all three profiles/eight
exporters and the exact encoder hash. No film was submitted to probe health.
Focused postplan is no-op. Full dev plans leave only the intentional `app-api`
configuration pending: **1 add / 3 updates / 1 destroy**, for configuration-
promotion invocation replacement, contract data, API player-limit env and
code-updater expected hash. Other components have no resource changes.
The pre-existing map-renderer version drift (264 to 266) is refresh-only, not
a planned deployment. Existing undeclared `asset_delivery_mode` warnings remain.
No AWS/profile/session blocker: `halospawns-dev`, `283279960672`, `us-east-1`.

**Do not apply `app-api` before the user releases compatible API code.**
Observed live API remains version **192**, `H1FILM_MAX_PLAYERS=4`; its old
configuration validator rejects 16. API changes and frontend revision-5
support are ready in their sibling checkouts but neither was deployed here.
After the user's API release, review/apply `app-api` to activate 16; release
the frontend, review Dread specifically for the Beta 4 profile, then authorize
recovery/hosted acceptance separately. No approval inheritance is implied.
Upload `d695cd7c-4a17-42b6-8e65-27e9d5b016a9` was not retried.

Exact infra commands from the repository root (private evidence/logs under
`L:/tmp/halospawns-h1-16-players-20261022/`):

```powershell
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev app-api
.\scripts\publish-h1-film.ps1 -Tag 20261022-r2 -EngineRoot L:/tmp/halospawns-h1-16-players-20261022/engines -PreviousRegistry L:/tmp/halospawns-h1-16-players-20261022/previous-registry.json -BuildOnly
.\scripts\publish-h1-film.ps1 -Tag 20261022-r2 -EngineRoot L:/tmp/halospawns-h1-16-players-20261022/engines -PreviousRegistry L:/tmp/halospawns-h1-16-players-20261022/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/map-processing' plan '-no-color' '-var-file=dev-map-processing.terraform.tfvars.json' '-out=L:/tmp/halospawns-h1-16-players-20261022/reviewed.planfile'
terraform '-chdir=components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-16-players-20261022/reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Before the release pin, focused worker plan was 0/1/0 (limit only); API plan
was 1/3/1 and remains unapplied. Release worker plan was 0/1/0 (image and
limit). The first saved-plan command had unquoted PowerShell option values
and exited with an argument error before planning; the quoted command above
succeeded and its parsed plan was checked for exactly the two intended changes.
Terraform formatting and all three repositories' whitespace checks pass.

Infra files changed: `stacks/dev.yaml`,
`components/terraform/map-processing/h1-film.tf`,
`components/terraform/app-api/h1-film.tf`,
`scripts/verify-h1-film-foundation.ps1`; H1 engine/adapters/registry, encoder,
pose codec, Python validator/analytics/cloud code, contract snapshots and tests;
shared replay-parser viewer contracts/validation/finalization; H1 docs and root
AGENTS/HANDOFFS/migration log. API changes include profile/target registration,
limits/DTOs/ingest/reparse, contract copies and tests/docs. Svelte changes include
contract copies, pose/range/cold-chunk decoding, tests and handoff/audit docs.

## Authorized nine-job recovery, 2026-10-22

The user authorized recovery of exactly the nine original failed attempts, not
new upgrades for the ten never-submitted films. Before writes, verified dev
account `283279960672`, region `us-east-1`, actual API `live=192` ZIP SHA-256
and combat-validator source, worker digest `c0cb36ef4792ddf8e29d6748b4422783ec45e35e0e13a9f768f2bc3320cf1abb`,
enabled batch-one mapping, empty processing queue and nine DLQ messages.

At 12:29:25-27 UTC, bounded `ReceiveMessage` calls held exactly nine messages.
Validated each original SQS message ID against DB dispatch evidence, full job
schema, attempt/replay/upload/game/generation IDs, unchanged conversion identity,
5/4/4 pins and current epoch 0 / sequence 3. DB connections were read-only.
Targeted `SendMessage` calls copied the original bodies and attributes unchanged
to `films-processing-queue`, with SDK send retries disabled. Each matching MD5
acknowledgement preceded `DeleteMessage` of its DLQ copy. Nine sends and nine
deletions were confirmed. No queue-wide redrive, new attempt, direct DB repair,
repinning, visibility-policy change, deployment, Terraform or prod action.

All nine original attempts succeeded and activated; verification at 12:32:24 UTC
matched selected viewer and statistics generations, exact registered pins,
request fences and native/scoreboard/graph/occupancy logical product hashes:

| Original attempt | Replay |
| --- | --- |
| `13ec7436-30e1-4ded-abab-cac77b60bfd5` | `b4280542-0088-4f5c-a912-08a0ffb6d6bd` |
| `1e9ac5e5-ffb4-4786-8d72-df748bbef731` | `68127d50-959b-4b11-b3ff-9db32d99420e` |
| `20dcde23-ec6a-41d1-8c9e-65a33e44f62d` | `bb3c3963-5064-4c31-9415-1144d47f7cd1` |
| `31d39b8f-a63c-4092-ae2e-18121f6f213f` | `94df2008-1118-43eb-a83a-47b9d962ab40` |
| `84d018fb-f665-48cd-bf62-292844818558` | `7042222a-99e0-4db7-99e4-e84d1d0bd44b` |
| `c19758ff-7376-4b2b-ae33-8bc5422f1972` | `733a6352-ec10-469c-9346-3a95db5318b2` |
| `cbe0678c-95f4-4ece-bb88-8ba76fabf21f` | `e3d22c65-33aa-4733-8b04-b27579352eee` |
| `e24d3b6b-33e8-445f-bd90-fac118cc4c4e` | `84e16ec5-a556-43b7-b840-6fa906b0d02a` |
| `e2c47e71-b3c0-4b80-9193-9def479bae20` | `6bbc40b5-b1e2-4023-892d-0200cee6af64` |

Inventory has 22 current exporter-5 selections: 21 provenance-verified upgrades
plus the historical canary without a generation receipt. Zero active DB attempts
remain; the ten exporter-2 films were not submitted. Frontend recovery fixes are
local in the Svelte repo, with 544 passing site tests and successful builds;
release still belongs to the frontend workflow.

### Outstanding acknowledgement, not a failed upgrade

Eight callbacks returned 201 in 15-18 seconds and logged worker completion.
Attempt `13ec7436-30e1-4ded-abab-cac77b60bfd5` committed at 12:31:01.876 UTC,
but API request `712d22f3-2628-4189-a9d8-423b17d9225c` timed out at 12:31:31.245
after 30,000 ms. The worker returned retryable `retry_pending` at 12:31:31.251.
Its selected generation and all four product hashes are nevertheless verified.
DLQ is empty; processing has one in-flight delivery, message
`728ad1d0-1c00-4909-b346-4359fc938a97`. Leave it for normal idempotent completion
retry after the existing 5,400-second visibility window, approximately 13:59 UTC.
Do not create a new attempt, resend its payload, purge the queue or change queue
visibility globally. Confirm acknowledgement after redelivery and investigate
API post-commit response latency through the owning API handoff.

## Suicide validation correction deployed 2026-10-22

Dev worker `20261022-r1` is Active/Successful (originally published as
`combat-suicide-20261022-r1`; see the naming update below). The user explicitly
authorized deployment before their API release; API `live=191` was observed and
was not changed. The matching API validator, regression tests and documentation
are ready in the sibling checkout. No migration, new job, retry/redrive, map
approval or prod operation was performed. Nine prior failed attempts remain in
the DLQ; the processing queue is empty.

- ECR digest:
  `sha256:c0cb36ef4792ddf8e29d6748b4422783ec45e35e0e13a9f768f2bc3320cf1abb`.
- Tested/published image ID:
  `sha256:8fe2fff46fd3032d8cb1b037040b7fa46ee1106176df201fb41f56c00d4ba361`.
- Built from the previous immutable deployed digest
  `sha256:7076d78804c975fa9d3015e7bfe655da39a4f04b2d44c1a945da4ec9815ab792`,
  replacing only `/var/task/h1_film/combat.py`. All other 2,741 application files
  match by SHA-256; every old engine/exporter and the encoder remain exact.
  Pending local Beta 4 changes are not deployed. The normal full-build publisher
  was intentionally not used for this isolated patch; the private evidence
  directory retains its Dockerfile and account/immutability/image-ID-guarded
  publisher. This is a normal immutable ECR image pinned/applied by Terraform.
- Worker full Python suite: 56 passed. Packaged combat regressions: 12 passed.
  All 32 LAN films pass packaged initial/rebuild/reparse/pinned-retry validation
  with network disabled: 3,373,727 source ticks and 28,127 recorded hash checks.
  All 96 callbacks pass the patched API's normalizer or viewer-completion DTO.
  For the nine original failures, canonical viewer bytes, native combat, final
  counters and decoded spatial products match the prior image's local outputs.
- API combat/H1 ingest/reparse tests: 99 passed, two optional legacy private-
  corpus cases skipped. Six final PostgreSQL persistence cases also pass.
  Ruff and source-only Lambda packaging pass; the local ZIP is not publishable.
- Read-only/non-root container health/rejection and engine retention audit pass.
  Live health also passes with both retained profiles, six explicit exporters
  and the unchanged encoder hash. No cold-start timeout occurred in this check.
  Memory 3,008 MiB, timeout 900 s, concurrency 5 and queue wiring stay unchanged.

Baseline focused plan is no-op. Focused and full preplans contain **0 adds /
1 update / 0 destroys**, solely `aws_lambda_function.h1_film[0].image_uri` and
computed `last_modified`. Full preplan also has the pre-existing, unapplied API
output refresh `173 -> 191`. Applied the reviewed focused saved plan, SHA-256
`44a0f80f9b2b6bcb4422ff3625400adc1021a4ae1084c6715001617b050f4148`.
Only `map-processing` resources changed; ECR received one immutable image.
Apply completed with 0 added / 1 changed / 0 destroyed; focused postplan is no-op.
Final full dev postplan has zero resource actions; only the existing API output
refresh `173 -> 191` remains unapplied. Existing undeclared `asset_delivery_mode`
warnings are unrelated. Final live checks retain concurrency 5, enabled batch-one
mapping, zero processing-queue messages and nine DLQ messages.
No AWS/profile/session blocker (`halospawns-dev`, `283279960672`, `us-east-1`).

Exact release commands from the infra root (logs retained beside the plan):

```powershell
.\scripts\plan.ps1 dev map-processing
docker buildx build --platform linux/amd64 --provenance=false --load -f L:/tmp/halospawns-h1-suicide-fix-20261022/Dockerfile -t halospawns-h1-film:combat-suicide-20261022-r1 L:/tmp/halospawns-h1-suicide-fix-20261022
& L:/tmp/halospawns-h1-suicide-fix-20261022/publish.ps1
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-suicide-fix-20261022/reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Changed infra files: `lambda/h1_film/combat.py`,
`lambda/h1_film/tests/test_combat.py`, `stacks/dev.yaml`, H1 README/combat/deployment
docs and root AGENTS/HANDOFFS/migration log. API changes: combat service,
unit/PostgreSQL tests, combat semantics docs, HANDOFFS and ROADMAP.
Investigation and semantics: [COMBAT_ANALYTICS.md](COMBAT_ANALYTICS.md).
Private evidence: `L:/tmp/halospawns-h1-suicide-fix-20261022/`.

## Neutral release naming adopted 2026-10-22

At the user's request, new H1 image releases use `YYYYMMDD-rN`: UTC release
date and a positive daily sequence starting at 1. No content description is
included. The publisher enforces the format and calendar date; release notes
carry the description. Existing tags remain immutable and available for rollback.

Added ECR tag `20261022-r1` to the exact manifest originally published as
`combat-suicide-20261022-r1`, retaining both tags at digest
`sha256:c0cb36ef4792ddf8e29d6748b4422783ec45e35e0e13a9f768f2bc3320cf1abb`.
Updated the dev stack pin and current references in infra/API handoff docs.
No rebuild, Lambda update, API deployment, job action or prod change occurred.
Live Lambda remains Active/Successful with its original `LastModified`
`2026-10-22T11:46:25.000+0000` and identical resolved image digest.

Baseline focused plan is no-op. Focused and full preplans have zero resource
actions; only `map-processing.h1_film_foundation.image_tag` changes for this
task. The full plan also reports the existing, unapplied API output refresh
`173 -> 191`. Applied the reviewed focused saved plan (SHA-256
`182e6a8c1b6bdbfd624f0c87488df339c22ae3d82875fcb4618a7d81f469e878`):
0 added / 0 changed / 0 destroyed. Focused postplan is no-op. Publisher syntax
and parameter validation pass four valid and eleven invalid cases. No AWS/profile
blocker; existing undeclared `asset_delivery_mode` warnings are unrelated.

Exact commands from the infra root, in execution order:

```powershell
.\scripts\plan.ps1 dev map-processing
& L:/tmp/halospawns-h1-release-naming-20261022/retag.ps1
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
& L:/tmp/halospawns-h1-release-naming-20261022/validate-publisher.ps1
terraform '-chdir=components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-release-naming-20261022/reviewed.planfile
.\scripts\plan.ps1 dev map-processing
```

Changed files: `scripts/publish-h1-film.ps1`, `stacks/dev.yaml`, H1 README,
COMBAT_ANALYTICS and DEPLOYMENT docs, root AGENTS/HANDOFFS/migration log, and
sibling API HANDOFFS/ROADMAP current release pointers. Component:
`map-processing` (output only); ECR received an additional immutable tag, with
no repository configuration change. Logs, guarded retag script, saved plan,
manifest and verification evidence: `L:/tmp/halospawns-h1-release-naming-20261022/`.

## Previous rollout status, 2026-10-20

Status on 2026-10-20: dev new intake selects exporter 5 / analytics 4, retaining
bounded pose compression, viewer revision 4 / `HSRDC002`. Worker
`combat-20261020-r1` and API `live=188` are deployed; compatible frontend viewer
readers are unchanged. Both Beta 3 and commit-pinned h1arena exporter-5 records
are registered. Profile-specific h1arena raw-map approvals and hosted acceptance
remain required. Admin reprocess defaults remain exporter 4 / analytics 3;
explicit exporter 5 / analytics 4 is supported and a fenced canary passes.
New conversions retain typed transport, incremental world-object state and
typed poses. Exporters 1/2/3/4/5 remain available;
persisted jobs/retries retain their original pins and paths.
Both H1 flags remain true, the batch-one queue remains enabled, and reserved
concurrency remains 5. All 32 frozen dev H1 replays succeeded and selected the
new format. Source/map pins and old explicit jobs/retries are retained.
Existing Xbox consumers and prod are unchanged. Combat bulk backfill and admin
default coordination remain. This is not full semantic parity; broader map
approval and unrelated parity work remain open.

Active code has since been organized under `lambda/h1_film`; experiments retain
only reference/benchmark tooling and historical notes. See [README.md](README.md)
for the current entry points and [COMPATIBILITY.md](COMPATIBILITY.md) for retained
engine bundles, source-isolated builds and append-only profile registration.

The runtime candidate deployed on 2026-10-11 was measured offline: nine-map
conversion time fell 17.84%, whole harness time 15.89%, with byte-identical
replays. This is not the requested 3x speedup or a Lambda latency measurement.
It added retained exporter 3, selected by new intake and admin jobs at that release.
Existing conversions, jobs, retries and artifacts retain their original pins.
Completed coordination: `20261011-infra-api-h1film-runtime-exporter3`; see
[the performance report](PERFORMANCE.md#runtime-candidate-2026-10-11).

## Combat Analytics Activated 2026-10-20

Completed the user-authorized dev activation after checking the actual deployed
API, not merely the sibling checkout. API **`live=188`** ZIP SHA-256
`272ffeeb6da9321bb006e704f4a2b663c269f927d709ed96689d3f449e97ad6c`
matches Lambda and registers every retained pin, including exporter 5 for both
profiles. Analytics 4/native-v2 ingest and public-read code are present; admin
defaults deliberately remain analytics 3 / exporter 4. No API code/alias write
was made by this deployment.

- Worker **`combat-20261020-r1`**, digest
  `sha256:7076d78804c975fa9d3015e7bfe655da39a4f04b2d44c1a945da4ec9815ab792`,
  is Active/Successful. New intake requests analytics 4 / exporter 5; explicit
  persisted jobs/retries retain their pins.
- Published image ID
  `sha256:5d1262883ccfb6204dbcf4f3a8cac849951150a6972e6be4b2edcffc1df40ca0`
  exactly matches the tested candidate. Linux encoder SHA-256:
  `424ae80f779a63d0b3b7bb252fab106acd1e04007e677514d353aa23cf2ab495`.
  Retention is checked against the registry extracted from the preceding
  deployed digest. The release fixture adds both new exporter records.
- Revision-4 analytics now retains departed and between-sample participants'
  observed identities/counters in its final sidecar roster, without fabricated
  positions. This fixes the h1arena normalizer rejection without discarding
  native data, changing old revisions or weakening API checks.
- 51 Python, 22 Node and 93 Rust tests pass; one existing optional Rust test is
  ignored. Both profiles pass packaged initial/rebuild/reparse/pinned-retry
  checks and the actual deployed API's unmodified normalizer/graph/spatial
  builders. Read-only, non-root container health/rejection checks pass.

Baseline plan and focused postplan are no-op. Focused/full preplans and apply
contain **0 adds / 1 update / 0 destroys**, only H1 `image_uri` and computed
`last_modified`. Reviewed saved-plan SHA-256:
`2b336d856634d832d74f7c213cd252b1e4f4e9d940cf516800fb2ee4d45c8713`.
The full postplan has zero resource actions; only the existing API output
refresh `173 -> 188` remains unapplied. Existing undeclared
`asset_delivery_mode` warnings are unrelated.

Live exact encoder/all-engine inventories pass twice after two cold inventory
requests hit the unchanged 20-second child timeout. Successful inventory Lambda
durations were 17.898 s and 0.848 s. No timeout, memory, concurrency, queue,
IAM or other consumer changes were made.

One audited full-reparse canary succeeded and selected its matching generation:
replay `55dd6401-0314-4fe8-a896-56f1af8a6dc0`, attempt
`c0dc5574-bfdc-5129-b4cc-fb1d73047470`, epoch 0 / request sequence 3.
The dev AWS-SSO operator request uses the deployed API's attempt/selection
contracts and normal SQS dispatcher; the worker finalized through the real
HMAC API. No direct selected-artifact mutation or fabricated admin JWT was used.
All 589 recorded hashes pass over 70,582 ticks. Native-v2 matches the offline
product exactly: 77 deaths, 16 shot rows, 37 damage pairs, all four sections
complete. Public service code returns 77 located death/killer positions and
consistent weapon-filtered heatmaps. Scoreboard, graph series, native timelines,
variant, EVT1, decoded occupancy and all viewer bytes are unchanged. Viewer hash:
`7eae439f2e13c7b29ee0992733bcf70e52b314740e6b06ab8454b9def5153dc0`.
The packaged independent decoder validates all 70,582 downloaded viewer ticks.
Public read verification executes deployed API service methods against dev data;
it is not a new HTTP/browser acceptance test.

CloudWatch canary invocation: **55.808 s / 795 MiB**, with worker processing
51.744 s. This is one observation, not a stress test or controlled speed comparison.
Old generations/source/map pins and all other 31 selected replays are unchanged.
No bulk backfill, map approval, h1arena hosted conversion, migration, frontend,
commit/push or prod action. Admin-default promotion remains API-owned; existing
replays need explicit 4/5 full-reparse requests or a separately audited backfill.
Keep exporter-5/native-v2 support during rollback.

Memory 3,008 MiB, timeout 900 s, temporary storage 8,192 MiB, concurrency 5,
enabled batch-one mapping, both H1 flags and existing limits remain unchanged.
Final API health passes; the films queue and DLQ are empty.
No AWS/profile/session blocker (`halospawns-dev`, `283279960672`, `us-east-1`).
Evidence: `L:/tmp/halospawns-h1-combat-activation-20261020`. Commands from infra root:

```powershell
.\scripts\plan.ps1 dev map-processing
.\scripts\publish-h1-film.ps1 -Tag combat-20261020-r1 -EngineRoot L:/tmp/halospawns-h1-combat-20261019/engines -PreviousRegistry L:/tmp/halospawns-h1-combat-activation-20261020/previous-registry.json -BuildOnly
.\scripts\publish-h1-film.ps1 -Tag combat-20261020-r1 -EngineRoot L:/tmp/halospawns-h1-combat-20261019/engines -PreviousRegistry L:/tmp/halospawns-h1-combat-activation-20261020/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-combat-activation-20261020/final.reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Changed `stacks/dev.yaml`, H1 encoder analytics/roster tests, intake default/retry
tests, retained-profile fixture, H1 README/compatibility/combat/deployment docs,
root `AGENTS.md`/`HANDOFFS.md`/`ATMOS_MIGRATION_PLAN.md`, and sibling API handoff/
roadmap documentation. Only `map-processing` resources changed; ECR received
one immutable image. No Terraform resource definitions changed.

## h1arena Retained Worker Deployed 2026-10-15

Completed the user-authorized dev worker deployment. h1arena is the renamed
continuation of Performance Build 2.0 Beta 3, not a separate game/source kind.
This prerelease snapshot is not a promise of compatibility with the upcoming
upstream release; follow-up alignment must add another immutable profile.

- Worker tag **`h1arena-197bb65c-20261015-r1`**, ECR digest
  `sha256:7712122623064e4009cd37d6458cfd8d456cc8da0a97f11a8cbdcb2955b57857`,
  is Active/Successful. Terraform resolves the immutable tag to that digest.
- Retained profile `h1arena-197bb65c-p9111-wasm-v1` records full source commit
  `197bb65ca6e9cef94c126904bf39ecdd1ea5929d`, protocol 9111 / format 2 / 120 Hz,
  build `UNIVERSAL Only - 2026-10-14 - 197bb65c`. Health confirms the source
  fingerprint and exact WASM/glue hashes. Beta 3 and all four old exporters
  remain unchanged; h1arena supports its base and exporter-4 pins.
- All 2,734 packaged application-file hashes match the offline-tested
  `h1arena-197bb65c-local` image except the append-only release-retention fixture.
  Release image ID is
  `sha256:1abfb9d04d19b0a943d639e39894a4231868e77a3db9258b941feb41ec97ab83`.
  Encoder SHA-256 remains
  `80c93daea0ca4c8e631d7a7a3a9800fdf2e284430adaa336de58db11f86d2737`.
  Retention checks use the registry extracted from the actual previous deployed
  digest, not the candidate checkout. Focused Node tests (6), Python registry
  tests (5), all engine hash checks and read-only/non-root container health and
  rejection checks pass. Native/WASM and Linux conversion evidence is recorded
  in [compatibility](COMPATIBILITY.md#h1arena-snapshot-197bb65c).

Baseline focused plan was no-op. Focused/full preplans contained **0 adds /
1 update / 0 destroys**, solely the H1 Lambda image and computed `last_modified`.
Applied the reviewed saved plan, SHA-256
`fdc823647cef4b110489168f978eb5f101dc60a0c4002043bf509d86810c6c16`.
Focused postplan is no-op; full postplan has zero resource actions and only
unapplied API output refresh `173 -> 183`. Only `map-processing` resources
changed; ECR received the new immutable image. Existing undeclared
`asset_delivery_mode` plan warnings remain unrelated.

The first cold health inventory hit the existing 20-second child-process
timeout. Retry and confirmation pass, verifying both profiles, all four
explicit exporter entries, full h1arena provenance and the encoder
(20.647 s / 2.118 s client-observed invocation time). No timeout was relaxed;
these are health checks, not hosted conversion measurements.

API remains `live=183`; its actual deployed ZIP lacks h1arena registration.
Concurrent sibling API implementation was observed and left untouched. Its
normal CI release and reviewed, profile-scoped original-map bindings are still
required. Do not infer new map approval from a Beta 3 name, size or binding.
The active handoff remains `20261015-infra-api-h1arena-retained-engine`.

API health passes. Queue/DLQ depths are zero. Memory 3,008 MiB, timeout 900 s,
temporary storage 8,192 MiB, concurrency 5, enabled batch-one mapping, both H1
flags, limits, IAM and other consumers remain unchanged. No AWS/session blocker
(`halospawns-dev`, `283279960672`, `us-east-1`). No cloud film/reparse, map review,
backfill, migration, API code/alias write, frontend, commit/push or prod change
occurred in this deployment. Keep both profiles and all retained exporters in
subsequent images; existing jobs/retries must never be repinned.

Evidence: `L:/tmp/halospawns-h1arena-release-20261015`. Commands from infra root:

```powershell
.\scripts\publish-h1-film.ps1 -Tag h1arena-197bb65c-20261015-r1 -EngineRoot L:/tmp/halospawns-h1arena-197bb65c/engines -PreviousRegistry L:/tmp/halospawns-h1arena-release-20261015/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1arena-release-20261015/final.reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Changed `stacks/dev.yaml`, `tests/fixtures/retained-profiles.json`, H1
README/compatibility/deployment docs, and root `AGENTS.md`, `HANDOFFS.md` and
`ATMOS_MIGRATION_PLAN.md`. No API files were edited during deployment.

## Typed Pose Default Promoted 2026-10-14

Completed the user-authorized dev switch-over. Planning ran alongside the API CI
release; the worker apply followed verified API promotion, avoiding an interval
where intake would request an exporter unsupported by the live API.

- API commit `a21e6f1274ccc3c4ba386563755224511e4ceaf5`, successful Linux/native
  build/publish run `38654882633`, promoted normally through the artifact/code
  updater to **`live=182`**. CI: 1,353 tests pass / 68 opt-in skips; Rust validation,
  Ruff, native wheel packaging and dev publication pass. No direct API code/alias writes.
- S3 artifact: `releases/dev-38654882633/a21e6f1274ccc3c4ba386563755224511e4ceaf5.zip`.
  Its SHA-256 `fc8303045404b3d1d428b93168c6ff6ac605c4d94e9349efd118c46e732a768f`
  matches live Lambda code. The ZIP contains the Linux native extension and exact
  committed exporter registry/admin source: exporter 4 with the retained hashes,
  new admin default 4. Public health and unchanged H1 flags/limits pass.
- Final worker **`typed-poses-20261014-r2`**, ECR digest
  `sha256:8edd02a1e1e2eeb2935c984b403a0ad0e7d1b972fae208d9ee6b11910c45adba`,
  is Active/Successful. This is the exact previously tested nine-map candidate
  image, not a rebuild. Its intake default is 4 and encoder SHA-256 remains
  `80c93daea0ca4c8e631d7a7a3a9800fdf2e284430adaa336de58db11f86d2737`.
  Live exact health passes on the first request, verifying every retained engine
  and the encoder (5.823 s client-observed health invocation, not conversion time).

Focused/full preplans contained **0 adds / 1 update / 0 destroys**, solely the H1
Lambda image and computed `last_modified`. Applied the reviewed saved final plan,
SHA-256 `827ced80ce220a6b06d70262b51c0a6d4fb84679d06b3382571ef1ce09ba4810`.
Focused postplan is no-op; full postplan has zero resource actions and only
unapplied API output refresh `173 -> 182` (preplan observed `173 -> 181`).
No app-api Terraform apply was needed; only `map-processing` resources changed.

Queue/DLQ depths are zero. Memory 3,008 MiB, timeout 900 s, temporary storage
8,192 MiB, concurrency 5, enabled batch-one mapping, flags, limits, IAM and other
consumers remain unchanged. No AWS/session blocker (`halospawns-dev`,
`283279960672`, `us-east-1`). No new image publication, film/reparse, backfill,
migration, frontend or prod change occurred. Existing generations remain selected.
Hosted conversion latency is still unmeasured; the prior offline evidence is not
a Lambda performance claim. Retain exporter-4 API/worker support and viewer-4
readers during rollback; do not repin existing jobs/retries.

Evidence: `L:/tmp/halospawns-h1-typed-poses-promote-20261014`. Commands from infra root:

```powershell
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-typed-poses-promote-20261014/final.reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Changed `stacks/dev.yaml`, H1 README/compatibility/deployment/performance/typed-
transport docs, root `AGENTS.md`, `HANDOFFS.md` and `ATMOS_MIGRATION_PLAN.md`.
Sibling API changes are documentation only: `AGENTS.md`, `HANDOFFS.md`,
`ROADMAP.md`, `docs/h1film-runtime-exporter.md`. Both handoffs are completed.
The user committed/pushed the API change; this promotion made no commits/pushes.

## Typed Pose Compatibility Deployment 2026-10-14

Historical compatibility stage, superseded by the final default promotion above.

The user authorized deploying the incremental-state/typed-pose candidate. Dev now
runs the new encoder in compatibility mode because inspection of the actual API
`live=181` ZIP confirmed it still registers only exporters 1/2/3 and defaults new
admin reprocess attempts to 3. Sending new exporter-4 prepares now would fail.
This deploy does not claim the full typed path is active for new uploads.

- Live compatibility image: `typed-poses-20261014-r1`, digest
  `sha256:a0cfb64b25d0feabed6101dc7c3ec3a66e96b71a5f4acdbd168597ddccafa819`.
  All 2,727 packaged application-file hashes match the tested typed-pose candidate
  except `h1_film/cloud.py`, whose new-upload exporter default is 3 rather than 4.
- Prepared final image: `typed-poses-20261014-r2`, digest
  `sha256:8edd02a1e1e2eeb2935c984b403a0ad0e7d1b972fae208d9ee6b11910c45adba`.
  All 2,727 file hashes and the image ID match the nine-map tested candidate:
  `sha256:e0862f5264372c2bdf844e0951a50ec38f82e1a0764e9dee283fdc54dfee63df`.
  This supersedes prepared `typed-20261014-r2`; use the new tag after API release,
  not the older encoder. The checkout retains the prepared intake-4 default.
- Both images contain encoder SHA-256
  `80c93daea0ca4c8e631d7a7a3a9800fdf2e284430adaa336de58db11f86d2737`.
  Engine profile, exporter-1/2/3/4 binaries, analytics 3, viewer 4, public contracts
  and pose quality are unchanged. The registry retention audit uses the registry
  extracted from the previous deployed image, verified against its ECR digest.

The baseline focused plan was no-op. Focused/full pre-apply plans contained
**0 adds / 1 update / 0 destroys**, only `aws_lambda_function.h1_film[0].image_uri`
and computed `last_modified`. Applied the reviewed saved compatibility plan,
SHA-256 `2c7e98ae3007206e6520abee721704797e372233dc0d96065eb0f43b442d917f`.
Focused post-apply plan is no-op. Full post-apply dev plan has zero resource
actions and only the existing, unapplied API output refresh `173 -> 181`.
Only `map-processing` resources changed; ECR received two new immutable images.

Lambda is Active/Successful with the expected digest. Exact health verifies the
encoder and every retained engine hash. As in the prior rollout, the first cold
inventory request exceeded its existing 20-second child-process timeout; retry
and confirmation passed (8.353 s / 1.784 s client-observed invocation time).
No timeout was relaxed. These are health checks, not conversion measurements.
API health passes; `live=181` and both H1 flags remain unchanged. Queue and DLQ
depths are zero. Memory 3,008 MiB, timeout 900 s, temporary storage 8,192 MiB,
concurrency 5, enabled batch-one mapping, limits, IAM and other consumers remain.
No AWS/profile/session blocker (`halospawns-dev`, `283279960672`, `us-east-1`).

Validation: 40 Python and 16 Node tests pass; the prepare/retry test now explicitly
retains exporter-4 jobs too. Both published images pass read-only/non-root health
and fail-closed container tests. The complete compatibility image converts
Prisoner with exporters 3 and 4: each has 70,582 ticks / 589 simulation hashes,
identical public products, all three completion modes and persisted retries.
The exporter-4 run also passes fresh generic full-source comparison on every tick.
These are release correctness checks, not new speed measurements. The prior
160 passing tests, nine-map paired measurements and 933,014 full-source
comparisons remain the candidate evidence; see [performance](PERFORMANCE.md).

Evidence: `L:/tmp/halospawns-h1-typed-poses-release-20261014`.
Commands from infra root (no aggregate apply):

```powershell
.\scripts\plan.ps1 dev map-processing
.\scripts\publish-h1-film.ps1 dev -Tag typed-poses-20261014-r1 -EngineRoot L:/tmp/halospawns-h1-typed-20261014/engines -PreviousRegistry L:/tmp/halospawns-h1-typed-poses-release-20261014/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
.\scripts\publish-h1-film.ps1 dev -Tag typed-poses-20261014-r2 -EngineRoot L:/tmp/halospawns-h1-typed-20261014/engines -PreviousRegistry L:/tmp/halospawns-h1-typed-poses-release-20261014/previous-registry.json
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-typed-poses-release-20261014/compatibility.reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

### Fully Switching New Conversions

Completed on 2026-10-14: the user committed/pushed the API change; normal CI and
the code updater promoted `live=182`. Its actual artifact/defaults were verified
before applying final worker `typed-poses-20261014-r2`. New uploads and admin
attempts now use exporter 4, incremental world state and typed poses. Both
`20261014-infra-api-h1film-typed-exporter4` handoffs are complete. Exact evidence is
in [the final promotion](#typed-pose-default-promoted-2026-10-14).
A separately authorized small hosted canary remains necessary before claiming
actual Lambda latency gains; no conversion was submitted by this rollout.

No frontend release, database migration, bulk reconversion or artifact replacement
is required: public output stays identical. Existing jobs and retries intentionally
retain their original exporters. Do not repin them or remove old engines. Once
exporter-4 jobs/completions exist, rollback must retain exporter-4 API/worker support
and viewer-4 readers. No commits/pushes, replay jobs, prod or Xbox changes occurred.

Rollout edits: `stacks/dev.yaml`, `tests/test_cloud.py`, H1 README, compatibility,
deployment, performance and typed-transport docs, root `AGENTS.md`, `HANDOFFS.md`
and `ATMOS_MIGRATION_PLAN.md`. The temporary intake-3 `cloud.py` build edit is
restored to the prepared intake-4 source. Sibling API edits only update the
existing pending release pointers in `AGENTS.md`, `HANDOFFS.md`, `ROADMAP.md` and
`docs/h1film-runtime-exporter.md`; its implementation remains unreleased.

## Typed Exporter 4 Rollout 2026-10-14

Historical first compatibility stage; current worker pins and remaining steps
are in [the typed-pose deployment](#typed-pose-compatibility-deployment-2026-10-14).

The user authorized applying the measured performance candidate to dev. The
compatibility stage is deployed. Full default promotion remains gated on the
API registration/default release under `20261014-infra-api-h1film-typed-exporter4`.
Committing/pushing that scoped API change requires the user's pending approval;
do not bypass its normal Linux/native CI and artifact/code-updater release path.

- Live compatibility worker: `typed-20261014-r1`, digest
  `sha256:9cd7689c1fdf6f97051fa07d7490f8bcdb7ecbb420e73b24973fc3c3f3b27d62`.
  Local image ID exactly matches the nine-map benchmarked
  `typed-candidate-20261014-r2`: intake stays exporter 3, all four exporters work.
- Prepared final worker: `typed-20261014-r2`, digest
  `sha256:9d8942b2bb3f0118a37e18910f8dec2e6d04f4d5eb672125db3cc8eaf0c39ff2`.
  Only the new-upload default changes to exporter 4; existing prepares recover
  their persisted jobs unchanged. Do not pin/apply it before API support is live.
- Both encoder hashes:
  `336121540c23af6e1f5096e20bb9e58df00998c4b8870d611c0b9b5400b837e7`.
  Exporter-4 WASM:
  `fab1791bf6de4eb10862e1bdd468c4ce62de24f0cb86aa012293a346912c28bd`;
  glue: `f9ef73522692ffc0067378d67ef7dac7ab4bbc67f7dab8a85f0624c3b4c17bdc`.
  Original exporter-1/2/3 hashes and logical `HSFT0001` remain unchanged.

Focused/full pre-apply plans contained **0 adds / 1 update / 0 destroys**, solely
`aws_lambda_function.h1_film[0].image_uri` and computed `last_modified`.
Applied the reviewed saved compatibility plan, SHA-256
`47d1808adb166980dc616ad9e817ea6404b7c2d729c76be938a1b3fd9e977243`.
Focused post-apply plan is no-op; the full post-apply dev plan has zero resource
actions and only unapplied API output refresh `173 -> 181`. Preplanning observed unrelated renderer
computed-version drift `255 -> 259`, refreshed without changing renderer
resources, and existing unapplied API output refresh `173 -> 181`.

Worker is Active/Successful and retained-hash/encoder health passes. The first
cold health request exceeded its 20-second child-process timeout; the next
requests passed in 11.386 s and 0.479 s. No health timeout was relaxed. This is
an inventory probe, not a hosted conversion measurement. API public health
passes; its live alias remains 181 with both H1 flags true. Queue and DLQ are
empty. Concurrency 5,
3,008 MiB memory, 900 s timeout, 8,192 MiB temporary storage, enabled batch-one
mapping, source/map checks, provisional limits, IAM and other consumers remain.

Validation: 40 worker Python tests and 16 Node tests pass. API focused unit and
isolated PostgreSQL tests: 157 passed / two optional private-product skips.
Full local API suite: 1,353 passed / 68 opt-in skips; Ruff passes. PyCharm does
not include the sibling API module, so API checks use its existing verified
Python 3.12 virtual environment per its repository instructions. The complete
final image passes read-only/non-root health and fail-closed tests, and converts
Prisoner offline: 70,582 ticks / 589 hashes, all completion modes and retries,
22,864,581 replay bytes with SHA-256
`dc66bead6f89f2058d16d257c0f6378d52a69e7b0ef75dbea68457517e6c6462`.
All products match the benchmarked candidate. Actual API pure builders accept
both candidate and final-image callbacks, including reparse/viewer-only modes.
The prior Rust/whole-corpus validation and 18.23% offline result are unchanged.

No film job or reparse was submitted, no existing generation was replaced, and
no migration, frontend, Xbox, gate, limit or prod change was made. No AWS session
blocker (`halospawns-dev`, `283279960672`, `us-east-1`). Once exporter-4 jobs or
completions exist, rollback must retain exporter-4 API/worker support and all
viewer-4 readers. No bulk reconversion is needed for byte-identical artifacts.

Commands from infra root; evidence: `L:/tmp/halospawns-h1-typed-release-20261014`:

```powershell
.\scripts\publish-h1-film.ps1 dev -Tag typed-20261014-r1 -EngineRoot L:/tmp/halospawns-h1-typed-20261014/engines -PreviousRegistry L:/tmp/halospawns-h1-typed-release-20261014/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-typed-release-20261014/compatibility.reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\publish-h1-film.ps1 dev -Tag typed-20261014-r2 -EngineRoot L:/tmp/halospawns-h1-typed-20261014/engines -PreviousRegistry L:/tmp/halospawns-h1-typed-release-20261014/previous-registry.json
.\scripts\plan.ps1 dev
```

The next step from this initial stage remains the API release. The original
prepared final image is now superseded: follow [the current switch-over steps](#fully-switching-new-conversions)
and use `typed-poses-20261014-r2`. Do not republish immutable tags or submit replay
jobs as a probe.

Changed files for this rollout: infra `stacks/dev.yaml`,
`lambda/h1_film/cloud.py`, `lambda/h1_film/tests/test_cloud.py`, H1 README,
compatibility/deployment/performance/typed-transport docs, root `AGENTS.md`,
`HANDOFFS.md` and `ATMOS_MIGRATION_PLAN.md`; API `h1film_contract.py`,
`services/admin_replay_reprocess.py`, unit/integration H1 tests,
`docs/h1film-runtime-exporter.md`, `AGENTS.md`, `HANDOFFS.md` and `ROADMAP.md`.
Terraform ownership: only `map-processing`; ECR receives immutable images but
no ECR resource configuration changes. No changes were committed or pushed.

## Runtime Exporter 3 Deployed 2026-10-11

The user authorized dev deployment of the measured candidate. Compatibility
preceded default promotion, without toggling consumers or submitting film jobs:

1. Published and applied compatibility worker `runtime-20261011-r1`, retaining
   intake exporter 2 while supporting exact exporters 1/2/3. Its local image ID
   matches the benchmarked `runtime-candidate-20261011-r2`. ECR digest:
   `sha256:b21fb7c620fe7ebbc8baa0499d9d60239fa11068dc237c3ca8da10197d51f1da`.
2. API `acdc9cc635fa4521b79d5e7d2dc2b4ae0cefd2cb`, successful Linux/native build
   and dev publish run `38142632342`, registered exporter 3 and selected it for
   new admin reprocess attempts. Normal artifact/code-updater promotion reached
   `live=180`; no direct API code or alias writes. Live code SHA-256 matches S3
   artifact `de6a95a40192f5b3d566efc3ef6da2ca1cdfaec7865df5f8df807668c63fe45c`.
   Artifact key: `releases/dev-38142632342/acdc9cc635fa4521b79d5e7d2dc2b4ae0cefd2cb.zip`.
3. Published and applied final worker `runtime-20261011-r2`, changing new intake
   selection to exporter 3. ECR digest:
   `sha256:79126d941e825f71570a7c09a74ad985747774aa4f6d399e388514825e4f4471`.
   Live encoder SHA-256:
   `a98bf58f5298994db0ab37694f89a6f5d6404d52c82a0a738ec3259bb98b6046`.

Exporter 3 WASM is
`54bd3169d31a1fe27d62214f4cd610fbef2fde5ddd1ea5956091f9427fc3fe61`;
glue is `f9ef73522692ffc0067378d67ef7dac7ab4bbc67f7dab8a85f0624c3b4c17bdc`.
The simulation profile, map approvals and original exporter-1/2 binaries remain
unchanged. Old bootstrap notifications recover the persisted job after an
explicit-default conflict, without repinning or weakening source validation.

Each focused/full pre-apply plan contained **0 adds / 1 update / 0 destroys**:
only `aws_lambda_function.h1_film[0].image_uri` and computed `last_modified`.
Applied the exact reviewed saved plans, SHA-256:

- Compatibility: `e9f0a13d251bdbcbf937b6ba7f5c80302c9d0e48fa741ce8466c1ed941e55a18`.
- Final: `a45306cea50f3ddcca93afb868949ffed939b3ef686ef1fad8d4b9763c6b63e3`.

Both focused post-apply plans are no-op; the final full dev plan has zero resource
actions and only the unapplied API version output refresh. Initial planning observed unrelated
renderer computed-version drift `254 -> 255`, refreshed without changing its
resources. The existing API output-only refresh was `173 -> 179` before the API
release and is now `173 -> 180`; no app-api Terraform apply was needed.

Live worker health verifies all retained exporter hashes and the encoder hash;
Lambda is Active/Successful. Memory 3,008 MiB, timeout 900 s, temporary storage
8,192 MiB, concurrency 5, enabled batch-one mapping, both API H1 flags, provisional
limits, IAM and other consumers are unchanged. Queue and DLQ depths are zero.
API public health passes. No AWS/profile/session blocker remains
(`halospawns-dev`, account `283279960672`, `us-east-1`).

Validation: 39 H1 Python tests and 14 Node tests pass. API full local suite:
1,349 passed / 60 opt-in skips; focused unit and isolated PostgreSQL tests:
168 passed / two optional private-corpus skips; Ruff and release CI pass.
The final complete image, without overlays, converts Prisoner offline with all
70,582 ticks / 589 hashes, all completion modes and persisted retries. Its
22,864,581-byte replay and all non-operational callback products exactly match
the nine-map tested candidate. The API's actual pure builders accept both the
candidate and release callbacks, including reparse and viewer-only modes.

No cloud film conversion or reparse was submitted, no existing generation was
replaced, and no migration, frontend, Xbox or prod change was made. Actual Lambda
conversion latency for exporter 3 remains unmeasured; the 17.84% conversion /
15.89% whole-harness improvements are offline results, not a 3x result.
Do not roll back to API/worker versions lacking exporter 3 once its jobs or
completion retries exist. Viewer-4 reader compatibility remains mandatory.

Commands from infra root, with evidence under
`L:/tmp/halospawns-h1-runtime-release-20261011`:

```powershell
.\scripts\publish-h1-film.ps1 dev -Tag runtime-20261011-r1 -EngineRoot L:/tmp/halospawns-h1-runtime-20261011/engines -PreviousRegistry L:/tmp/halospawns-h1-runtime-release-20261011/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-runtime-release-20261011/compatibility.reviewed.planfile
.\scripts\plan.ps1 dev map-processing
# API main commit acdc9cc was published by its normal push workflow here.
.\scripts\publish-h1-film.ps1 dev -Tag runtime-20261011-r2 -EngineRoot L:/tmp/halospawns-h1-runtime-20261011/engines -PreviousRegistry L:/tmp/halospawns-h1-runtime-release-20261011/previous-registry.json
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-runtime-release-20261011/final.reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

## Pose Default Deployed 2026-10-10

The user authorized the new standard format and reconversion of existing dev
films. [POSE_COMPRESSION.md](POSE_COMPRESSION.md) documents the error bound,
fallbacks, streaming implementation and independent validation. This changes
stored pose representation, not simulation, tick rate or analytics products.

- Infra implementation `954a368`, stack pin `3c23df9`; immutable image
  `pose4-20261010-r1`, digest
  `sha256:0ffb6eb8c5cf548dffafa84852ecfd7c6acc4a671c980b55677d05dffef4810f`.
  Live encoder SHA-256
  `774e59195ba30c5dab6497d89184a337d97de30b7a198b262dfcddcb4b13bf2b`.
  Both exporter bundles match the previous immutable image's registry.
- Frontend `1302a2b`, successful dev run `38060200583`, deployed first.
  API-owned migration `20261010010000_replay_pose_container.sql` was the only
  migration in the dry run and was applied to linked dev. It changes only the
  format/version constraint, not existing rows or permissions.
- The worker was deployed before API default promotion. API `44f4e7a`, successful
  dev run `38061137196`, promoted through the normal artifact/code-updater path
  to `live=179`. No direct API Lambda code/alias writes were made.
- Focused and full Terraform plans: **0 adds / 1 update / 0 destroys**, solely
  `aws_lambda_function.h1_film[0].image_uri` and computed `last_modified`.
  Reviewed plan SHA-256
  `4c0f841d9214dd8fc49e31a68f1b99a7a1a4785ab6d211bb57d65222d0555c34`.
  Applied that exact saved plan. Post-apply focused plan is no-op; full dev plan
  has zero resource actions and only the unapplied API output refresh `173 -> 179`.
  The frontend's existing map-renderer release workflow also published its
  shared bundle (run `38060200576`, dev renderer `live=254`). No renderer behavior
  or settings were changed in this work. Terraform refreshed computed-version
  drift `249 -> 254`, without resource actions for the renderer.
- Memory 3,008 MiB, timeout 900 seconds, temporary storage 8,192 MiB, concurrency
  5, enabled batch-one mapping, IAM and other worker settings are unchanged. Live worker
  is Active/Successful; both H1 flags are true. No AWS/session blocker remains.
- Validation: 57 encoder tests pass (one optional benchmark skipped), five shared
  pose tests, 20 POC tests, 39 H1 Python tests, 13 Node tests and 82 parser Python
  tests (three optional native tests skipped). Pose Clippy is clean. API: 1,402
  passed with isolated PostgreSQL, two optional corpus skips, Ruff clean.
  Frontend: 1,572 viewer tests, full workspace tests, both builds and hosted
  browser acceptance pass; CI also validates Linux API packaging.
- Published-image offline worker tests cover all completion modes and persisted
  retries. The canary output is byte-identical to the independent browser-tested
  candidate and passes full Rust container readback. Legacy exporter 1/viewer 2
  remains functional; the largest supplied film passes resource-envelope checks.
  Game facts, participants, team stats, native analytics and spatial artifact
  bytes match the prior release; only diagnostic memory measurements differ.

### Frozen Dev Reconversion

- Operation `ea24aaa5-fa1f-4a50-9f3c-1303b1956afd` freezes all 32 existing H1
  replay/source/hash/size/version/map identities and selected artifact epochs.
  All initially selected viewer 3 / exporter 2, totaling 4,358,658,355 bytes.
- Canary replay `55dd6401-0314-4fe8-a896-56f1af8a6dc0`, attempt
  `8214e673-ed7b-55c3-9518-1ab3ffa093eb`, succeeded and activated viewer 4.
  Actual Lambda: **91.594 seconds, 614 MiB peak memory**; converter process-tree
  RSS 295,892 KiB. Source verification: 70,582 ticks, 589 recorded hashes.
- Hosted canary: 97,749,786 -> 22,864,597 bytes, 4.275x smaller; new SHA-256
  `7eae439f2e13c7b29ee0992733bcf70e52b314740e6b06ab8454b9def5153dc0`.
  Independent frontend decoding compares every old/new non-pose field exactly
  and all 5,156,372 nodes within the bound; maximum radius-one bound 0.00008230.
- Actual Basic-Auth-protected dev site and hosted API/CDN paths pass Chrome at
  1440x1000 and 390x844, with repeated end/backward seeks, playback and 36 successful
  range responses per viewport. No page errors/overflow. Additional instrumented
  local-viewer checks of the hosted bytes compare exact decoded poses and glass
  at cold chunk boundaries and show bounded resident memory around 132 MB.
- The remaining 31 jobs were submitted after the canary passed, through normal
  audited full-reparse SQL/dispatch. The existing API completion path owns all
  artifact selection; no direct result or selection writes. **All 32 succeeded
  and activated their matching revision-4 generations**, verified at
  `2026-10-10T15:11:42Z`; source hashes/versions/maps remain unchanged.
- Aggregate active artifacts: **4,358,658,355 -> 1,004,764,788 bytes**, a
  **76.9478% reduction (4.338x)**. Individual reductions range from 4.224x to
  4.587x. Actual Lambda durations span 65.004-212.599 seconds; reported peak
  memory spans 576-667 MiB, with no logged errors or timeouts. The processing
  queue and DLQ are drained. These are 32 individual observed runs, not SLA or
  maximum-size stress-test claims.
- Evidence and frozen operator tool: `L:/tmp/halospawns-h1-pose-default-20261010/`.
  Browser harness/screenshots: sibling frontend ignored
  `smoke-runs/h1film-pose-20261010/`. Source objects and older generations are
  retained, not deleted to manufacture storage savings.

Commands from infra root (API migration commands run from its owning repo):

```powershell
.\scripts\publish-h1-film.ps1 -Tag pose4-20261010-r1 -EngineRoot <retained-engines> -PreviousRegistry <previous-image-registry>
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-pose-default-20261010/map-processing.reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
# API repo:
.\scripts\apply-migrations.ps1 -DryRun
.\scripts\apply-migrations.ps1
```

Do not roll back to a reader/worker lacking revision 4 while its artifacts/jobs
exist. No prod, legacy website cutover, Xbox default, map approval or engine
profile expansion is part of this release.

## Reserved concurrency raised to five 2026-10-09

The user explicitly requested raising only `halospawns-h1-film-dev` reserved
concurrency from 1 to 5. `stacks/dev.yaml` now sets 5, and the component's
validation ceiling is 5. Foundation isolation, integer validation and intake
activation gates remain intact; all eight component tests pass, including
accepting 5 and rejecting 6 and fractional concurrency.

The focused and full pre-apply plans contained exactly one resource update:
`aws_lambda_function.h1_film[0].reserved_concurrent_executions`, `1 -> 5`.
The full plan also observed the existing API output-only refresh `173 -> 178`,
which was not applied. The other five components had zero resource actions.
The reviewed saved plan SHA-256 was
`87b819d4fa71eaf1c94966085d42b5226104ca518cebbd6a8e227736cf08acc2`.
Its apply completed with **0 adds / 1 update / 0 destroys**; the focused
post-apply plan is no-op.

Live AWS checks confirm reserved concurrency 5 and Active/Successful state.
The existing `viewer3-glass-20261009-r1` image digest, memory, timeout, IAM and
enabled batch-one SQS mapping are unchanged. The mapping still has no separate
maximum-concurrency setting; the function's reserved concurrency is the hard
cap. Queue visibility, redrive policy, other workers and prod were not changed.
This operation did not submit or redrive films. No AWS/profile/session blocker
remains (`halospawns-dev`, account `283279960672`, `us-east-1`).

Commands from the repository root:

```powershell
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\map-processing' test -no-color
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\map-processing' apply -no-color dev-map-processing.planfile
.\scripts\plan.ps1 dev map-processing
```

## Glass default deployed 2026-10-09

New H1 intake and newly requested H1 reparses now select analytics 3, retained
exporter 2 and viewer 3. Exporter 2 observes the engine's BSP-0 intact bits and
emits the inverse as the nullable uint32 `broken_surfaces` snapshot. Unknown or
multi-BSP state remains null. Revision-3 projection and delta encoding retain
the field. The simulation profile, recorded input, RNG and map bindings do not
change. No camo/runtime-item state or Xbox equivalence is claimed.

Explicit old exporter/viewer pins and persisted retries remain supported, with
the original WASM/glue bundled alongside `exporter-2/`. The global/Xbox viewer
default stays 2; only H1 source-specific selection changes. API inventory now
classifies old supported H1 revisions as stale rather than unsupported.

- API commit `bfd57f2232e5e1d31878e3d3629303fbd0624325` deployed first via
  successful run `38006549483`; `halospawns-dev-app-api:live` is version `178`.
- Immutable H1 image tag: `viewer3-glass-20261009-r1`; digest
  `sha256:13f892c275fbfe8e4b652c7a00993261dab88ac30a045258bc61f23a63c39bbc`.
  Encoder: `6572f2923d224d82f70708d99f231e2d542ffe05a20ff3c68a7264db4fcf5be1`.
- Exporter-2 WASM: `51054b891f959b3b1363ff65dbbe317af38cf05f83c6eb80af5424591f9ce442`;
  glue: `f9ef73522692ffc0067378d67ef7dac7ab4bbc67f7dab8a85f0624c3b4c17bdc`.
  Registry entries are append-only; the original profile record is unchanged.
- Release source is the isolated `codex/h1film-viewer3-default` worktree based
  on `b791c1b`. Unfinished native/performance experiments in the main worktree
  were not included in this image.
- Full pre-apply plan: 0 adds / 1 update / 0 destroys, solely the H1 Lambda
  image. Reviewed saved plan SHA-256:
  `0e97428db35099d73d8a73b519720a5caa929e0ab1673f7d4f46875f103597d9`.
  Applied that plan; final full dev plan has zero resource actions (the existing
  API output-only refresh remains). Active/Successful live health verifies
  both exporter bundles. Gates, IAM, concurrency 1, batch size 1, 3,008 MiB
  memory, 900-second timeout and 8,192 MiB temporary storage are unchanged.
- Offline nine-map full-worker checks cover 745,485 ticks and 6,215 recorded
  hashes, both reprocess modes and idempotent completion retries. Independent
  frontend-codec decoding compared every non-glass field of every tick and all
  analytics products with the previous image: unchanged. Prisoner and Temple
  have recorded glass transitions; the other seven films retain mask 0.
- API suite: 1,392 passed, two optional corpus skips; expanded focused checks:
  159 passed and Ruff clean. H1 worker: 38 Python and 13 Node tests pass;
  replay-parser Python: 82 tests, three optional native skips. Frontend:
  all 1,952 workspace tests pass. CI also validated Linux API packaging.

### Bounded dev backfill

The user requested the future default and backfill. A frozen manifest matches
all 32 existing H1 films by replay/source/hash/size/version/map/selected artifact
and lifecycle epoch. Normal reprocess attempt SQL atomically allocates request
sequences; the existing dispatcher sends each attempt to `films-processing-queue`.
Each attempt has an audit record identifying the actual AWS SSO operator, not a
fabricated Supabase user. No direct result/artifact selection writes were made.

- Operation: `d7c88885-f9cb-4419-8eba-d31d20f1ed44`.
- Canary replay: `55dd6401-0314-4fe8-a896-56f1af8a6dc0`; attempt
  `776792e3-ab75-5fd1-a2b5-d4db4c0666e0` succeeded and activated viewer 3,
  exporter 2. Lambda took 103.86 seconds, used 701 MiB, and verified all 589
  recorded hashes across 70,582 ticks.
- Canary artifact SHA-256:
  `2e3b44ec8b97b1390fd6678d76bf7fa25761b62ff70699c2dc59b29c98e3c9c6`.
- Chrome checks at 1440x1000 and 390x844 loaded the actual hosted canary bytes
  and hosted Prisoner GLB through the local viewer. Eight forward/backward seeks
  reproduce masks `0,0,1,1,3,3,0,0`; pane visibility matches and the collision
  BVH is reused. Glass breaks at ticks 2,236 and 5,701. Both canvases are
  nonblank, camera movement changes pixels, and there are no page errors or
  overflow. Screenshots and report:
  `../halospawns-svelte/smoke-runs/h1film-glass-20261009/` (ignored).
- The other 31 jobs were dispatched after the canary passed. Submission is
  complete; do not treat queued attempts as completed or enqueue duplicates.
  Existing selected artifacts remain playable until each fenced completion
  activates its new generation.
- Local evidence and operator status tool:
  `L:/tmp/halospawns-h1-viewer3-20261009/` (`backfill-scope.json`,
  `backfill-dispatch.log`, `backfill.py --manifest <manifest> --status`).

Do not roll the worker back to `performance-20261009-r2` while exporter-2 jobs
exist: that image cannot honor the new pins. Any rollback must retain both
exporters and viewer revisions 1/2/3. No prod, Xbox, map approval or website
cutover is part of this release.

## Second performance release deployed 2026-10-09

The user refreshed dev SSO and explicitly requested apply of the second tested
candidate. Published immutable `performance-20261009-r2`, then applied only the
H1 image in `map-processing`. The experimental native/HUD build is **not** in
this release; the retained WASM/glue, viewer contracts and analytics revisions
are unchanged.

- ECR image: `283279960672.dkr.ecr.us-east-1.amazonaws.com/halospawns-h1-film:performance-20261009-r2`.
- Digest: `sha256:deb644ddb752a6bbadc9f0d7be2c2c759ba9129c23586063bc6392a5639ef195`;
  compressed size 272,602,783 bytes. No existing release tag was overwritten.
- Image ID `sha256:a24cb1f9a7d5ad04fe59fad9a6992c73de5f8cf2c55329f41b539656e7c6e29f`
  exactly matches the nine-map packaged candidate. Live encoder SHA-256:
  `f271eb7661bdbea1337bdc9493fe25e4557811902a2755cfb190bd26228c8400`.
- The initial credential-retry plan, before repinning, was no-op. Focused and
  full pre-apply plans then showed **0 adds / 1 update / 0 destroys**, solely
  `aws_lambda_function.h1_film[0].image_uri` and computed `last_modified`.
  The full plan also showed the existing API output-only refresh `173 -> 176`.
- Reviewed saved plan SHA-256:
  `2a85e3db70e359a98b3b08de18846f8c8da3bf489842ec92c91ac012ef0dcc55`.
  Checked the dev account, digest, action/attribute allowlist and unchanged
  limits, then rechecked the plan hash immediately before applying.
  Apply completed with **0 added / 1 changed / 0 destroyed**.
- Planning observed an external renderer function/alias release `245 -> 247`.
  The apply refreshed that state without changing its code or alias. API
  `live=176` was already deployed before this release and remains unchanged.
- Focused post-apply plan is no-op. The final full dev plan has zero resource
  actions: five components are no-op; `app-api` has only its unapplied output
  refresh `173 -> 176`. No aggregate apply was run.
- Live function is Active/Successful at the expected digest. Health returned
  200 in intake mode with the expected encoder and every retained engine hash.
  The entire SQS mapping matches its pre-release snapshot, remaining enabled
  with batch size 1. Concurrency 1, 3,008 MiB memory, 900-second timeout,
  8,192 MiB temporary storage and both API H1 flags/limits are unchanged.
  Queue and DLQ remained empty. No IAM, source/map pin, secret, Xbox consumer,
  website or prod change. No film upload or reparse was submitted.
  There is no remaining AWS/profile/session blocker.

The candidate passed 52 Rust, 37 Python and 12 Node tests; nine paired full-worker
comparisons (745,485 ticks and 6,215 recorded hashes per image); retained analytics
revisions 1/2; exact dual-rate chunk/container comparisons and independent readback;
and blocked/failed-encoder cleanup checks. Publication reran retained-engine and
read-only/non-root container health/rejection checks; all five mocked component
tests passed. Offline conversion totals are 505.658 -> 260.832 seconds versus R1;
whole harness totals are 553.268 -> 307.885 seconds. These are not actual Lambda
duration measurements or a 10x result. Hosted revision-3 reparse and browser
acceptance remain separate coordinated work.

Evidence: `L:/tmp/halospawns-h1-perf2-20261009/release`.
Exact publication and plan/apply commands, in order:

```powershell
.\scripts\plan.ps1 dev map-processing
.\scripts\publish-h1-film.ps1 dev -Tag performance-20261009-r2 -EngineRoot .build/h1-film-9c8c68566d1b4e57b571201bc6c57035 -PreviousRegistry L:/tmp/halospawns-h1-perf2-20261009/release/previous-registry.json
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' test -no-color
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color L:/tmp/halospawns-h1-perf2-20261009/release/map-processing.reviewed.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

The reviewed plan is a byte-for-byte private copy of Atmos's generated
`dev-map-processing.planfile`, inspected using `terraform show -json`. Changed
for deployment: `stacks/dev.yaml`, `AGENTS.md`, `ATMOS_MIGRATION_PLAN.md`,
`HANDOFFS.md`, and H1 `README.md`, `DEPLOYMENT.md`, `PERFORMANCE.md`. Runtime changes
are documented in [PERFORMANCE.md](PERFORMANCE.md#second-local-candidate).
No Terraform resource definitions changed. A compatible rollback can repin
`performance-20261009-r1` after reviewing a focused component plan; leave the
enabled gates and retained analytics/engine contracts intact.

## Runtime performance deployed 2026-10-09

The user authorized applying the [runtime performance work](PERFORMANCE.md).
Published and deployed only the H1 worker image in dev. Its three-film offline
results roughly halve whole-worker harness runtime with identical viewer bytes
and gameplay products. This does not establish actual Lambda conversion times
or satisfy the pending hosted revision-3 reparse/browser acceptance gates.

- Image: `283279960672.dkr.ecr.us-east-1.amazonaws.com/halospawns-h1-film:performance-20261009-r1`.
- ECR digest: `sha256:3ef684fac0e5a34375bfaead2d2e40011a97e6964420178448139f901e7eef32`;
  compressed size 272,582,992 bytes. No existing tag was overwritten.
- Image ID `sha256:a2ecc3656149aeacc400c4106bd5a29f11b9dbd5a1956e83c7a0ca7a036dd7a9`
  exactly matches the benchmarked local candidate. Live encoder SHA-256 is
  `1c4e96c65abbae68d49024ad522ce58c494683cc0a405d29d2dd2a2f1129672c`.
- Focused and full pre-apply plans: **0 adds / 1 in-place update / 0 destroys**,
  only `aws_lambda_function.h1_film[0].image_uri` and computed `last_modified`.
  Reviewed the saved plan JSON and checked its SHA-256 before applying it.
  The apply completed with exactly that one resource change.
- Pre-apply drift also noted externally released renderer version `244 -> 245`
  and API output version `173 -> 175`. No renderer/API code or alias was changed;
  `map-processing` refreshed its renderer state during the image-only apply.
  The focused post-apply plan is no-op. The final full dev plan has zero resource
  actions: five components are no-op and `app-api` has only its existing output
  refresh `173 -> 175`, which was not applied.
- Live function is Active/Successful at the expected image digest. Health
  returned 200 in intake mode with the expected encoder and retained engine
  hashes. The enabled batch-one mapping, concurrency 1, 3,008 MiB memory,
  900-second timeout and 8,192 MiB temporary storage are unchanged.
- API `live=175`, both H1 flags, and provisional 512 MiB / 432,000 tick / four
  player limits are unchanged. Queue and DLQ were empty before/after. No IAM,
  source/map pin, secret, Xbox consumer, website or prod change. No film upload
  or reprocess job was submitted. No AWS/profile/session blocker remains.

Validation retained from the exact candidate image: 48 Rust, 37 H1 Python,
12 Node and 81 shared parser tests; real Prisoner/Dread/Downrush complete-worker
comparisons; Prisoner analytics revisions 1/2; byte-exact dual-rate chunks and
independent full readback. One optional Rust profiler remains ignored. Release
also reran all five mocked component tests, retained-engine audit, read-only
non-root container health/job rejection, and live health/configuration checks.

Evidence: `L:/tmp/halospawns-h1-performance-20261009/release`. Exact release commands:

```powershell
.\scripts\publish-h1-film.ps1 dev -Tag performance-20261009-r1 -EngineRoot .build/h1-film-9c8c68566d1b4e57b571201bc6c57035 -PreviousRegistry L:/tmp/halospawns-h1-native3-20261009/previous-registry.json
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' test -no-color
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color dev-map-processing.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Changed for deployment: `stacks/dev.yaml`, `AGENTS.md`, `ATMOS_MIGRATION_PLAN.md`,
`HANDOFFS.md`, and H1 `README.md`, `DEPLOYMENT.md`, `PERFORMANCE.md`. Runtime/test/tool
changes and detailed offline evidence are listed in `PERFORMANCE.md`. No Terraform
resource definitions changed. A compatible rollback can repin the prior
`native-analytics3-20261009-r1` after a reviewed component plan; do not use the
older intake/foundation images for queued revision-3 jobs.

## Native analytics revision 3 deployed 2026-10-09

User-authorized dev-only release. New initial uploads explicitly request v2 jobs
with analytics revision 3. Old v1 jobs, explicit revisions 1/2, original engines
and persisted retries remain supported. Native totals and cumulative 120 Hz
timelines cover PGCR damage dealt, precise exported received vitality damage,
camo pickups and overshield pickups. Recorded EVT1 supplies verified kill pairs;
the reviewed resolved-variant subset supplies some rules. These are H1-native
metrics, not Xbox-equivalent attribution. See `COMPATIBILITY.md` for limits,
missing/partial coverage and the conservative pre-end PGCR boundary.

- Image: `283279960672.dkr.ecr.us-east-1.amazonaws.com/halospawns-h1-film:native-analytics3-20261009-r1`.
- Digest: `sha256:45a12e7ba1889f1dc178c28b0be9f34c4a650bc22217484a8e9cd67f856e857c`;
  ECR compressed size 272,575,698 bytes. Old release tags were not overwritten.
- Retained simulation profile/WASM/glue and viewer revision 2 are unchanged.
  Live encoder SHA-256: `ec8b8ace41b5479995b8c5b7491a3b36860d778017d72fe9d6162fdf68709121`.
- Compatible API `live=174`, commit `08e0609`, run `37947628446`; compatible
  frontend `93f954b`, run `37965521776`, were already deployed. This release
  did not deploy either application or the API's later local column-flag work.
- Only `map-processing` changed: **0 adds / 1 in-place update / 0 destroys**,
  solely the H1 Lambda image. Its 3,008 MiB memory, 900-second timeout, 8,192 MiB
  temporary storage, concurrency 1 and enabled batch-one mapping are unchanged.
  No IAM, queue, source/map pin, secret, Xbox consumer, API flag or prod change.
- Focused post-apply plan is no-op. Full pre-apply plan confirmed only that image
  action; the final full plan has no resource actions. API state still reports
  an output-only `173 -> 174` refresh from its earlier code deployment. That
  unrelated output refresh was not applied.
- Live function is Active/Successful with the expected digest. Health returned
  200 in intake mode with the retained engine and new encoder hashes. API flags
  remain true on 174; queue and DLQ were empty. No AWS/profile/session blocker.

Validation: 42 Rust tests (one optional profiling test ignored), 35 H1 Python,
12 Node, 81 shared parser, 154 focused API unit, 11 isolated PostgreSQL and five
mocked Terraform tests pass. Local Linux runs were read-only/non-root, network
disabled, and exercised initial/full-reparse/viewer-rebuild plus three persisted
completion retries. Each film passed all recorded hashes and dual-rate readback:

| Film | Source ticks | Match end | Hash checks | Verified kill pairs |
| --- | ---: | ---: | ---: | ---: |
| Prisoner | 84,367 | 77,811 | 704 | 90 |
| Dread | 75,584 | 73,603 | 630 | 96 |
| Downrush | 80,430 | 77,793 | 671 | 82 |

All three native products passed the actual deployed API commit's schema,
normalization, graph and spatial builders. The deployed frontend's pure native
selectors also accepted all three products, preserving all four metric totals,
series, fractional values and frozen postgame totals without the API's later
local column flags. This is not a hosted browser test. Prisoner also passed complete Linux
runs under explicit revisions 1 and 2. Revision 3 removes 11 postgame shots and
100 PGCR dealt-damage points versus revision 1; final kills/deaths and the full
84,367-tick recording survive. Its viewer artifact is byte-identical to revision
2 (`9afc68ab2f55830b6e2d697560292e5649ab83495d4c12d64c1ddfe8323a93a5`).
Pretty-printed offline callbacks measured 186,278 to 237,301 bytes; these are
local evidence, not Lambda performance or hosted browser acceptance claims.

Private evidence: `L:/tmp/halospawns-h1-native3-20261009`, including build/publish,
plan/apply, test logs, offline callbacks and live health. Release commands:

```powershell
.\scripts\publish-h1-film.ps1 dev -Tag native-analytics3-20261009-r1 -EngineRoot .build/h1-film-9c8c68566d1b4e57b571201bc6c57035 -PreviousRegistry L:/tmp/halospawns-h1-native3-20261009/previous-registry.json -BuildOnly
.\scripts\publish-h1-film.ps1 dev -Tag native-analytics3-20261009-r1 -EngineRoot .build/h1-film-9c8c68566d1b4e57b571201bc6c57035 -PreviousRegistry L:/tmp/halospawns-h1-native3-20261009/previous-registry.json
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' test -no-color
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:/bens_stuff/projects/halospawns-infra/components/terraform/map-processing' apply -no-color dev-map-processing.planfile
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Changed files: `stacks/dev.yaml`; `encoder/src/{main,analytics,native}.rs`;
`{analytics,cloud,recorded}.py`; `convert.mjs`, `runtime/convert.mjs`; job,
completion and native-product schema snapshots; `tests/test_{cloud,native,recorded}.py`;
`tools/{snapshot-api-contract,verify-api-products,verify-cloud}.py`; compatibility,
README, deployment, migration and handoff documentation. No API/frontend runtime
file was changed by this release.

### Existing game and remaining gates

No upload or hosted reparse was submitted. The existing game
`3274e229-70d5-469d-b45e-f71dc1f621ce` still needs an authenticated admin request:

```text
POST /v1/admin/replays/e55ffeee-54c5-4763-afce-a9948c75edcd/reprocess
```

```json
{"mode":"full_reparse","h1film_analytics_revision":3,"reason":"H1 native analytics and match-only statistics"}
```

Preserve the original exporter and selected viewer target by omitting exporter
selection. Existing source/map pins and attempt fences remain authoritative.
No permanent admin session was available here. The current frontend request
builder drops revision fields, so its ordinary full-rebuild button alone does
not select revision 3. The owning frontend follow-up is
`20261009-infra-svelte-h1film-reparse-revision-selector` in its `HANDOFFS.md`.
Do not bypass admin authorization or repin the stored conversion directly.

After that bounded reparse, verify scoreboard/native graphs and forward/backward
tail seeking at both viewer rates. Glass, active camo, item runtime state, exact
end-update attribution, rockets fired, headshots and streaks remain separate
retained-exporter work. Do not roll back to the old intake image while v2/revision-3
jobs are outstanding; it cannot process that contract. Coordinate pending jobs
with the API before a rollback, or publish a compatible corrective release.

## Match-only analytics implemented 2026-10-09

Historical local milestone, superseded by the revision-3 deployment above. At
this milestone the worker remained `intake-20261008-r1`. The user requested playable postgame without contributing
to match statistics/events. H1 may also expose richer/alternative native
statistics, not only Xbox-equivalent fields; source-specific API/UI work remains
in the parity handoffs.

The encoder freezes match counters/events and clips the private analytics
sidecar while preserving every viewer tick. Final engine-gated scores survive;
ungated shots/damage/pickup counts stop at the preceding snapshot. End-marker
occupancy is excluded. This conservative 120 Hz cutoff does not resolve action
ordering inside the ending update; exact sub-tick hooks remain future work.
Films without an observed end retain their observed coverage. Boundary details
and partial-film behavior: `COMPATIBILITY.md`.

New output carries analytics revision 2, independent of viewer revision 2.
API locally accepts revisions 1 and 2, bounds revision-2 graph keys to match
coverage, and preserves old reads/completion retries. No simulation profile,
WASM/glue bytes, immutable viewer contracts or aggregate eligibility changed.

Verification:

- 36 Rust tests passed; one opt-in profiling test skipped. Boundary fixtures
  cover end ticks 0/1/3/4/5/8, partial/no-end coverage, final scores, frozen viewer
  counters, retained movement, event clipping and both output rates.
- 24 H1 Python and 12 Node tests passed. The completion schema snapshot matches
  the API model, including revision-1 defaults and revision-2 acceptance.
- All 81 production parser tests passed with a freshly built native extractor.
  Two initial default-viewer-revision failures with an older cached extractor
  disappeared after rebuilding from current source.
- 119 focused API unit tests and six isolated local PostgreSQL cases passed,
  covering persisted availability, idempotency, aggregate exclusion, stale
  reprocessing and revision-1-to-2 promotion. No shared database was used.
- API Ruff, Rust formatting and whitespace checks passed. API source-only Lambda
  packaging passed; it is not a dependency/native-wheel release ZIP or a Linux
  worker container build.
- Prisoner, Dread and Downrush passed all 704/630/671 recorded world hash checks
  with zero hash/seed mismatches and complete 120/30 Hz readback. Comparison
  against retained artifacts verifies all gameplay state unchanged except match
  statistics. Whole-file hashes intentionally change for corrected stats/events;
  local historical `recordedAt` values also differ and are not UTC evidence.
- Prisoner retains 84,367 viewer ticks (703.058333 seconds), with match end at
  tick 77,811 and 19,453 analytics samples. Final shots are 282/245/296/279,
  removing 11 postgame shots. Slot 3 damage dealt is 4,666 instead of 4,766;
  kills/deaths and the 40-50 score are unchanged. Events fall from 968 to 958.
  Native/Python analytics and shared finalization agree offline.

Evidence: `L:\tmp\halospawns-h1-postgame-20261009`, including conversion reports,
complete artifact readback, `comparison.json`, Dread/Downrush comparison reports,
`compare_artifacts.py`, `prisoner-reconciliation-fresh/` and a source packaging
smoke ZIP. No private source/map/engine or generated product is committed.

Primary commands from infra, using the configured Python SDK:

```powershell
cargo test --locked --manifest-path lambda/h1_film/encoder/Cargo.toml --target-dir .build/h1-encoder
cargo fmt --check --manifest-path lambda/h1_film/encoder/Cargo.toml
npm --prefix lambda/h1_film test
.\.venv\Scripts\python.exe -m unittest discover -s lambda/h1_film/tests -q
cargo build --locked --release --manifest-path lambda/h1_film/encoder/Cargo.toml --target-dir .build/h1-encoder
cargo build --locked --release --manifest-path lambda/replay_parser/native/Cargo.toml --target-dir .build/h1-encoder
$env:REPLAY_EXTRACTOR_TEST_BINARY = 'L:/bens_stuff/projects/halospawns-infra/.build/h1-encoder/release/replay-extractor.exe'
.\.venv\Scripts\python.exe -m unittest discover -s lambda/replay_parser/tests -q
node lambda/h1_film/convert.mjs --film 'L:/tmp/halospawns-h1-parity-20261009/source.h1film' --assets 'L:/bens_stuff/xbox mod/Games/H1 Performance Build 2.0 Beta 3' --engine 'L:/tmp/halospawns-h1-film-wasm-20261004/h1-film.js' --encoder .build/h1-encoder/release/h1-film-encoder.exe --trusted-local --analytics --output 'L:/tmp/halospawns-h1-postgame-20261009/prisoner'
.\.venv\Scripts\python.exe lambda/h1_film/tools/reconcile.py --conversion 'L:/tmp/halospawns-h1-postgame-20261009/prisoner' --film 'L:/tmp/halospawns-h1-parity-20261009/source.h1film' --extractor .build/h1-encoder/release/replay-extractor.exe --output 'L:/tmp/halospawns-h1-postgame-20261009/prisoner-reconciliation-fresh'
```

Dread/Downrush used the same converter options with their retained source films
and separate outputs. API tests used isolated `uv run --no-project` with the
configured infra SDK and `--with` the API's `[dev]` package: `pytest
tests/unit/test_h1films.py tests/unit/test_h1film_routes.py
tests/unit/test_h1film_map_reviews.py -q`. PostgreSQL used
`HALOSPAWNS_TEST_POSTGRES=1` and `pytest tests/integration/test_h1films_postgres.py
-k 'full_completion_persistence or reprocess_fences' -q`.

Changed runtime files: `encoder/src/main.rs`, `encoder/src/analytics.rs`,
`runtime/convert.mjs`, `analytics.py`, `cloud.py`, the completion schema snapshot,
plus tests/docs. API changes: `schemas/h1films.py`, `services/h1film_ingest.py`,
tests/docs. Svelte only has an updated handoff; no frontend implementation yet.

Release order: publish compatible API code, build/test a new immutable worker
image with every retained engine, review focused/full dev plans, then apply the
reviewed H1 image update. Full-reparse the existing game to repair stored stats,
graphs and spatial products together, then verify hosted scoreboard/graphs/tail
seeking. Viewer-only rebuild cannot repair stored match statistics.
No Terraform component/resource, stack pin, secret, hosted data or prod change
was made. No plan/apply or cloud reprocessing command ran; no AWS session was
needed. Container publication and hosted browser/reparse acceptance remain open.

## Dev preview enabled 2026-10-09

The user's explicit request to enable flags for their single-user dev environment
supersedes the earlier requirement to wait for all acceptance gates in dev only.
It does not approve maps, waive identity/hash validation, complete the acceptance
handoffs or authorize prod activation.

- API `H1FILM_UPLOADS_ENABLED=true`, `H1FILM_PROCESSING_ENABLED=true`.
- Provisional API limits: 536,870,912 bytes (512 MiB), 432,000 source ticks
  (60 minutes at 120 Hz), 4 players. These match the unchanged worker ceilings;
  actual Lambda cold/warm/headroom measurements remain outstanding.
- Worker concurrency 1; SQS mapping Enabled, batch 1. Existing immutable image
  `intake-20261008-r1`, resources, IAM, source retention and validation unchanged.
- The existing code updater configuration-promoted `live=172 -> 173` with
  unchanged application code SHA-256. No new API artifact/image was published.
- `app-api`: planned/applied **1 add / 3 updates / 1 destroy**. The replacement
  is the configuration-invocation bookkeeping resource, not a Lambda replacement.
  `map-processing`: **0 adds / 2 updates / 0 destroys**, only H1 concurrency
  and its mapping. All other dev components were no-op; final full plan is no-op.
- Verification: 14 app-api and 5 map-processing mocked Terraform tests pass;
  live flags/limits, worker image/concurrency/mapping, empty queue/DLQ verified.
  Health 200, unsigned ingest and unauthenticated admin reads 401. A correctly
  signed read-only resolver probe for a nonexistent scenario returns
  `404 missing_map`, passing the enabled gate without a write.
- No film upload/conversion/reprocess or map approval was submitted. Approve
  compatible maps via the user's admin UI before expecting film resolution.
  No schema, workflow, credential, Xbox consumer or prod change; no AWS blocker.

Implementation change: `stacks/dev.yaml`, `app-api.h1_film` and
`map-processing.h1_film`. Commands from the infra repo root:

```powershell
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\app-api' test -no-color
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\map-processing' test -no-color
.\scripts\plan.ps1 dev app-api
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\app-api' apply -no-color dev-app-api.planfile
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\map-processing' apply -no-color dev-map-processing.planfile
.\scripts\plan.ps1 dev
```

Generated plan/apply logs: `.build/h1-enable-*-20261009.log`. Saved plans were
inspected for exact resource/settings scope before apply. The initial test
commands using a forward-slash `-filter` selected zero tests on Windows; the
unfiltered commands above reran both complete component suites successfully.
The existing foundation audit intentionally expects dormant controls and is not
an enabled-state acceptance check. Do not restore zero concurrency merely to
make that historical audit pass.

Rollback, if requested: set both API flags false and apply `app-api` through
the updater, then set the H1 mapping false/concurrency zero and apply
`map-processing`. Preserve map approvals, source pins and completed artifacts.

## Dev intake wiring deployed 2026-10-08

The user cleared this infra phase while the API/frontend dev releases were in
progress. This supersedes the health-only foundation described below; it does
not imply that the remaining activation gates have passed.

| Setting | Historical 2026-10-08 value (enablement above supersedes gates) |
| --- | --- |
| Account / region | `halospawns-dev` / `283279960672` / `us-east-1` |
| Function / image | `halospawns-h1-film-dev` / `intake-20261008-r1` |
| Image digest | `sha256:9d353a97efc497f58dc9db92f39e2b07e3f59f509e00c1079bd2c5cae501354c` |
| Resources | 3,008 MiB memory, 8,192 MiB temp, 900-second timeout |
| Worker gate | Intake mode configured; reserved concurrency **0** |
| Mapping gate | **Disabled**, batch 1, partial batch failures |
| API gates | `H1FILM_UPLOADS_ENABLED=false`, `H1FILM_PROCESSING_ENABLED=false` |
| Queue | `https://sqs.us-east-1.amazonaws.com/283279960672/films-processing-queue` |
| SNS topic | `arn:aws:sns:us-east-1:283279960672:films-uploaded-topic` |
| DLQ | `films-processing-dlq`, redrive after 4 receives |
| Queue timing | 5,400-second visibility, 7-day retention |
| Source / bucket | `films/unprocessed/` in `uploads-dev-283279960672` |
| Derived products | Private `films/derived/`; viewer/spatial use existing `replays/derived/` contracts |
| HMAC identity | `h1-film` |
| HMAC parameter | `/halospawns/dev/app-api/trusted-clients/h1-film/hmac-secret` |

The HMAC parameter was absent and was externally seeded as a standard-tier
`SecureString` with `alias/aws/ssm`. Its value was never printed or supplied to
Terraform. The path above replaces the API handoff's earlier proposed
`trusted-services/.../hmac` path and follows existing infra conventions.

`uploads-ingest` owns the disjoint S3/SNS/SQS route and alarms. Film source
versions are exempt from the generic noncurrent unprocessed-object expiration;
the worker neither moves nor deletes them. CDN access was not broadened.
`app-api` supplies exact film upload/version-download, queue-send and SSM
permissions plus JWT-free POST `/v1/ingest/h1films/prepare` and
`/v1/ingest/h1films/resolve-map`. These routes still require application HMAC.
The existing code updater configuration-promoted API `live=170` from `169`.
Both unsigned probes returned `401 unauthorized`; both signed probes returned
`403 capability_disabled`. No source upload, job, DB mutation or conversion
was part of these probes. API admission limits remain unset while disabled.

`map-processing` owns the image update, disabled mapping and scoped worker IAM:
versioned film/raw-map reads, derived-product writes/manifest reads, bounded
viewer-prefix listing, films queue consumption, exact HMAC parameter read and
its own logs. There is no input write/delete, database credential, function URL
or invoke policy. Xbox/map/renderer consumers remain enabled and unchanged;
the Xbox image stays `first-person-r2-default-20260928`.

### Map review access applied 2026-10-09

Handoff `20261008-api-infra-h1film-map-review-access` is implemented in dev.
`app-api/data.tf` adds only `s3:GetObject` and `s3:GetObjectVersion` on
`arn:aws:s3:::uploads-dev-283279960672/maps/unprocessed/*` to the API execution
role. It depends on H1 contract adoption, not upload/processing activation.
There are no new listing, write, delete, credential, environment or gateway
permissions. Admin candidate/history/preview/approval continue through the
existing JWT-required default route.

The focused and aggregate pre-apply plans showed exactly **0 add / 1 change /
0 destroy**, an in-place API inline policy update. The five other components
were no-op. Apply matched that plan; focused and full post-apply plans are no-op
in all six components. API `live=171` and its code hash were unchanged; no
publication or alias promotion was necessary for a shared execution-role policy.
Both API H1 flags remain false, the worker mapping disabled and concurrency zero.
The expired dev SSO session was renewed; no remaining AWS/profile blocker.

Validation: all 14 app-api Terraform tests pass, including disabled-capability
review access, the exact action/resource scope, no grant without H1 adoption,
and no new admin JWT exceptions. Live role-policy inspection and IAM simulation
allow both raw-map read actions. They deny bucket/version listing, raw-map
delete/version-delete/ACL/tag mutation, reads/writes of failed or similarly
named unrelated prefixes, and another bucket. Existing map-upload PutObject
permission predates this change and was deliberately preserved.

Historical storage observation: an operator read-only S3 listing returned
**zero current objects** under `maps/unprocessed/`. A sampled staging key,
`maps/unprocessed/0c142af0-161b-4b7e-8e4b-e021dc81276c-temple.map`, has a latest
delete marker. Current HEAD returned 404; HEAD of version
`oKq5KQ4G2gwYBbhgziQ3DRFrfCNtmn7t` returned 78,000,644 bytes. These HEADs used
the dev operator identity; API-role access was checked with IAM simulation,
not an authenticated admin UI request. The user owns the approval smoke.

Correction (2026-10-09): staging deletion is expected. Normal processing copies
the original to `maps/processed/<upload_id>/<original-filename>.map`, registers
that key as `map_files.file_role = 'original'`, then deletes the upload staging
key. The metadata `original_s3_key` is historical, not the review source. A
subsequent read-only database/operator HEAD audit found all 40 Beta 3 catalog
originals readable under `maps/processed/`, with current immutable versions and
catalog-matching sizes. No recovery/reupload or catalog rewrite is needed;
HEAD did not verify hashes, geometry or live API-role/admin-session access.

At this access-only checkpoint, the API staging-only restriction was corrected
locally pending release. Current processed-object reads already existed, but
exact-version inspection still needed processed-prefix `s3:GetObjectVersion`.
The worker already accepted and could read these versions. Completed follow-up:
`20261009-api-infra-h1film-retained-map-sources` in `HANDOFFS.md`.

Lifecycle is unchanged by this access-only apply (7-day unprocessed noncurrent
expiry / 30-day processed noncurrent expiry). Durable retention must protect
the **processed original** versions pinned by H1 bindings.
`pipelines.maps.preserve_source_versions` suppresses only unprocessed expiry,
not the independent processed rule. The retained-source apply below resolves
processed-original retention without restoring/copying/reuploading objects or
seeding approvals.

Exact plan/apply commands from the repo root:

```powershell
.\scripts\plan.ps1 dev app-api *> .build/h1-map-review-app-api-plan-20261009.log
.\scripts\plan.ps1 dev *> .build/h1-map-review-dev-preapply-20261009.log
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\app-api' apply -no-color dev-app-api.planfile *> .build/h1-map-review-app-api-apply-20261009.log
.\scripts\plan.ps1 dev app-api *> .build/h1-map-review-app-api-postapply-20261009.log
.\scripts\plan.ps1 dev *> .build/h1-map-review-dev-postapply-20261009.log
```

Changed code/test files: `components/terraform/app-api/data.tf` and
`components/terraform/app-api/tests/asset-delivery.tftest.hcl`. The migration
log and both repos' handoffs record completion and the corrected source contract.
No worker image, lifecycle, source object, map approval, Xbox consumer or prod
resource was changed.

### Retained map sources applied 2026-10-09

Handoff `20261009-api-infra-h1film-retained-map-sources` is complete in dev.
Normal review sources are the catalog's original-role files under
`maps/processed/<upload_id>/<original-filename>.map`, not deleted staging keys.
The API's existing H1 inspection statement now covers both configured processed
map assets and legacy `maps/unprocessed/*`. The effective new permission is
processed-prefix `s3:GetObjectVersion`; current reads already existed. There is
no suffix restriction, so mixed-case `.MAP` remains supported. The other 15
policy statements, gateway routes, environment and credentials are unchanged.

Retention decision: `pipelines.maps.preserve_processed_versions: true` in dev
suppresses both generated processed-map lifecycle rules: noncurrent expiration
and expired-delete-marker cleanup. The new per-pipeline option defaults to
false, preserving other stacks' existing behavior. All existing and future
versions under `maps/processed/` are exempt from lifecycle expiration, including
originals, GLBs, JSON and screenshots. S3 lifecycle filters do not offer a file
extension suffix selector; keeping this existing prefix requires no object
retagging, copying or catalog migration. See
[AWS lifecycle filters](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-filters.html).

This deliberately retains old derived assets too: storage now grows with
overwrites/reprocessing instead of reclaiming those versions after 30 days.
Any later selective cleanup needs a coordinated pin-aware retention contract.
This is lifecycle protection, not Object Lock: it does not prevent authorized
explicit version deletion or recover previously expired objects. Legacy staging
noncurrent expiry stays at 7 days; existing staging-only preservation does not
protect processed originals. Do not treat legacy staging pins as durably
retained without a separate review. The initial 40-map Beta 3 batch uses retained
processed sources.

Reviewed plans and applies each changed **0 add / 1 update / 0 destroy** in
`uploads-ingest` and `app-api`, respectively. The full pre-apply plan had no
other resource changes. A concurrent API release advanced version `171 -> 172`;
the API apply only refreshed that output and changed the shared role policy,
with no code publication or alias promotion. Focused post-apply plans and the
final six-component dev plan have zero resource or output changes.

Validation:

- All 14 app-api and 9 uploads-ingest Terraform tests pass. Mocked apply checks
  the resolved lifecycle, including ancestor/child-prefix expiry overlap, and
  verifies default and staging-only preservation remain backward-compatible.
- Live lifecycle comparison removed exactly `maps-processed-retention` and
  `maps-processed-expired-delete-markers`; all other 21 rules are identical.
  No enabled expiration rule overlaps `maps/processed/`; bucket versioning is
  enabled. Replay, film, failed-object, staging and multipart policies remain.
- Live role inspection and 28 IAM action/resource simulation decisions pass:
  current/versioned processed and legacy reads (including uppercase `.MAP`),
  existing GLB reads and legacy upload writes; denials for processed mutations,
  bucket/version listing and unrelated prefixes/buckets. No extra grants added.
- Operator current and exact-version HEAD of the retained Temple original
  returned unchanged version `5TtpO_p2iMlr6EtV6nFkxWfqQTqwSw7s`, 78,000,644 bytes.
  The historical staging version above is also still readable. These are
  operator HEADs plus role simulation, not live admin-session acceptance or
  raw-byte/hash/geometry verification. The API-owned audit of all 40 catalog
  originals remains separate evidence; no source or catalog was changed here.
- Anonymous CloudFront HEAD of the existing Temple GLB is 200 (20,595,848 bytes);
  its original `.map` is still 403. The worker's live read-only audit passes
  unchanged: image `intake-20261008-r1`, scoped version reads, disabled mapping,
  concurrency zero, no function URL or invocation policy. API `live=172` has
  both H1 flags false and the default route remains JWT-required.

No AWS/profile/session blocker remains. API/frontend release verification and
the user's hosted admin preview/approval smoke remain separate; echo the
server-filled preview unchanged, never reconstruct a staging path. No approvals,
film jobs, engine releases, object restores or prod changes were made.

Exact plan/apply and audit commands from the repo root:

```powershell
.\scripts\plan.ps1 dev uploads-ingest *> .build/h1-retained-maps-uploads-plan-20261009.log
.\scripts\plan.ps1 dev app-api *> .build/h1-retained-maps-api-plan-20261009.log
.\scripts\plan.ps1 dev *> .build/h1-retained-maps-dev-preapply-20261009.log
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\uploads-ingest' apply -no-color dev-uploads-ingest.planfile *> .build/h1-retained-maps-uploads-apply-20261009.log
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\app-api' apply -no-color dev-app-api.planfile *> .build/h1-retained-maps-api-apply-20261009.log
.\scripts\verify-h1-film-foundation.ps1 -Tag intake-20261008-r1 -Mode intake *> .build/h1-retained-maps-worker-audit-20261009.log
.\scripts\plan.ps1 dev uploads-ingest *> .build/h1-retained-maps-uploads-postapply-20261009.log
.\scripts\plan.ps1 dev app-api *> .build/h1-retained-maps-api-postapply-20261009.log
.\scripts\plan.ps1 dev *> .build/h1-retained-maps-dev-postapply-20261009.log
```

Changed implementation files: `components/terraform/app-api/data.tf`, its
`tests/asset-delivery.tftest.hcl`, `components/terraform/uploads-ingest/locals.tf`,
`variables.tf`, its `tests/asset-delivery.tftest.hcl`, and `stacks/dev.yaml`.
Documentation: this runbook, root migration log/handoffs, and the API repo's
handoffs, roadmap and map-review contract. Local generated audit evidence is
under `.build/h1-retained-maps-*20261009*`; no generated plans are committed.

### Runtime and validation

`worker.py` / `cloud.py` accept only the configured SQS/SNS origin or pinned API
job schema, verify version/size/hash/envelope/profile, and call API prepare to
obtain the immutable raw-map/engine/job identity. They reuse the unchanged
production parser, revision-2 container assembler, immutable product writer,
spatial writer and completion-persistence implementation. Only the 120 Hz
playable artifact is uploaded; the 30 Hz compact is generated locally for
cross-rate verification, and site analytics remain 30 Hz. Both viewer-only
and full-reparse callbacks carry the API's typed proof and generation fences.

Downloads, SDK/HTTP waits, logs, workspace and conversion process groups are
bounded; conversion reserves 180 seconds for finalization. Child environments
omit AWS/HMAC credentials and loader injection variables. Pinned Node glue uses
explicit filesystem permissions; a narrow compatibility preload exposes public
`fs.constants` without granting arbitrary `process.binding` access. These are
least-privilege controls, **not an OS security sandbox**. Lambda does not provide
the local test's network namespace isolation. Broader hostile-input/resource
testing remains an admission gate; there is no arbitrary command/path API.

The closed viewer manifest requires a `recordedAt` value although films have no
authoritative UTC. The worker uses deterministic sentinel
`1970-01-01T00:00:00Z` solely for that format constraint. `game.started_at` and
`ended_at` remain null, and availability marks UTC unknown. Frontend must not
present the sentinel as a real date or infer recording UTC from filename/mtime.
All H1 analytics remain partial and excluded by API policy from shared aggregates.

Validation passed:

- 21 H1 Python, 81 production parser/native tests in the new image, 12 Node,
  33 Rust tests (one opt-in profiling test ignored), and 26 Terraform tests
  across `uploads-ingest`, `app-api` and `map-processing`.
- Terraform validation, Ruff `E9,F,I`, PowerShell syntax, `git diff --check`,
  retained-engine audit and non-root/read-only Lambda-runtime health/rejection.
- Real Dread/Downrush offline worker runs: exact versioned local S3/API stand-ins,
  real engine/encoder/parser/finalizer, all three product modes, and persisted
  completion retries through bootstrap and direct jobs without reconversion.
  All resulting jobs/completions validate against actual API Pydantic models;
  graph/spatial builders pass. These fixtures contain fake identities and must
  never be POSTed to dev.
- Read-only AWS audit confirms digest, environment, scoped IAM, disabled mapping,
  zero concurrency and no URL/invoke policy. Films queue has zero visible or
  in-flight messages. Final aggregate dev plan is no-op in all six components.

Local smoke evidence (two CPUs, 3,008 MiB Docker limit, read-only root, non-root,
network disabled; not AWS timing or whole-container peak memory):

| Measurement | Dread | Downrush |
| --- | ---: | ---: |
| Source ticks / clean hash checks | 75,584 / 630 | 80,430 / 671 |
| Conversion plus full readback, seconds | 134.71 | 94.09 |
| Whole harness, seconds | 139.52 | 100.33 |
| Sampled conversion process-group peak RSS, MiB | 337 | 343 |
| Initial-job workspace, MiB | 583 | 618 |
| Final 120 Hz viewer bytes | 111,272,685 | 115,780,384 |
| Spawn points / valid spatial events | 63 / 192 | 23 / 165 |

The whole harness includes one conversion, assembly for all three product modes
and completion retry checks, not three complete conversions. Network/cold-start
latency and AWS finalization remain unmeasured. Both runs retain clean simulation
hashes and cross-rate state equality. Canonical upload IDs and the UTC sentinel
change container manifest hashes, so these assembled products are not claimed
byte-identical as whole files to the older native-reference containers.
Private evidence: `L:\tmp\halospawns-h1-layout-20261008\cloud-dread-release` and
`cloud-downrush-2`. Dread used the final image without a runtime-code overlay;
Downrush used the same runtime source with a local test overlay. Compressed
published image size: 272,556,295 bytes. Original pinned engines were not rebuilt.

### Commands and plan results

Exact successful deployment commands from the repo root (all dev):

```powershell
.\scripts\plan.ps1 dev uploads-ingest
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\uploads-ingest' apply -no-color dev-uploads-ingest.planfile
& 'L:\bens_stuff\projects\halospawns-infra\.venv\Scripts\python.exe' scripts/ssm-secret-tool.py --profile halospawns-dev --region us-east-1 --expected-account-id 283279960672 --parameter-name /halospawns/dev/app-api/trusted-clients/h1-film/hmac-secret --description 'Dev H1 film worker to app API HMAC' --environment dev --generate-bytes 32
.\scripts\plan.ps1 dev app-api
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\app-api' apply -no-color dev-app-api.planfile
.\scripts\publish-h1-film.ps1 -Tag intake-20261008-r1 -EngineRoot 'L:\tmp\halospawns-h1-layout-20261008\bundle\engines' -PreviousRegistry 'L:\tmp\halospawns-h1-layout-20261008\foundation-registry.json'
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev *> .build/h1-dev-preapply-20261008.log
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\map-processing' apply -no-color dev-map-processing.planfile
.\scripts\verify-h1-film-foundation.ps1 -Tag intake-20261008-r1 -Mode intake
.\scripts\plan.ps1 dev *> .build/h1-dev-postapply-20261008.log
```

| Component | Reviewed plan | Actual apply |
| --- | --- | --- |
| `uploads-ingest` | 9 add / 5 change / 0 destroy | 9 add / 1 change / 0 destroy; four computed policy reads resolved unchanged |
| `app-api` | 4 add / 4 change / 1 destroy | Same; replacement is configuration-invocation bookkeeping, not API destruction |
| `map-processing` | 2 add / 1 change / 0 destroy | Same; only H1 IAM/mapping/function |

An initial aggregate plan stopped before the new uploads remote-state outputs
existed; it made no changes. A first API plan unnecessarily replaced a managed
policy attachment due to an overly broad dependency; it was not applied, and
the dependency was removed before the reviewed plan above. The pre-apply full
plan then showed only the H1 processing changes, with the other five components
no-op (renderer version output refreshed from a concurrent release). Final
post-apply full planning is entirely no-op. No state manipulation or prod
operation was performed. No AWS/profile/session blocker remains.

Main changed files: `cloud.py`, `worker.py`, Dockerfile, runtime permission/
inspection modules, API schema snapshots/fixtures, verification tools/tests,
`components/terraform/{uploads-ingest,app-api,map-processing}`, `stacks/dev.yaml`,
the read-only audit script and cross-repo handoffs. Shared Xbox runtime code was
not changed. API/frontend application deployment remains owned by those repos.

### Remaining acceptance work

Read-only readiness audit on 2026-10-09 verified corrected API `dbd7822` as
`live=172` and frontend site/admin review `4f2f95d` deployed (runs `37886797287`
and `37885702044`, respectively). The migration and three H1 RLS tables are
present. The 40 Beta 3 candidates are catalog-ready, but there are zero reviewed
bindings, H1 uploads, conversions, completions and replay rows. Current/versioned
map-read IAM and processed-version lifecycle retention pass live checks.
The pinned intake audit passes with zero concurrency/disabled mapping; queue
and DLQ are empty. Both API flags remain false and measured limits unset.
That audit preceded the explicit dev enablement above. Deployment and dev flags
are now complete, but the following validation remains before broader rollout:

1. Obtain API/frontend readiness and existing revision-2 browser acceptance;
   verify artifact-bound 120/120/30 clocks, same-session 120 -> 30 -> 120, and
   unknown UTC/partial analytics behavior on desktop/mobile.
2. Review exact hosted map IDs/releases, original S3 versions/hash/size and
   corrected GLB hashes through API `POST /v1/admin/h1film-map-bindings`. No local
   test UUID or filename-only lookup establishes a hosted binding. Processed
   version-read IAM and durable lifecycle retention are deployed under
   `20261009-api-infra-h1film-retained-map-sources`; normal originals and all
   derived versions under `maps/processed/` no longer expire. Legacy staging
   noncurrent versions still expire after 7 days and need separate retention
   review if selected. Compatible API/frontend releases are verified; complete
   the user's hosted preview/approval smoke. HEAD does not prove geometry or
   source hashes. No approval has been seeded by this infra work.
3. Measure actual Lambda cold/warm duration, memory, temp and finalization
   headroom using reviewed inputs, plus partial/non-Slayer/hostile-input fixtures.
   Refine API and worker size/tick/player limits from those measurements,
   no larger than 512 MiB / 432,000 ticks / 4 players. Current API/worker ceilings
   are explicitly provisional for the user-authorized dev preview, not measured.
4. Coordinate a bounded test on the enabled single-worker dev path. Verify
   bootstrap/full completion, canonical
   owner download, DB/graph/spatial reads, browser playback, both admin modes,
   stale/duplicate completion, SQS drain and DLQ monitoring. Record that evidence
   before broader rollout; do not submit Xbox rebuilds to test this path.
5. Keep semantic availability exclusions until their evidence is reconciled;
   retain every supported engine and old job/map pin in later releases. Prod
   requires separate authorization and its runbook prerequisites.

## Dev foundation deployed 2026-10-08

Historical first stage, superseded by the intake wiring above. Values and
commands in this section describe the earlier foundation release, not current IAM.

- Account/region: `halospawns-dev` / `283279960672` / `us-east-1` only.
- Function: `halospawns-h1-film-dev`, Image / x86_64, Active / Successful.
- Private ECR: `halospawns-h1-film`, immutable release tag
  `foundation-20261008-r1`, resolved and pinned by Terraform to
  `sha256:8254713c182746576db0c192f097365e7f81b0a7113cc24ed5428564cbb7e2c9`.
- Runtime: 3,008 MiB memory, 8,192 MiB `/tmp`, 900-second timeout.
  AWS rejected the initial 4,096 MiB request with this account's 3,008 MiB
  memory cap; no quota increase was requested. Actual Lambda resource/time
  benchmarking remains pending.
- Reserved concurrency is **zero**, with no provisioned concurrency, source
  mapping, function URL, invocation policy, schedule or upload notification.
  No H1 queue exists yet. No application producer or API configuration changed.
- Execution IAM permits only CreateLogStream/PutLogEvents for its own 14-day
  log group. There is no S3, SQS, SSM, API secret or database access.
- The image contains the pinned Beta 3 WASM/glue, current Linux static encoder
  and local Node conversion tools. It omits game maps/source and the Python
  finalizer. The health-only handler rejects all job/record/path-bearing events.
  It cannot process uploads even if someone manually raises concurrency.
- Terraform owns releases directly. The existing ZIP code updater was not
  modified and cannot publish this container. Prod is disabled by default and
  explicitly rejected by the foundation resource guard.

This stage is intentionally independent of the ordered **activation** work
below. Enabling ingestion still requires the API job/map contract, security
hardening, shared finalization, reconciled analytics/availability, viewer
readiness, dedicated queue/DLQ/routing and narrowly scoped credentials. Keep
the future input prefix disjoint from `replays/unprocessed/`.

Validation:

- Eleven Node tests passed, including fail-closed job rejection; PowerShell
  syntax and Terraform validation passed.
- Pinned engine-retention audit and Linux executable health passed at image
  build time. Local Lambda runtime-interface tests passed on a read-only root
  filesystem as a non-root user, including job/extra-field rejection.
- Both films ran through this exact image locally with networking disabled.
  All four compact outputs (Dread/Downrush at 30/120 Hz) are SHA-256 identical
  to the existing native references; 630/671 world-hash checks, zero mismatches.
  Both private 30 Hz analytics sidecars were generated. The runs took 84.38 /
  56.04 seconds total with a two-CPU Docker limit and Windows bind mounts;
  these are packaging checks, **not** AWS performance measurements.
- `scripts/verify-h1-film-foundation.ps1 -Tag foundation-20261008-r1` confirms
  the actual AWS digest, zero concurrency, no mappings/URL/invoke policy and
  log-only IAM. No AWS film conversion or pipeline upload was performed.

Evidence: `L:\tmp\halospawns-h1-dev-foundation-20261008`.
Published compressed image size: 153,846,816 bytes. Storage remains billable;
zero reserved concurrency prevents event execution, rather than relying on
producers being absent. See [AWS concurrency controls](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html).

Exact provisioning commands from the repository root:

```powershell
.\scripts\plan.ps1 dev ecr
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\ecr' apply -no-color dev-ecr.planfile
.\scripts\publish-h1-film.ps1 -Tag foundation-20261008-r1 `
  -EngineRoot 'L:\tmp\halospawns-h1-layout-20261008\bundle\engines'
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
terraform '-chdir=L:\bens_stuff\projects\halospawns-infra\components\terraform\map-processing' apply -no-color dev-map-processing.planfile
```

ECR plan/apply: 2 additions, no changes/deletions. Initial processing plan:
4 additions, no changes/deletions; apply created the role/policy/log group
before the memory-cap error. After pinning 3,008 MiB, re-ran the focused plan
and saved-plan apply: 1 addition, no changes/deletions. Existing consumer
resources were no-op. Pre-apply aggregate dev planning found only H1 resource
additions and unrelated API output drift `app_lambda_function_version`
`164 -> 168`, which was not applied. Final focused `map-processing` and full
dev plans have zero resource actions: `ecr`/`map-processing` and the other
foundation components are no-op, with only that unchanged API output drift.
No AWS profile/session blocker remains. The account memory cap was handled
with the explicit dev stack value, not an account-wide change.

The installed Atmos 1.216.0 ignored `apply --from-plan` in this session and
attempted an interactive apply, which failed at EOF without changes. Its
explicit `plan -out=...` attempt also failed argument parsing. Normal script
plans produced the expected files. After checking their JSON action lists
and dormant settings, applied those exact saved plans with native Terraform
`-chdir`. No state manipulation or unrelated apply was used.

## Deployment choice

Keep the implementation in `halospawns-infra` initially. Use a dedicated H1
worker function with the existing replay finalization implementation, rather
than duplicating that implementation in a new Node service. Its engine still
runs in Node/WASM; the intake image invokes Node and the Rust
encoder/extractor as bounded child processes. The existing Xbox worker and
its release pin should remain independent during adoption.

The worker uses an immutable container image deployed by infra,
following the existing replay-parser pattern. `map-processing` owns the
function/IAM/event mapping, `uploads-ingest` owns its input queue/DLQ/prefix
routing, and `ecr` owns its repository. Do not create a root Terraform module.
Do not put the H1 code behind an already-enabled Xbox consumer before the
source-format routing contract exists.
The applied `films/unprocessed/` prefix is disjoint from the existing
`replays/unprocessed/` S3 notification; a nested H1 prefix would still trigger
the enabled Xbox consumer. Keep that routing contract in later releases.

A separate `halospawns-replays` repository remains a useful later extraction:
move both source adapters and the shared analytics/finalizer together, or
publish the shared code as a versioned internal package. The encoder currently
includes this repo's `native/src/viewer.rs` and contract resources by relative
path; copying only `lambda/h1_film` would not be a self-contained release.
Do not fork the projection, analytics or completion-retry implementation.

The existing code updater is an S3 **ZIP** updater, not an ECR-image updater.
Using it requires a new ZIP-managed function, an artifact bucket/prefix,
GitHub OIDC publish role and `live` alias through `lambda-s3-managed` and
`lambda-code-updater`. CI uploads a versioned release ZIP only; the updater
owns publication/promotion. First prove the whole package, including any
bundled Node/Python runtime and native libraries, fits and runs on Linux.
Lambda cannot change an existing function from Image to Zip in place, and
ZIP plus layers must fit the 250 MB uncompressed limit. See
[AWS ZIP deployment](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-zip.html)
and [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).

## Local integration implemented

`convert.mjs --analytics` now additionally writes
`candidate/analytics.30hz.json.zst`. This is a private, non-playable
intermediate, **not** the canonical uploaded replay or a viewer fallback.

- Native 120 Hz compact replay bytes and the optional 30 Hz compact bytes are
  unchanged. All six counter series are observed at 120 Hz before aggregation.
- Analytics positions use every fourth source tick, excluding dead-body
  positions. Existing 30 Hz graphs, occupancy weights and region rollups
  therefore receive their established units. A future full-rate analytics
  contract can replace this adapter without changing the engine profile.
- Final counters include a partial final four-tick interval. Initial graph
  baselines remain separate even for a one-sample film.
- Mode, variant name and teamplay are supplied to normal game/fact extraction.
  Observed match-end duration is separate from retained recording/postgame
  duration. No UTC start time or host/controller layout is invented.
- The stream omits model nodes, weapons and world objects. It is bounded to
  256 MiB raw / 64 MiB compressed, and retains at most one pending sample.
- `lambda/h1_film/analytics.py` verifies film/product hashes, simulation
  completion and map provenance, then adapts the ordinary `ParsedReplay`.
  It is included in the deployed intake image; its consumer remains disabled.
- `reconcile.py` runs both actual Xbox analytics extractors and requires
  identical semantic results. It then uses the existing container assembler,
  immutable viewer writer, spatial writer and finalization payload builder.
  AWS clients are replaced before importing the handler; writes go to local
  files, with no callbacks or database operations.
- `verify-api-products.py` validates that callback through the API's real
  `ReplayIngestRequest` and calls its graph/spatial-event builders without a DB.

## Engine and map identity

`runtime/profiles.mjs` selects an exact format/protocol/tick-rate/build tuple from
the shared `profiles/registry.json` and
pins both the WASM and Node glue hashes. The initial profile is
`h1-performance-beta3-p45-wasm-v1`: format 2, protocol 45, 120 Hz,
`2.0 Public Beta 3 - September 28 2026`. Unknown tuples fail closed. New
versions need a separate reviewed profile and their own deterministic corpus.

`--map-catalog` takes a trusted `halospawns.h1FilmMapCatalog.v1` inventory:

```json
{
  "schema": "halospawns.h1FilmMapCatalog.v1",
  "maps": [{
    "engine_profile": "h1-performance-beta3-p45-wasm-v1",
    "scenario": "dread",
    "size_bytes": 74758912,
    "sha256": "d8de6acf667e104a076a4ebbf9d1b0a028dccb8e19a2cb7a12116363a6bd9382"
  }]
}
```

Hosted bindings can additionally carry an API-owned `map_id` and reviewed
`game_release_key`. Zero or multiple matching build/name/size entries fail;
the downloaded raw cache must match the binding's SHA-256. Format 2 does not
record a cryptographic map hash: this is a reviewed catalog binding plus
clean simulation verification, not a hash recovered from the film.
Never infer a release from the shared `Invader 0.54.2.r4101` compiler string.
GLBs cannot replace the raw `.map` required by simulation.

`tools/catalog-local-maps.mjs` creates an explicitly operator-asserted test inventory
from a local build directory, checking PC v7 cache headers, scenario names,
sizes and hashes. It skips UI/bitmap/sound/localization resources, including
the build's empty `bitmaps.map`. All 40 Beta 3 playable maps were cataloged;
this did not verify their hosted database identities. Cloud raw-map resolution
uses the API-owned pinned contract, not a filename-only S3 search. Reviewed
hosted bindings and their long-term version retention still require acceptance.

## Evidence

Local evidence is under `L:\tmp\halospawns-h1-integration-20261008`.
`dread` and `downrush` contain conversions; `*-finalization` contain complete
offline callback JSON, spatial gzip, reassembled viewer files, reconciliation
reports and API-builder reports. Original film/map/native fixtures were not
modified. The original optimized encoder installation was not replaced.

| Result | Dread | Downrush |
| --- | ---: | ---: |
| Native 120 Hz states | 75,584 | 80,430 |
| Analytics 30 Hz samples | 18,896 | 20,108 |
| Canonical/native compact comparisons | Both rates byte-identical | Both rates byte-identical |
| World-hash checks, zero mismatches | 630 | 671 |
| Participant stat rows | 4 | 4 |
| Spawn coordinates | 63 | 23 |
| Graph families, each with four players | 6 | 6 |
| Valid kill/death spatial events | 192 | 165 |
| Live occupancy observations | 58,641 | 64,806 |
| Distinct 0.5-unit occupancy cells | 4,974 | 4,925 |
| Compressed analytics bytes | 1,539,642 | 1,658,773 |
| Conversion including analytics, Windows seconds | 44.19 | 30.71 |

These are local functional runs, not new AWS performance measurements.
Final-source repeat runs are in `{dread,downrush}-final-check` and
`{dread,downrush}-final-check-products`, using freshly built encoder/extractor
binaries. Both again passed byte comparisons, parser parity and API builders;
conversion pipeline times were 45.03 / 29.74 seconds. Analytics bytes and counts
were unchanged. The newer reports additionally retain initial counter baselines
and explicitly identify local-only, not-yet-hosted map resolution.
Reassembly changes the manifest replay ID to a test upload UUID, so the
reassembled site's container hash intentionally differs from the original
native-reference file. Its encoded chunks are reused.

Passing the two production extractors proves compatibility of the generated
analytics source, **not** that an Xbox capture of the same match has identical
statistics. The earlier 32-film corpus measured converter performance and
simulation, not this new analytics integration.

## Remaining data reconciliation

Do not enable general site aggregation until these definitions are reconciled
or explicitly represented as unavailable/non-comparable in the API:

| Area | Current H1 evidence | Work still required |
| --- | --- | --- |
| K/D/A, scores, suicides, betrayals | Final engine counters; all-tick deltas | Partial recordings, non-Slayer modes and score-unit fixtures |
| Shots/hits | PGCR totals; shot timeline | Match Xbox counting semantics, especially energy weapons; export per-weapon attribution |
| Damage | PGCR dealt points are rounded; taken includes self/environment damage | Export precise attacker/victim damage; reconcile Xbox attributed/vitality-clamped definition |
| Opponent matrices | Not present | Authoritative kill/death/damage attribution; never pair simultaneous counter increments by guesswork |
| Streaks/multikills | Not present | Export authoritative events/state and verify reset/window rules |
| Powerups | Camo/overshield totals | Export pickup timeline series |
| Variant | Name, mode, teams | Decode/export the full recorded variant, not a name lookup |
| Host/splitscreen | Deliberately omitted | Read original roster/machine evidence, not replay-local seats |
| Time | Relative clocks and observed match end | Authoritative recording timestamp is absent; do not turn filesystem mtime into game UTC |

References: converter `export.c` and `encoder/src/main.rs`, production
`handler.py`, API `services/replay_ingest.py` and
`repositories/replay_ingest.py`, and Xbox producer
`../xqemu-tools/xemu-tools-rs/src/events.rs`. Detailed availability is included
in offline callbacks at `metadata.h1_film.known_gaps`. Merely adding this metadata
does not establish parity. The API now enforces H1 availability/exclusion;
those exclusions must remain until the corresponding evidence is reconciled.

## Ordered rollout work

1. Continue engine analytics instrumentation and paired semantic fixtures above.
   Preserve the clean world hashes and both-rate rendering regressions.
   Re-run representative maps and partial/non-Slayer films, not only the two
   Team Slayer matches. Process deadlines, logs/disk/RSS limits, environment
   isolation and cleanup are implemented; broader hostile header/action/map
   coverage is still required. NODERAWFS/Node permissions are not an OS sandbox.
2. Verify the deployed API handoff `20261008-infra-api-h1film-ingest-contract`: source
   typing, gated presigns, version-pinned raw-map lookup, reprocess routing,
   availability and validated playback-rate metadata. Retain the original
   `.h1film` as canonical source. Do not expose it as a playable Xbox fallback.
3. Complete hosted acceptance for `20261008-infra-svelte-h1film-120hz-viewer`.
   The local harness mutates global config before mounting; hosted support
   must select and reset a session-owned rate through API metadata, with old
   Xbox assets remaining 30 Hz. Released closed manifests stay immutable.
4. Preserve the deployed private immutable Linux image's pinned engine/glue/encoder,
   shared parser and projection contracts. Keep proprietary map/source inputs
   out of public source control. Retain the H1 source adapter at the common
   finalizer boundary; do not teach the Xbox decompressor to guess at film bytes.
   Choose only 120 Hz for the normal hosted viewer output; the local dual-rate
   comparison output is not a requirement to store both representations forever.
5. Keep the deployed dedicated queue/intake **disabled** until the activation
   gates above pass. The function is 3,008 MiB memory, 8,192 MiB `/tmp`,
   900-second timeout and zero concurrency. The mapping uses batch size 1;
   activation must use bounded concurrency. Benchmark 4,096 MiB
   only after an account-limit increase is separately reviewed.
   A Docker quota of two CPUs/2 GiB is not equivalent to Lambda's CPU allocation.
   Reserve time for verification/uploads/callback persistence before the Lambda
   deadline. Measure cold/warm runs and the largest supported film in actual dev.
6. Retain version/hash-pinned downloads, immutable outputs, persisted completion
   retries, stale-attempt guards, HMAC/SSM-only callbacks, DLQ behavior and logs.
   Grant only the needed raw-map/source/derived prefixes and exact parameters.
   Keep converter-derived artifacts out of source notification prefixes.
7. For activation changes, run focused plans, then `scripts/plan.ps1 dev`.
   Publish any new pinned image before updating the function. Coordinate
   API/frontend readiness and existing revision-2 rollout gates before one
   reviewed dev upload. Verify catalog map identity, scoreboard, graphs, spatial
   and region reads, viewer timing, retry idempotency and queue drain, then
   enable bounded consumers. Prod remains separately gated by its runbook.

Standard Lambda invocation timeout is at most 900 seconds; CPU scales with
configured memory. Recheck the [AWS limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
when finalizing deployment. Films outside the reviewed resource/time envelope
need rejection or a separate longer-running compute path, not repeated timeouts.

## Reproduce locally

Use the configured repo Python environment and the existing native extractor.
These commands never contact AWS. Output directories/files must be new.

```powershell
$h1 = 'L:\bens_stuff\xbox mod\Games\H1 Performance Build 2.0 Beta 3'
$out = 'L:\tmp\halospawns-h1-integration-20261008'
node lambda/h1_film/tools/catalog-local-maps.mjs --maps "$h1/maps" `
  --profile h1-performance-beta3-p45-wasm-v1 --trusted-local --output "$out/maps.json"
cargo build --locked --release --manifest-path lambda/h1_film/encoder/Cargo.toml `
  --target-dir "$out/target"
cargo build --locked --release --manifest-path lambda/replay_parser/native/Cargo.toml `
  --target-dir "$out/target"
node lambda/h1_film/convert.mjs --film "$h1/films/<film>.h1film" `
  --assets $h1 --engine 'L:\tmp\halospawns-h1-film-wasm-20261004\h1-film.js' `
  --encoder "$out/target/release/h1-film-encoder.exe" --trusted-local `
  --analytics --map-catalog "$out/maps.json" --output "$out/<new-run>"
.\.venv\Scripts\python.exe lambda/h1_film/tools/reconcile.py `
  --conversion "$out/<new-run>" --film "$h1/films/<film>.h1film" `
  --extractor "$out/target/release/replay-extractor.exe" `
  --output "$out/<new-finalization>"
```

For byte-exact native comparison replace `--trusted-local` with
`--reference <original-native-directory>`; reconciliation then independently
compares both actual compact files with that reference. The API proof script
requires the sibling API's dependencies; the infra environment alone lacks
Pydantic. This isolated command leaves the repository environment unchanged:

```powershell
uv run --no-project --python '.\.venv\Scripts\python.exe' `
  --with 'pydantic>=2.7,<3' --with 'psycopg[binary]>=3.2,<4' `
  --with 'numpy>=1.26,<3' --with 'aws-lambda-powertools>=3,<4' `
  --with boto3 --with jsonschema lambda/h1_film/tools/verify-api-products.py `
  --api ../halospawns-api --finalization "$out/<new-finalization>/finalization.json" `
  --output "$out/<new-finalization>/api-products.json"
```

## Earlier relocation validation

Before cloud intake was added, the relocated source passed these checks on
2026-10-08. Current intake tests and deployment evidence are recorded above.

- Production parser suite: 81 tests passed, including native binary checks.
- Relocated H1 analytics/profile suite: eight Python tests passed.
- H1 encoder/shared codec: 33 tests passed; one opt-in profiling test ignored.
- Film/profile/map/engine-store/source-fingerprint suite: ten Node tests passed.
- PowerShell build-orchestration test passed with a mocked compiler: distinct
  source stages, no candidate overwrite, and changed-input rejection.
- Ruff `E9,F,I` checks and infra `git diff --check` passed.
- Fresh Dread/Downrush conversions selected the retained Beta 3 engine from the
  new private bundle. Both rates matched the original native references exactly;
  analytics bytes, production-parser parity and API graph/spatial results stayed
  unchanged. Evidence: `L:\tmp\halospawns-h1-layout-20261008`.
- The relocated map catalog tool reproduced the original 40-map catalog exactly.

This cleanup reused the pinned WASM binaries. The new build helper's fingerprints,
PowerShell syntax and orchestration were tested; a full Emscripten recompilation
was not performed by the relocation. The subsequent dev foundation above
built and verified the Linux image without replacing the pinned WASM engine.

```powershell
$env:REPLAY_EXTRACTOR_TEST_BINARY = "$out/target/release/replay-extractor.exe"
.\.venv\Scripts\python.exe -m unittest discover -s lambda/replay_parser/tests
.\.venv\Scripts\python.exe -m unittest discover -s lambda/h1_film/tests
cargo test --locked --manifest-path lambda/h1_film/encoder/Cargo.toml `
  --target-dir lambda/replay_parser/native/target
node --test lambda/h1_film/tests/*.test.mjs
.\lambda\h1_film\tests\build-engine.test.ps1
```

Use the freshly built extractor: the older installed September 27 binary failed
two current default-revision tests; rebuilding from existing source resolved
both without changing the extractor implementation. Both fresh integration
binaries remain under the temporary evidence directory, leaving the original
installed converter/extractor binaries untouched.

The earlier relocation/local integration required no Terraform or AWS changes.
The subsequent foundation and disabled dev intake deployments are recorded
above; AWS conversion and hosted viewer validation remain pending.
