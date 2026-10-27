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
    Invoke-Checked terraform @('-chdir=components/terraform/map-processing', 'plan', '-no-color',
        '-var-file=dev-map-processing.terraform.tfvars.json', "-out=$plan") | Out-Host
    $planData = Invoke-Checked terraform @('-chdir=components/terraform/map-processing', 'show', '-json', $plan) | ConvertFrom-Json
    $changes = @($planData.resource_changes | Where-Object { ($_.change.actions -join ',') -ne 'no-op' })
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
        foreach ($property in @($oldEnvironment.PSObject.Properties.Name + $newEnvironment.PSObject.Properties.Name) | Sort-Object -Unique) {
            if ($property -eq 'H1_WORKER_IMAGE_DIGEST') { continue }
            if ($oldEnvironment.$property -ne $newEnvironment.$property) { throw "Unexpected environment change: $property" }
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
    $healthMeta = Invoke-Aws @('lambda', 'invoke', '--function-name', $worker, '--cli-read-timeout', '90',
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
