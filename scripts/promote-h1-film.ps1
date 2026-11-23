[CmdletBinding()]
param(
    [ValidateSet('dev')][string]$Stack = 'dev',
    [switch]$CheckOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$profile = 'halospawns-dev'
$region = 'us-east-1'
$api = 'halospawns-dev-app-api:live'
$worker = 'halospawns-h1-film-dev'
$evidence = Join-Path $repo ".build/h1-promotions/$([datetime]::UtcNow.ToString('yyyyMMdd-HHmmss'))-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $evidence -Force | Out-Null

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    $result = & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed ($LASTEXITCODE). Evidence: $evidence" }
    $result
}

function Invoke-Aws {
    param([string[]]$Arguments)
    Invoke-Checked aws (@('--profile', $profile, '--region', $region) + $Arguments)
}

function Invoke-Control {
    param([hashtable]$Command)
    $Command.schema = 'halospawns.h1FilmReleaseControl.v1'
    $Command.environment = $Stack
    $inputPath = Join-Path $evidence "$($Command.action)-$([guid]::NewGuid().ToString('N')).json"
    $outputPath = "$inputPath.response.json"
    $Command | ConvertTo-Json -Depth 70 | Set-Content -LiteralPath $inputPath -Encoding utf8NoBOM
    $meta = Invoke-Aws @('lambda', 'invoke', '--function-name', $api, '--payload', "fileb://$inputPath", $outputPath) | ConvertFrom-Json
    if ($meta.PSObject.Properties.Name -contains 'FunctionError') {
        throw "Release API rejected $($Command.action). See $outputPath"
    }
    Get-Content -Raw -LiteralPath $outputPath | ConvertFrom-Json
}

function Get-Manifest {
    param([string]$Release)
    if ($Release -notmatch '^\d{8}-r[1-9]\d*$') { throw 'Set a valid h1_film.default_release and image_tag.' }
    $path = Join-Path $evidence "$Release.manifest.json"
    Invoke-Aws @('s3api', 'get-object', '--bucket', $bucket, '--key', "films/releases/$Release.json", $path) | Out-Null
    $manifest = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    $digest = (Invoke-Aws @('ecr', 'describe-images', '--repository-name', 'halospawns-h1-film',
        '--image-ids', "imageTag=$Release", '--query', 'imageDetails[0].imageDigest', '--output', 'text')).Trim()
    if ($manifest.release_id -ne $Release -or $manifest.image_digest -ne $digest) {
        throw "Release manifest differs from its immutable image: $Release"
    }
    $manifest
}

function Get-WorkerPlan {
    param([string]$Path, [string[]]$Targets = @())
    $arguments = @('-chdir=components/terraform/map-processing', 'plan', '-no-color',
        '-var-file=dev-map-processing.terraform.tfvars.json', "-out=$Path")
    foreach ($target in $Targets) { $arguments += "-target=$target" }
    Invoke-Checked terraform $arguments | Out-Host
    $planData = Invoke-Checked terraform @('-chdir=components/terraform/map-processing', 'show', '-json', $Path) | ConvertFrom-Json
    $planData.resource_changes | Where-Object { $_.mode -eq 'managed' -and ($_.change.actions -join ',') -ne 'no-op' }
}

