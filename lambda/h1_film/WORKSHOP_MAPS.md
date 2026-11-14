# MCC Workshop maps

Dev now has Workshop discovery, content history, exact-map deduplication,
scheduled downloads and durable replay waiters. New map bytes use the ordinary
map-processing pipeline. All processed MCC multiplayer maps receive automatic
approvals for registered Beta 7+ engines, including existing catalog maps and
future standalone uploads. Workshop association is optional; older and other
engines retain manual review.

**Remaining prerequisite:** the user has no dedicated Steam account/session yet.
A real anonymous SteamCMD probe connected but failed to download MCC item
`2890016882`. Authenticated downloading has not been verified. Failed anonymous
downloads report `auth_required`; pending work remains durable. No actual
Workshop map has been imported into dev during this effort.

This implements the upcoming Beta 8 MAP1 contract; it does **not** register a
Beta 8 simulation engine. That release still needs exact source/exporters,
compatible readers and map bindings. Eligible Workshop maps are automatically
approved once that engine is registered.

## Intake and identity

Source contract: `../h1-arena/docs/FILM_FORMAT_3.md`, MAP1 v1, app `976730`.
Item IDs are lossless decimal uint64 strings. Optional unknown/malformed
provenance is ignored; normal film validation remains strict. `workshop.py`
observes the hash-verified original before a new job is frozen. Frozen jobs and
every old recipe retain their behavior.

The API stores original film source/version/hash, scenario and size. A locator
alone cannot associate an existing uploaded map: downloaded raw SHA-256 and size
must match its original file. Multi-map packages and maps shared by publications
have many-to-many revision associations. New bytes receive ordinary unlisted
map-upload tickets. Normal map validation, GLB generation and support resources
remain required. Exact matches reuse existing map IDs, even if uploaded earlier.

Snapshots live at `workshop/maps/<sha256>.map` in the versioned uploads bucket,
outside temporary-prefix expiry. The API checks bucket/prefix/version/hash/size,
then copies the exact version into `maps/unprocessed/`. The normal engine resolver
filters approvals by engine, scenario, recorded size when present and exact
downloaded publication content when present. Within that scope, non-MCC maps
take priority over MCC fallback maps. Processor cache version `13` or name
`h1a_mcc` identifies the fallback tier, regardless of approval provenance.
The selected tier must contain exactly one eligible binding; same-tier ambiguity
and an ineligible preferred approval still fail closed. Workshop films cannot
fall back to unrelated PC maps, and failed simulation never tries another map.

Approval previews and transfers allow PC/MCC approvals to coexist for the same
scenario and size. Existing jobs retain their exact map pins; reparse preflight
checks the pinned map's tier and Workshop scope. Adding a higher-priority map
later does not repin a game. See [the flow diagram](WORKSHOP_MAPS_FLOW.md).

Waiting films acknowledge their original SQS delivery after durable observation.
Maintenance re-enters ordinary intake after map ingestion and approval; it never
repins a conversion. Accepted host/client intake takes over further processing.
Upload responses show `waiting_for_workshop` and a sanitized Workshop link.
Game detail projects publication and pinned map hash through its canonical source,
without rewriting game records. Local frontend changes show the waiting message
and a Workshop link in game details.

## Updates and failures

API maintenance approves at most four map/engine pairs before redispatching
films. Policy `halospawns.mccMapApproval.v1` covers every processed MCC multiplayer
map for numeric Beta 7 and later profiles in the trusted H1 registry, including
future uploads and engine registrations. It records catalog original/GLB file
IDs, processor classification and immutable source. When Workshop evidence exists,
`halospawns.workshopMccApproval.v1` retains the publication audit and verifies
downloaded revision SHA-256/size/scenario. Both paths require a processed
cache-v13 MCC multiplayer map, current GLB, active release and immutable source.
Existing manual approvals and all retirements are preserved. Ambiguity and
missing evidence stay blocked for review; failures retry after an hour without
holding up other maps. Full replay simulation verification remains mandatory.

Automatic bindings store policy and catalog or Workshop provenance with no human reviewer.
The additive `20261113030000_workshop_map_autoapprovals.sql` migration also adds
the fair approval-check queue. No worker image or replay recipe changes are needed.
Migration `20261113040000_mcc_catalog_autoapprovals.sql` extends the audit constraint
to standalone maps. The existing 15-minute worker schedule scans the whole MCC
multiplayer catalog even with no tracked Workshop items, before Steam login.
Standalone approval does not require Steam credentials. Campaign/UI maps are
outside the multiplayer replay contract.
See the [flow diagram](WORKSHOP_MAPS_FLOW.md) and API runbook for the audit contract.

