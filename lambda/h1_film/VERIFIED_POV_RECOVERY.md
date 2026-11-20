# Verified recovery for recorded client POVs

Exporter 46 adds a second playback attempt for source-pinned format-3 Beta 6, 7 and 8 embedded client films. The worker first runs the ordinary exporter to completion and retains its exact desynchronization verdict. The retry requires a matching nonzero match ID, recorder slot and local-player mask, matching original recorder names, and an uncapped account belonging to the recorder.

The retry reads the recorded host pistol and sniper autoaim fields only when one differs from the saved client settings. For every nongrenade round it consumes the ordinary firing RNG and spread calculation, then binds the recorder's original projectile direction by client tick, trigger, pellet, weapon and projectile tag. Missing or ambiguous bindings, incomplete recordings, refused network updates, failed world hashes and roster mismatches keep the original unavailable result. Both the pinned source-rate simulation and the ordinary playable-world encoder must pass.

Each verified world carries its own clock, roster and source film hash. Its match container includes a small hashed receipt under the client's verification directory. The receipt records the original failure, both settings pairs, the original account digest, verified network application count, and the numbers of matched and changed directions. A difference count of zero identifies a settings-only recovery. The API binds the receipt digest into the selected artifact proof. The viewer verifies that receipt and displays **Recovered POV** next to the recorder's name in the perspective menu. Shooter statistics continue to use the original recording evidence and its original verification boundary.

## Building and rollback

Use the exporter 45 build flags for the appropriate pinned engine plus `-VerifiedPovRecovery` in `tools/build-engine.ps1`. Native parity builds use `-DH1_VERIFIED_POV_RECOVERY=ON`. The recovery input is internal to the second embedded-client invocation. Preserve the old exporters, match v9 reader and every selected or archived generation when rolling back the default. The original evidence and historical replay bytes remain available for review.

## Dev release

Dev worker and default `20261120-r1` run under policy 43. API 301 and frontend `3713dab` read the recovery receipt. The dev AWS operator submitted one audited full reparse for each of the 14 verified games. All 14 attempts succeeded and selected a new generation under the original replay ID. Each recovery receipt was read back from its selected S3 object version and checked against the source evidence.

| Recorder | Recovered POVs | Frames | Matching world hashes | Recorded rounds matched | Recalculated directions that differed |
| --- | ---: | ---: | ---: | ---: | ---: |
| juanch0 | 8 | 567,725 | 4,734 | 1,203 | 653 |
| xzr | 5 | 372,314 | 3,105 | 1,065 | 597 |
| zut | 1 | 34,276 | 286 | 31 | 0 |
| Total | 14 | 974,315 | 8,125 | 2,299 | 1,250 |

The deployed WebAssembly worker matched every recorded world hash and RNG check. A separate Windows native run of xzr's Chillout film differed at one world hash at update 26,040. All 33 other audited desynchronized views retained their unavailable result in the packaged worker.

The comparison of selected dev generations covered all 1,495 pre-existing match payloads in the 14 games and the selections of the other 459 replays. The six separate client uploads stayed attached to their original hosts. Every original player statistic, scoreboard, graph and occupancy result was preserved. One older sniper evidence document gained the current schema and two empty lists.

Hosted Chrome checks passed for every recovered POV at desktop and mobile widths. Each check selected the recorder's **Recovered POV** entry, sought to 50% and 85% while paused, played forward, paused again and switched back to the host. All 28 checks verified the selected API world and receipt hashes. Four runs exceeded the first concurrent browser check's 100-second timeline wait and passed on individual retries. Per-replay links, labels, seeks and verification counts are recorded in `.build/pov-release-20261120/verification-live.csv`.

The worker implementation is in infra commit `57f5753`. Commit `597f083` pins the dev release in `stacks/dev.yaml`. The API receipt reader is `3aa3035` and the frontend reader is `3713dab`.

Dev promotion ran `pwsh -NoProfile -File scripts/promote-h1-film.ps1 -Stack dev`. Terraform applied the saved `map-processing` plan to update `aws_lambda_function.h1_film[0]` in place.

```powershell
$workerPlan = (Resolve-Path '.build/h1-promotions/20261120-170741-17e2c98603b845d792008dc08fa76f8e/worker.planfile').Path
terraform -chdir=components/terraform/map-processing apply -no-color $workerPlan
```

The final dev plans used `pwsh -NoProfile -File scripts/plan.ps1 dev <component>` for `map-processing`, `frontend-site`, `uploads-ingest`, `tfstate-backend`, `ecr` and `app-api`. An output-only apply advanced the API version from 300 to 301. All six final plans reported zero resource changes.

```powershell
$apiPlan = (Resolve-Path 'components/terraform/app-api/dev-app-api.planfile').Path
terraform -chdir=components/terraform/app-api apply -input=false $apiPlan
```
