# MCC Workshop Steam authentication

Dev only: AWS profile `halospawns-dev`, account `283279960672`, region `us-east-1`.
The two standard SecureStrings are externally managed, using `alias/aws/ssm`.
Terraform manages only references and exact worker IAM permissions. Secret bytes
never enter Terraform state, Git, CI inputs or application responses.

## Account and ownership

Use a separate Steam account with a controlled mailbox, a unique password and
Steam Guard enabled. Store the password and recovery information in the owner's
password manager. Do not send passwords or Steam Guard codes through chat.

The 2026-11-14 before/after test established that MCC ownership was needed for
the tested SteamCMD download path. The new account authenticated with a cached
session, but Steam reported `No active license found for appID 976730.` and
rejected Epicenter (`2903623613`) and Chillout Pro (`2899343509`) with generic
`Failure` responses. Both were confirmed public and unbanned through metadata.
Windows platform selection did not change the failure. After the owner added
an MCC license, the same account and cached session downloaded Epicenter and
extracted one eligible CE multiplayer map. Steam then reported license package
`376282`. No password or Steam Guard reauthorization was needed for that retry.
The minimum individual-DLC entitlement has not been tested; do not claim that
the whole collection is the only sufficient purchase. Generic `Failure` or
`access_denied` alone must not be called proof of an ownership requirement.

Sources:
- https://support.halowaypoint.com/hc/en-us/articles/28916975982868
- https://partner.steamgames.com/doc/sdk/uploading#8