The worker polls every 15 minutes at concurrency one, claiming one publication
and maintaining up to four map imports and four films per maintenance pass.
Available items become due every six hours (large backlogs can delay checks).
Timestamp changes, including
regression, trigger downloads; forced daily downloads detect unchanged-timestamp
content changes. Before/after timestamp and Steam manifest checks reject a moving
revision. Content manifests and immutable raw bytes retain previous revisions.

Failures back off from 15 minutes to one day. Private/deleted/auth-blocked items
retain their prior successful associations. Historical games retain immutable
map/engine pins; updates never reparse history automatically. An older version
Steam no longer serves cannot be recovered unless its exact bytes are supplied.
Leases last 20 minutes and completions are fenced/idempotent. Failed ordinary map
uploads remain recoverable through the existing audited workflow.

## Worker and credentials

The image pins the official SteamCMD archive checksum. Workshop content is never
executed. Only validated numeric IDs reach SteamCMD, with a fixed app ID. Valve's
fixed HTTPS metadata endpoint disallows redirects and has 30-second/1-MiB bounds:
https://partner.steamgames.com/doc/webapi/isteamremotestorage .

Lambda has 2 GiB memory, 8 GiB scratch and a 900-second timeout. SteamCMD has a
720-second budget with process-group termination, 4 GiB disk/package and 10,000
file limits. Symlinks/special files are rejected. Only multiplayer Halo CE MCC
cache-v13 candidates are imported (128 maps maximum, 256 MiB each). Scenarios come
from map headers, not archive filenames. Other MCC games/campaigns are ignored.
Package support resources are not imported automatically; existing catalog and
support-resource workflows remain required.

Provision a dedicated account through the existing external SSM secret
tooling. Standard SecureString name:
`/halospawns/dev/workshop-maps/steam-credentials`, using the managed SSM key.
The value is JSON with `username` and `password` string fields. Never place values
in Terraform, Git, logs, command arguments or chat. Configure only its name in
`map-processing.vars.workshop_maps.steam_credentials_parameter`, then review/apply
the exact IAM/Lambda environment changes.

Cached SteamCMD authentication uses a separate standard SecureString at
`/halospawns/dev/workshop-maps/steam-session`, configured by
`map-processing.vars.workshop_maps.steam_session_parameter`. The local bootstrap
tool completes Steam Guard and saves bounded, compressed `config/config.vdf`.
The worker restores it in fresh scratch, uses username-only login, and persists
updated authentication state. It cannot write account credentials or the HMAC.
Empty, invalid, expired or wrong-account sessions fail closed without a password
login fallback. See [WORKSHOP_STEAM_AUTH.md](WORKSHOP_STEAM_AUTH.md) for setup,
the download-only probe, recovery and live verification status.

Credentials are written only to a private temporary script or child PTY;
subprocess output stays private and is deleted with scratch. Cloud output
contains error codes only. The API HMAC SecureString
`/halospawns/dev/app-api/trusted-clients/workshop-maps/hmac-secret` is provisioned;
Terraform manages only its name/ARN.

## Administration

- Admin JWT `POST /v1/admin/workshop/items`, body
  `{"app_id":976730,"item_id":"<decimal ID>"}`, tracks ahead of replays or
  brings the next check forward. It does not approve maps.
- Admin JWT `GET /v1/admin/workshop/items/<item_id>` returns state, errors,
  checks, revisions and map/upload IDs (latest 512 history rows). Intake separately
  prioritizes matching associated maps so history bounds cannot hide older maps.
- HMAC `/v1/ingest/workshop/observe` admits `h1-film` and `workshop-maps`.
  `/claim`, `/complete`, `/maintain` admit only `workshop-maps`.
- The API-owned tables are RLS-enabled and inaccessible to ordinary database
  clients. See `../halospawns-api/docs/workshop-maps.md` for contracts.

After provisioning credentials, track a public Halo CE item and invoke
`halospawns-workshop-maps-dev` with `{"action":"poll"}`. Verify snapshot bytes,
ordinary map finalization, dedup against a pre-uploaded copy, a changed version,
and a real Beta 8 film after its engine release. These live canaries remain pending.

## Deployment evidence (2026-11-13)