Push-Location -LiteralPath $repo
try {
    $account = (Invoke-Aws @('sts', 'get-caller-identity', '--query', 'Account', '--output', 'text')).Trim()
    if ($account -ne '283279960672') { throw 'Expected the dev AWS account.' }
    $configuration = Invoke-Checked atmos @('describe', 'component', 'map-processing', '-s', $Stack, '--format', 'json') | ConvertFrom-Json
    $desired = $configuration.vars.h1_film
    $bucket = (Invoke-Aws @('lambda', 'get-function-configuration', '--function-name', $worker,
        '--query', 'Environment.Variables.H1_UPLOADS_BUCKET', '--output', 'text')).Trim()
    $selected = Get-Manifest $desired.default_release
    $installed = Get-Manifest $desired.image_tag
    $before = Invoke-Control @{ action = 'status' }
    $before | ConvertTo-Json -Depth 70 | Set-Content -LiteralPath (Join-Path $evidence 'before.json')
    Write-Host "Desired default: $($selected.release_id); effective: $($before.policy.release_id); revision: $($before.policy.revision)"
    if ($CheckOnly) { return }
    foreach ($manifest in @($selected, $installed) | Sort-Object release_id -Unique) {
        Invoke-Control @{ action = 'register'; manifest = $manifest } | Out-Null
    }
    $catalogPath = Join-Path $evidence 'registered-catalog.json'
    Invoke-Control @{ action = 'status' } | ConvertTo-Json -Depth 70 | Set-Content -LiteralPath $catalogPath -Encoding utf8NoBOM
    $image = "283279960672.dkr.ecr.us-east-1.amazonaws.com/halospawns-h1-film@$($installed.image_digest)"
    $apiVersion = & ./scripts/verify-h1-film-release.ps1 -Image $image -ReleaseId $installed.release_id `
        -Bucket $bucket -CatalogPath $catalogPath -OutputPath (Join-Path $evidence 'api-check')
    & ./scripts/plan.ps1 $Stack map-processing
    if ($LASTEXITCODE -ne 0) { throw 'Worker plan failed.' }
    $plan = Join-Path $evidence 'worker.planfile'
    $changes = @(Get-WorkerPlan $plan)
    $poolCapacity = if ($desired.PSObject.Properties['world_pool_capacity']) { [int]$desired.world_pool_capacity } else { 0 }
    $worldResources = @(
        'aws_s3_bucket.h1_world[0]', 'aws_s3_bucket_public_access_block.h1_world[0]',
        'aws_s3_bucket_versioning.h1_world[0]', 'aws_s3_bucket_lifecycle_configuration.h1_world[0]',
        'aws_cloudwatch_log_group.h1_world[0]', 'aws_iam_role.h1_world[0]',
        'aws_iam_role_policy.h1_world[0]', 'aws_lambda_function.h1_world[0]',
        'aws_iam_role_policy.h1_film_worlds[0]'
    )
    $worldUpdates = @('aws_lambda_function.h1_world[0]', 'aws_iam_role_policy.h1_film_worlds[0]')
    $worldChanges = @($changes | Where-Object { $_.address -in $worldResources })
    if ($worldChanges.Count) {
        foreach ($change in $changes) {
            $action = $change.change.actions -join ','
            if ($change.address -eq 'aws_lambda_function.h1_film[0]' -and $action -eq 'update') { continue }
            if ($poolCapacity -gt 0 -and $change.address -in $worldResources -and
                ($action -eq 'create' -or ($action -eq 'update' -and $change.address -in $worldUpdates))) { continue }
            throw "Unexpected resource action: $action $($change.address)"
        }
        # Publish the child first so the parent plan contains the exact qualified ARN and bucket.
        $worldPlan = Join-Path $evidence 'worlds.planfile'
        $staged = @(Get-WorkerPlan $worldPlan $worldResources)
        $expected = @($worldChanges | ForEach-Object { "$($_.address) $($_.change.actions -join ',')" } | Sort-Object)
        $actions = @($staged | ForEach-Object { "$($_.address) $($_.change.actions -join ',')" } | Sort-Object)
        if (($actions -join "`n") -ne ($expected -join "`n")) { throw 'World pool actions changed between plans.' }
        Copy-Item -LiteralPath $plan -Destination (Join-Path $evidence 'combined.planfile')
        Invoke-Checked terraform @('-chdir=components/terraform/map-processing', 'apply', '-no-color', $worldPlan) | Out-Host
        $changes = @(Get-WorkerPlan $plan)
    }
    $worldKeys = @('H1_WORLD_FUNCTION', 'H1_WORLD_BUCKET', 'H1_WORLD_CONCURRENCY')
    foreach ($change in $changes) {
        if ($change.address -ne 'aws_lambda_function.h1_film[0]' -or ($change.change.actions -join ',') -ne 'update') {
            throw "Unexpected resource action: $($change.address). Review the saved plan before proceeding."
        }
        foreach ($property in $change.change.before.PSObject.Properties.Name) {
            if ($property -in @('image_uri', 'environment', 'last_modified')) { continue }
            if (($change.change.before.$property | ConvertTo-Json -Depth 30 -Compress) -ne
                ($change.change.after.$property | ConvertTo-Json -Depth 30 -Compress)) {
                throw "Unexpected worker change: $property"
            }
        }
        $oldEnvironment = $change.change.before.environment[0].variables
        $newEnvironment = $change.change.after.environment[0].variables
        if ($change.change.after.image_uri -ne $image -or $newEnvironment.H1_WORKER_IMAGE_DIGEST -ne $installed.image_digest) {
            throw 'Planned worker image differs from the verified manifest.'
        }
        foreach ($property in @($oldEnvironment.PSObject.Properties.Name + $newEnvironment.PSObject.Properties.Name) | Sort-Object -Unique) {
            if ($property -eq 'H1_WORKER_IMAGE_DIGEST' -or $property -in $worldKeys) { continue }
            if ($oldEnvironment.$property -ne $newEnvironment.$property) { throw "Unexpected environment change: $property" }
        }
        $limit = if ($desired.PSObject.Properties['worlds_per_film']) { [int]$desired.worlds_per_film } else { 8 }
        if ($poolCapacity -gt 0 -and $limit -gt 0) {
            $function = $newEnvironment.H1_WORLD_FUNCTION
            if ($function -notmatch '^arn:aws:lambda:us-east-1:283279960672:function:halospawns-h1-world-dev:[1-9][0-9]*$' -or
                [int]$newEnvironment.H1_WORLD_CONCURRENCY -ne $limit) { throw 'Planned parent world configuration differs.' }
            $child = Invoke-Aws @('lambda', 'get-function', '--function-name', $function) | ConvertFrom-Json
            $reservation = Invoke-Aws @('lambda', 'get-function-concurrency', '--function-name', $child.Configuration.FunctionName) | ConvertFrom-Json
            $childEnv = $child.Configuration.Environment.Variables
            if ($child.Code.ResolvedImageUri -ne $image -or $childEnv.H1_WORKER_IMAGE_DIGEST -ne $installed.image_digest -or
                $childEnv.H1_WORKER_MODE -ne 'world' -or $childEnv.H1_UPLOADS_BUCKET -ne $bucket -or
                $childEnv.H1_WORLD_BUCKET -ne $newEnvironment.H1_WORLD_BUCKET -or
                $child.Configuration.MemorySize -ne $change.change.after.memory_size -or
                $reservation.ReservedConcurrentExecutions -ne $poolCapacity) {
                throw 'Published world worker configuration differs from the parent.'
            }
        } elseif (@($worldKeys | Where-Object { $_ -in $newEnvironment.PSObject.Properties.Name }).Count) {
            throw 'Disabled pool still has dispatch settings.'
        }
    }
    if ($changes.Count) {
        Invoke-Checked terraform @('-chdir=components/terraform/map-processing', 'apply', '-no-color', $plan) | Out-Host
    }
    Invoke-Aws @('lambda', 'wait', 'function-updated-v2', '--function-name', $worker) | Out-Null
    $actual = Invoke-Aws @('lambda', 'get-function', '--function-name', $worker) | ConvertFrom-Json
    if (-not $actual.Code.ResolvedImageUri.EndsWith("@$($installed.image_digest)")) { throw 'Deployed image differs.' }
    $healthInput = Join-Path $evidence 'health-input.json'
    $healthOutput = Join-Path $evidence 'health.json'
    '{"schema":"halospawns.h1FilmHealth.v1","action":"health"}' | Set-Content -LiteralPath $healthInput -Encoding utf8NoBOM
    $healthMeta = Invoke-Aws @('lambda', 'invoke', '--function-name', $worker, '--cli-read-timeout', '780',
        '--payload', "fileb://$healthInput", $healthOutput) | ConvertFrom-Json
    if ($healthMeta.PSObject.Properties.Name -contains 'FunctionError') { throw "Worker health failed: $healthOutput" }
    $health = Get-Content -Raw -LiteralPath $healthOutput | ConvertFrom-Json
    if ($health.release.release_id -ne $installed.release_id -or $health.release.image_digest -ne $installed.image_digest) {
        throw 'Worker release provenance differs.'
    }
    $manifestPath = Join-Path $evidence "$($installed.release_id).manifest.json"
    Invoke-Checked node @('lambda/h1_film/tools/verify-release-health.mjs', $manifestPath, $healthOutput) | Out-Host
    $after = Invoke-Control @{ action = 'activate'; release_id = $selected.release_id;
        expected_revision = $before.policy.revision; worker_image_digest = $installed.image_digest;
        api_version = [string]$apiVersion }
    $after | ConvertTo-Json -Depth 70 | Set-Content -LiteralPath (Join-Path $evidence 'after.json')
    if ($after.release_id -ne $selected.release_id) { throw 'Default release verification failed.' }
    Write-Host "Active H1 default: $($after.release_id), policy revision $($after.revision). Evidence: $evidence"
} finally {
    Pop-Location
}
