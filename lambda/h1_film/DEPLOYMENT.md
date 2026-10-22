# H1 film Lambda integration

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