Valve documents initial password/Steam Guard authentication and subsequent
cached logins for SteamCMD. The production downloader instead uses SteamKit's
persistent authentication token, as documented by
[DepotDownloader](https://github.com/SteamRE/DepotDownloader/tree/DepotDownloader_3.4.0).
The password is used only by the local bootstrap; scheduled downloads use the
saved session. A new client or revoked session can require Steam Guard again.

## Lambda compatibility

Native SteamCMD is a 32-bit Linux executable. The real Lambda probe terminated
before login with SIGSYS (exit 159), while the same image/session authenticated
locally. The QEMU candidate also crashed locally before login and was never
deployed. The worker now uses the native x86-64 DepotDownloader 3.4.0 release,
with archive SHA-256
`a999dec66b4850fc961bd50366696d23c2d0fad7b18790e6a5647b2f19097a53`.
Its upstream LICENSE is retained in `/opt/depotdownloader/LICENSE`; source is
the linked release tag. SteamCMD remains available for local diagnostics.
No Workshop content is executed. Existing time, disk and package bounds apply.

Version 2 of the bounded session envelope stores the compressed .NET account
store and its validated relative path under `.local/share/IsolatedStorage`.
It contains a persistent authentication token, not the password. Version 1
SteamCMD sessions remain readable but cannot authenticate the new downloader;
rerun bootstrap when switching clients. Both the bootstrap and worker use the
same executable path so .NET restores the same isolated store in fresh scratch.

## Provision and populate

From the repository root:

```powershell
uv run --with boto3==1.40.75 --no-project python scripts/workshop-steam-credentials.py init
```

This account-guarded command creates missing empty slots and never overwrites
existing values:

- `/halospawns/dev/workshop-maps/steam-credentials`: edit privately in AWS to
  `{"username":"<account login name>","password":"<password>"}`.
- `/halospawns/dev/workshop-maps/steam-session`: leave `{}` until bootstrap.

Passwords containing double quotes and backslashes are supported: escape them
as `\"` and `\\` respectively in the SSM JSON. The bootstrap decodes JSON and
sends the original password to the hidden password prompt with PTY echo disabled;
it never places the password in a command argument. Control characters are
rejected. Account names cannot contain quotes or backslashes.
The worker reads credentials and session; only the session is writable by its
role. API, H1 replay workers, frontend and CI do not receive Steam credentials.

## Bootstrap Steam Guard

After the session-capable Workshop image is deployed, run in your own terminal
with Docker Desktop's Linux engine running and your dev AWS session active:

```powershell
uv run --with boto3==1.40.75 --no-project python scripts/workshop-steam-auth.py bootstrap
```

The helper resolves the deployed immutable image, reads the credential parameter,
and transfers credentials directly into a disposable Docker container. It does
not write a host Steam credential file or place passwords/tokens in command arguments.
The downloader receives the account name as an argument inside the private container.
A private temporary Docker configuration holds the short-lived ECR pull token
and is removed afterward. On Windows, its ACL grants access only to the current
user; this avoids desktop credential-store failures in noninteractive sessions.
Container logging is disabled; raw Steam output stays in a private child PTY.
Enter a Guard code at the hidden local prompt, or approve in the mobile app when
requested. Codes are not saved. The helper uploads only bounded compressed login
state to the session SecureString and removes the container, including its cache.
The session must fit the standard 4096-byte parameter; oversized state fails
without silently switching secret backends or truncating tokens.

For an account that does not need a challenge, `bootstrap --non-interactive`
can complete without a terminal. It stops if a code is required. It must not be
used to disable or work around Steam Guard.

## Verify access without importing a map

```powershell
uv run --with boto3==1.40.75 --no-project python scripts/workshop-steam-auth.py probe --item-id 2903623613
```

This invokes the private worker with `{"action":"probe","item_id":"2903623613"}`
(Halo CE - Epicenter, confirmed public and unbanned through Steam metadata).
It checks metadata for app `976730`, restores the SSM session in fresh scratch,
and attempts the real bounded download. It does not claim a job, import maps,
write map snapshots, create replays, or change map approvals. Successful login
can rotate the saved session. Results contain only state/reason, item ID and
the number of eligible CE multiplayer maps. Distinct reasons are
`authentication_required`, `no_subscription`, `access_denied`, or
`download_failed`; an access failure must not be described as proof of ownership.

Run twice to test fresh scratch and reuse of any rotated token. Once successful,
track the item through the admin API and verify ordinary processing, exact-map
deduplication, revisions, Beta 7+ approval and waiting-film resumption. A real
Beta 8 film still requires that engine's independent registration and release.

## Reauthorization and rollback

Expired/missing sessions return `auth_required`; catalog autoapproval maintenance
still runs. Rerun bootstrap after account changes or revocation. Updating the
password parameter alone does not bootstrap or revoke a cached Steam token.
To revoke local worker access, replace the session value with `{}` and revoke
the session in Steam; restore it only through bootstrap. Bootstrap and scheduled
downloads should not overlap. The worker checks the SSM version before saving
updated tokens and skips a save if another writer changed it; SSM does not offer
an atomic compare-and-swap, so this check is not a distributed lock.

Keep the two SecureStrings on rollback. A SteamCMD-only rollback requires a
version 1 session and cannot run native SteamCMD inside this Lambda. Prefer a
previous known-working native 64-bit image. Revert the image and parameter
references together if returning to a worker without session support. Do not
change H1 recipes, map approvals, replay history or the separate API HMAC.

## Live status

Both slots were created on 2026-11-14 and the owner populated the credentials.
The dev worker is deployed from `6d414bfccf85ce3016b4839349b25707cf7cd7b1`,
[CI run 43607651158](https://github.com/Mintograde/halospawns-infra/actions/runs/43607651158),
image digest `sha256:555d2f75f74962844cf3679b02214e51f03032042c350b4ea9e540c29f2b4433`.
The bootstrap saved a version 2 session envelope (SSM version 8); credentials
remain SSM version 3. Both are standard SecureStrings using `alias/aws/ssm`.

Two real Lambda probes, each restoring fresh scratch from the saved session,
returned `download_verified` with one eligible CE multiplayer map. Normal
ingestion then downloaded both again, retained immutable S3 snapshots, imported
them through ordinary map processing and associated their Workshop IDs:

| Item | Scenario | Map ID | Processed upload |
| --- | --- | --- | --- |
| Epicenter `2903623613` | `epicenter` | `bc813207-ce87-4bb2-8299-8ede8c75154d` | `b1e66d2d-b231-4c69-897c-c5b55a8bab11` |
| Chillout Pro `2899343509` | `pat_chillout` | `976c5c63-cf1e-42d6-be3f-1ca01d9fa517` | `3f718460-d1ae-4dbf-b706-f60b50f74d60` |

Their hashes are respectively
`ab08586b4c13128cd26c249e48b6b9940c3c524f0967c7918b6128424521d08d` and
`d46a549e8f205ca39f4850ac1cdf9e2d97aa5c677e251e91597d14085555e6cf`.
Both received `halospawns.workshopMccApproval.v1` approvals for
`h1-performance-beta7-p9844-wasm-v1`; the 380 prior approvals remain, with 382
total. Map count grew from 468 to 470. Tracking used the deployed admin repository
operation with the requesting user's verified existing admin identity; downloads,
completion and maintenance used the normal Lambda/HMAC API path. No fake film
observation, replay reprocessing or engine registration was used.

Validation: 27 worker tests and 15 Terraform tests pass. The component plan was
reviewed and guarded to allow exactly one Workshop Lambda image update:

```powershell
atmos terraform plan map-processing -s dev '-out=workshop-native64.planfile'
# From components/terraform/map-processing after reviewing terraform show -json:
terraform apply '-input=false' workshop-native64.planfile
# From the repository root:
.\scripts\plan.ps1 dev map-processing
.\scripts\plan.ps1 dev
```

Apply: 0 added, 1 changed, 0 destroyed. The focused postplan and all six full-dev
postplans are no-op. Earlier credential plumbing added the exact two parameter
reads and session-only write; no secret value entered Terraform. Memory,
concurrency, schedule, H1 worker/default `20261114-r1`, policy 33 and API 265 remain.
No AWS/session blocker remains; no frontend or prod deployment occurred.
Evidence is in `.build/workshop-steam-auth/`, including the plans, apply log and
`import-before.json` / `import-after.json`.

Live validation of changed Workshop versions, deduplication against an unrelated
earlier standalone upload and waiting-film resumption remains outstanding. The
real Beta 8 film canary requires that engine's independent registration/release.
These are not claimed by the successful download/import/approval tests above.