Dev only: profile/account `halospawns-dev` / `283279960672`, `us-east-1`.
Migration `20261113020000_workshop_maps.sql` applied after a one-migration dry run.
Infra/worker source `1875fe3373041b6e7b1b5117e7875a942a99f3a4`, CI `43517148003`.
Workshop image:
`sha256:23ecf64905635714f7c6e600425c65c28e7de3fb8da42426408c0cc691fb44ef`.
H1 intake r3 image:
`sha256:2abc77b1f4a8a3c77d30bd611d2d4706eff8eebbe092716cb38af9c4a7f827f0`.
The exact r2 base retains six profiles/59 exporters/every recipe; only cloud intake,
the provenance reader and discovery flag change. Live Workshop poll returned
`{"state":"idle"}`, exercising SSM, HMAC, public API and the migrated database.

Eight Workshop worker tests, four JS provenance cases, 120 packaged H1 unit
tests, nine packaged replay cases across all six engines, and the separate client
flow pass. The corpus includes two large eight-player Beta 7 matches. Database
tests cover races/fencing, exact-map dedup, revisions, bounded history, public
provenance and durable host/client intake.

Exact commands from the infra root:

1. `scripts/plan.ps1 dev ecr`, then
   `terraform -chdir=components/terraform/ecr apply -auto-approve dev-ecr.planfile`:
   initially 4 adds; subsequent reviewed IAM update changes 2 resources.
2. `scripts/plan.ps1 dev app-api`, then
   `terraform -chdir=components/terraform/app-api apply -auto-approve dev-app-api.planfile`:
   5 adds, 3 changes, 1 replacement of the configuration invocation, not the API.
3. `scripts/plan.ps1 dev map-processing`, then
   `terraform -chdir=components/terraform/map-processing apply -auto-approve dev-map-processing.planfile`:
   8 adds, no changes/deletions of existing workers.
4. `scripts/complete-h1-film-publication.ps1 -Tag 20261113-r3 -CorpusPath .build/recent-failures-20261113/corpus-r2.json`.

Evidence: `.build/workshop/` and
`.build/h1-contracts/20261113-r3-71281b2b0406494abf1f5beeebf2816a/`.
Guarded promotion `scripts/promote-h1-film.ps1 -Stack dev` activated H1 r3 at
policy **32**, with **API 257**, commit `f0df145bd4792ec73bb9011dfe1d72ae7fb86a33`,
CI `43520092428`. All 27 exact packaged callbacks and the separate client flow
were accepted by that deployed API before apply. Only the H1 image/digest changed
(0 adds, 1 change, 0 destroys); first live inventory health passed. Evidence:
`.build/h1-promotions/20261113-223628-1600dc9aeaa3462a87fd8056bec63ee7/`.

All nine previous viewer artifacts and statistics are identical. The separate
client viewer is identical; its timeline differs only in generated fixture
attempt/artifact IDs. API CI passes 2305 tests (337 skips); six isolated PostgreSQL
Workshop cases pass. Local site validation is 849 existing tests plus five
Workshop identity/link cases; both builds pass with existing chunk warnings.
Terraform tests pass 16 API and 12 worker cases. The stale legacy H1 route-count
assertion was corrected to check required routes and HMAC authorization.

`.build/workshop/refresh-api-state.ps1` reviewed/applied
`terraform -chdir=components/terraform/app-api plan -refresh-only -no-color -var-file=dev-app-api.terraform.tfvars.json -out=L:/bens_stuff/projects/halospawns-infra/.build/workshop/api257-refresh.planfile`.
The saved plan has zero resource actions, recording API output 255 -> 257 and
the already-applied Workshop routes/IAM. The first narrower guard declined those
expected route/IAM refreshes; their fields were reviewed before applying.

Read-only audit retains 378 conversions, 1837 completion receipts and 360 map
approvals. No Workshop records have been created in dev yet. Film queue/DLQ
visible, delayed and in-flight counts are zero. `scripts/plan.ps1 dev` completed
with all six components no-op: tfstate-backend, frontend-site, uploads-ingest,
app-api, ecr and map-processing (`.build/workshop/final-postplans.log`). No AWS
profile/session blocker remains. Frontend remains local/uncommitted; no
production or historical replay action was performed.

## Automatic approval deployment (2026-11-13)

