# MCC Workshop maps

Dev now has Workshop discovery, content history, exact-map deduplication,
scheduled downloads and durable replay waiters. New map bytes use the ordinary
map-processing pipeline; discovery never grants an engine approval.

**Remaining prerequisite:** the user has no dedicated Steam account/session yet.
A real anonymous SteamCMD probe connected but failed to download MCC item
`2890016882`. Authenticated downloading has not been verified. Failed anonymous
downloads report `auth_required`; pending work remains durable. No actual
Workshop map has been imported into dev during this effort.

This implements the upcoming Beta 8 MAP1 contract; it does **not** register a
Beta 8 simulation engine. That release still needs exact source/exporters,
compatible readers and reviewed map bindings through the existing process.

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
requires a unique eligible reviewed binding intersecting the downloaded
publication's maps. Same-size ambiguity remains explicit; it is not guessed.

Waiting films acknowledge their original SQS delivery after durable observation.
Maintenance re-enters ordinary intake after map ingestion and approval; it never
repins a conversion. Accepted host/client intake takes over further processing.
Upload responses show `waiting_for_workshop` and a sanitized Workshop link.
Game detail projects publication and pinned map hash through its canonical source,
without rewriting game records. Local frontend changes show the waiting message
and a Workshop link in game details.

## Updates and failures

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

Provision a dedicated entitled account through the existing external SSM secret
tooling. Suggested standard SecureString name:
`/halospawns/dev/workshop-maps/steam-credentials`, using the managed SSM key.
The value is JSON with `username` and `password` string fields. Never place values
in Terraform, Git, logs, command arguments or chat. Configure only its name in
`map-processing.vars.workshop_maps.steam_credentials_parameter`, then review/apply
the exact IAM/Lambda environment changes.

The account must support unattended SteamCMD login. Interactive Steam Guard codes
and cached authenticated sessions are not implemented; test actual account/Guard
behavior before declaring downloads operational. Credentials are written only
to a private temporary script; subprocess output stays private and is deleted
with scratch. Cloud output contains error codes only. The API HMAC SecureString
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
- The four API-owned tables are RLS-enabled and inaccessible to ordinary database
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

## Rollback

Disable the schedule/API feature or return H1 default/image to retained r2 using
guarded promotion. Keep additive tables, sources, snapshots, associations, reader
contracts and every retained recipe. Do not purge queues or rewrite history.
