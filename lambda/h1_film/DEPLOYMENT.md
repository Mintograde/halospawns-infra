# H1 film Lambda integration

Status on 2026-10-09: retained exporter revision 2 and viewer revision 3 are
deployed in dev as `viewer3-glass-20261009-r1`, retaining native analytics 3.
Both API H1 flags are true on `live=178`,
and the intake worker consumes its batch-one queue with concurrency 5.
The worker reuses the existing finalizer and retains original film/version pins.
The API uses the existing worker ceilings as provisional dev limits, not measured
performance claims. Nine LAN films covering nine maps passed the complete worker locally,
including both reprocess product modes and persisted completion retries. The
32 existing H1 films have been queued for the new default through the existing
fenced SQS reprocess path. The canary succeeded and activated viewer revision 3;
the remaining asynchronous backfill and broader parity acceptance are tracked below.
Existing Xbox consumers and prod are unchanged. This is not full semantic parity.
API current/versioned reads and durable lifecycle retention for retained
`maps/processed/` originals are deployed; broader map approval remains open.

Active code has since been organized under `lambda/h1_film`; experiments retain
only reference/benchmark tooling and historical notes. See [README.md](README.md)
for the current entry points and [COMPATIBILITY.md](COMPATIBILITY.md) for retained
engine bundles, source-isolated builds and append-only profile registration.

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
