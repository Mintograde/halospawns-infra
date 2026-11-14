# MCC Workshop Steam authentication

Dev only: AWS profile `halospawns-dev`, account `283279960672`, region `us-east-1`.
The two standard SecureStrings are externally managed, using `alias/aws/ssm`.
Terraform manages only references and exact worker IAM permissions. Secret bytes
never enter Terraform state, Git, CI inputs or application responses.

## Account and ownership

Use a separate Steam account with a controlled mailbox, a unique password and
Steam Guard enabled. Store the password and recovery information in the owner's
password manager. Do not send passwords or Steam Guard codes through chat.

Ownership is not yet established by an authenticated test. The earlier anonymous
probe failed; that does not establish whether an authenticated account without
MCC can download its Workshop items. Halo's official instructions describe the
ordinary in-library subscription flow but do not specify SteamCMD's entitlement
requirements. Test the new account before purchasing a license. `access_denied`
alone is not proof of an ownership requirement; `no_subscription` is reported
separately, and the selected item must be publicly available.

Sources:
- https://support.halowaypoint.com/hc/en-us/articles/28916975982868
- https://partner.steamgames.com/doc/sdk/uploading#8

Valve documents initial password/Steam Guard authentication, preservation of
`config/config.vdf`, and subsequent username-only logins. Reusing the password
can trigger a new Guard challenge. Fresh Lambda execution must be tested with
the actual account; this implementation does not claim universal token portability.

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
sends the original password to SteamCMD's password prompt with PTY echo disabled;
it never places the password in a Steam console command. Control characters are
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
not write a host credential file or place credentials in command arguments.
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
uv run --with boto3==1.40.75 --no-project python scripts/workshop-steam-auth.py probe --item-id 2890016882
```

This invokes the private worker with `{"action":"probe","item_id":"2890016882"}`.
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

Keep the two SecureStrings on rollback. Revert the Workshop image and parameter
references together if returning to a worker without session support. Do not
change H1 recipes, map approvals, replay history or the separate API HMAC.

## Live status

Both empty slots were created on 2026-11-14; the owner populated the credentials.
Session support deployment and authenticated access probes are pending. The
anonymous failure remains the only completed live download evidence so far.