Dev API **258**, source `ed254f54ecaa9019f972bba52f969ce6af22312c`,
[CI 43529931773](https://github.com/Mintograde/halospawns-api/actions/runs/43529931773),
implements the Beta 7+ automatic approval policy. Migration
`20261113030000_workshop_map_autoapprovals.sql` was applied after a dry run showing
only that migration. The CI artifact's SHA-256 matches the live Lambda:
`e2be9c20f7df484c0d3a9f615fa4e9904f12dd522a46332457b527449f78b23a`.
H1/default **20261113-r3**, policy **32**, Workshop worker image, all six engines,
59 exporters and every replay recipe remain unchanged.

Validation: 2313 local API unit tests (six optional native/fixture skips),
2315 CI tests (354 opt-in integration/private-fixture skips), full Ruff, 17 new
automatic-approval PostgreSQL cases, 22 existing manual approval/engine cases,
and six existing Workshop PostgreSQL cases pass. The new cases cover future
registered Beta 8/9 profiles, preuploaded-map reuse, provenance/catalog races,
concurrent idempotence, retirement, retry and explicit human transfer to Beta 6.
The local admin UI displays system policy/publication/revision instead of an
empty reviewer; 36 existing review UI/API tests and the site build pass.

Live `/health`, authenticated maintenance (`imports:0, approvals:0, films:0`)
and the deployed Workshop poll (`state:idle`) pass. Read-only before/after audits
preserve 378 conversions, 1837 receipts, all 360 approval records and 419 total
games; the complete preexisting approval-history fingerprint is unchanged.
Workshop tables remain empty and both film queue/DLQ have zero visible, delayed
or in-flight messages. Authenticated Steam downloads and real imported-map
canaries remain pending account provisioning; these checks do not claim those
paths were exercised live.

`.build/workshop/autoapproval-refresh-api.ps1` verifies the CI artifact identity,
live code hash and saved refresh-only plan before applying the API output
257 -> 258, with zero resource actions. Evidence is in
`.build/workshop/autoapproval-*.log`, `autoapproval-*.json` and
`api258-refresh-*.log`. Frontend changes remain local/uncommitted; no production
deployment or historical replay processing occurred.

The final `scripts/plan.ps1 dev` run is no-op for all six components:
tfstate-backend, frontend-site, uploads-ingest, app-api, ecr and map-processing
(`.build/workshop/autoapproval-final-postplans.log`).

## Catalog-wide MCC approvals (2026-11-13)

Dev API **259**, source `bcca31ddadaff117b534d7137d0010ef74033b8a`,
[CI 43532429480](https://github.com/Mintograde/halospawns-api/actions/runs/43532429480),
extends approval to existing MCC maps and future standalone uploads. Migration
`20261113040000_mcc_catalog_autoapprovals.sql` was applied after a dry run showing
only that migration. The live Lambda hash matches the exact CI artifact.
H1 r3/policy 32, both workers, all six engines and all 59 exporters remain unchanged.

The dev inventory contains 20 MCC multiplayer maps and ten campaign maps. All
20 multiplayer maps passed read-only catalog/S3 previews and now have eligible
Beta 7 bindings under `halospawns.mccMapApproval.v1`. Four approvals were already
present when the bounded maintenance run began; four additional four-map passes
completed the remaining 16. An extra maintenance pass and the deployed worker
poll both return idle. Future direct uploads and future registered Beta 8/9+
profiles are handled by the same scheduled catalog scan, before Steam login.
Campaign/UI maps remain outside the multiplayer replay contract.

All 20 immutable raw versions, source hashes and GLB pins match their previews.
All 360 previous approval records retain their complete audit fingerprint.
Totals are 380 approvals, 378 conversions, 1837 completion receipts and 419 total
games. No game/replay history changed; Workshop items remain zero and both film
queue/DLQ are empty. Tests pass: 2313 local API units, 2315 CI cases (363 optional
integration/private-fixture skips), 26 isolated PostgreSQL approval cases,
36 local review UI/API cases, Ruff and site build. The new database cases cover
standalone uploads, future engines, catalog/classification races, immutable
audits, retirement and manual transfers from either automatic policy.

Evidence: `.build/workshop/mcc-inventory-before.json`, `mcc-previews.json`,
`mcc-backfill-result.json`, `mcc-backfill.log`, `mcc-*.log` and `mcc-queue-audit.json`.
`mcc-refresh-api.ps1` verifies the source/CI artifact and live hash, then applies
only the API output refresh 258 -> 259 with zero resource actions. Frontend
labels remain local/uncommitted. No production deployment or replay reparse.
The final `scripts/plan.ps1 dev` run is no-op for all six components
(`.build/workshop/mcc-final-postplans.log`).

## Map precedence and replay recovery (2026-11-13)

Dev API **260**, source `69a03dd5699c5c21648b6eb88bfd3541c3486b64`,
[CI 43536763475](https://github.com/Mintograde/halospawns-api/actions/runs/43536763475),
implements the non-MCC-first selection policy above. The exact CI artifact and
live Lambda share SHA-256
`ad83f6b43f5fb1c2af466d6543c69a6b575bd6d4646ac4ca59bebbd364a319ac`.
No migration, worker, engine, recipe or frontend deployment was needed;
H1/default r3 and policy 32 remain active.

The two user-reported Beta 7 films recorded zero map size with validated
missing-size evidence. Each matched a PC approval and a newly autoapproved MCC
copy. New intake now selects the PC binding. All 329 preexisting H1 games also
pass a read-only resolver audit with one eligible pinned binding each.

Both original film objects were read at exact S3 versions and SHA-256 checked
against the supplied local files. Fresh ordinary upload tickets preserve the
same owner, bytes and source metadata; the original failed rows remain intact.

| Original failed upload | Fresh processed upload | Recovered game |
| --- | --- | --- |
| `39b4e1b0-c03d-475f-95f4-0d6a8f846570` | `66d8e76a-c52d-486c-9b14-035a9da690da` | Prisoner `f7139de8-e0ef-43b4-994c-012b540a7ba9` |
| `a3770a73-4aa7-4704-be57-0b5e94841080` | `1f2a112d-d9ca-41f2-b818-266565b624a8` | Hang 'Em High `e22522a7-a3a4-46cf-a5ff-31b53f323358` |

Both games have all five host/client worlds available: 748,501 verified ticks,
6,244 hash checks and zero seed/hash mismatches. API game statistics, participant
counts, selected assets, source/map/engine manifest pins, CDN ranges/CORS and both
complete CDN SHA-256 hashes pass. Published v7 artifacts are 118,846,782 and
147,421,859 bytes. The live reparse inventory endpoint also passes.
Real Chrome checks pass for both games at 1440px and 390px: game detail,
paused URL seek/player selection, all five available perspectives, switching
between client worlds and no panel overflow or page errors. Checks compare
aligned authoritative time rather than assuming client clocks equal the host
clock; Prisoner's client recording legitimately differs by five ticks. The
temporary fresh dev server was stopped; frontend source remains unchanged by
this follow-up and existing local frontend work remains uncommitted.

Tests: 2,313 local API unit cases and full Ruff; 164 distinct isolated PostgreSQL
cases across precedence, missing sizes, manual/automatic approvals, engine
transfers, reparse and Workshop ingestion (two optional fixture skips). Fifteen
new cases cover ordering before the result limit, both MCC classification
markers, exact-size filtering, same-tier ambiguity, ineligible/retired bindings,
Workshop scope, immutable replay pins and transfer validation. CI passes 2,315
tests with 378 opt-in/private-fixture skips, native checks and Lambda packaging.

Before/after row fingerprints prove every original conversion, completion,
approval, game and reprocess attempt remains unchanged. Totals are 380
conversions, 1,839 receipts, 380 approvals, 421 total games (331 H1) and 1,835
reprocess attempts (1,512 H1). No historical reparse was dispatched.

Evidence is under `.build/mcc-precedence/`: source/selection plans, separate
creation and dispatch receipts, original-row fingerprints, test/CI logs,
published manifests and live checks. `refresh-api.ps1` verifies the exact
CI artifact/live hash and applies only the API output refresh 259 -> 260,
with zero resource actions. All six dev postplans are no-op; both film queue
and DLQ have zero visible, delayed or in-flight messages.

## Rollback

Disable the schedule/API feature or return H1 default/image to retained r2 using
guarded promotion. Keep additive tables, sources, snapshots, associations, reader
contracts and every retained recipe. Do not purge queues or rewrite history.
Retain the automatic-approval migration and API provenance reader, including
both policy versions and nullable system reviewers. `WORKSHOP_MAPS_ENABLED=false` stops new automatic
approvals; existing decisions remain immutable and can be retired through the
normal admin workflow.
Keep map precedence when retaining the catalog MCC approvals; reverting to the
old resolver would reintroduce PC/MCC ambiguity for films without recorded sizes.
