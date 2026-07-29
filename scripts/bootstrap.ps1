[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack,

    [Parameter()]
    [string]$BootstrapDirectory = "L:\tmp\halospawns-prod-tfstate-bootstrap"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($Stack -eq "dev") {
    $commandText = "atmos workflow bootstrap-dev --file bootstrap"
    Write-Host "+ $commandText"

    atmos workflow bootstrap-dev --file bootstrap
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    exit 0
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is required for prod backend bootstrap."
}

if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
    throw "Terraform is required for prod backend bootstrap."
}

if (-not (Get-Command atmos -ErrorAction SilentlyContinue)) {
    throw "Atmos is required for prod backend bootstrap verification."
}

$profile = "halospawns-prod"
$region = "us-east-1"
$expectedAccountId = "659571592246"
$bucketName = "halospawns-tfstate-$expectedAccountId"
$stateKey = "prod/tfstate-backend/terraform.tfstate"

$identityJson = & aws sts get-caller-identity `
    --profile $profile `
    --region $region `
    --output json `
    --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    throw "Could not resolve AWS identity for profile $profile."
}

$identity = $identityJson | ConvertFrom-Json
if ($identity.Account -ne $expectedAccountId) {
    throw "AWS profile $profile resolved to account $($identity.Account); expected $expectedAccountId."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedBootstrapDirectory = [System.IO.Path]::GetFullPath($BootstrapDirectory)
New-Item -ItemType Directory -Path $resolvedBootstrapDirectory -Force -WhatIf:$false | Out-Null

$workRoot = Join-Path $resolvedBootstrapDirectory "work"
$workComponent = Join-Path $workRoot "components\terraform\tfstate-backend"
$workModule = Join-Path $workRoot "modules\backend"
$localStatePath = Join-Path $workComponent "terraform.tfstate"
$localPlanPath = Join-Path $workComponent "prod-tfstate-backend-bootstrap.planfile"
$workBackendPath = Join-Path $workComponent "backend.tf.json"

New-Item -ItemType Directory -Path $workComponent -Force -WhatIf:$false | Out-Null
New-Item -ItemType Directory -Path $workModule -Force -WhatIf:$false | Out-Null

Get-ChildItem -LiteralPath (Join-Path $repoRoot "components\terraform\tfstate-backend") -File -Filter "*.tf" |
    Copy-Item -Destination $workComponent -Force -WhatIf:$false
Get-ChildItem -LiteralPath (Join-Path $repoRoot "modules\backend") -File -Filter "*.tf" |
    Copy-Item -Destination $workModule -Force -WhatIf:$false

$sourceLockFile = Join-Path $repoRoot "components\terraform\tfstate-backend\.terraform.lock.hcl"
if (Test-Path -LiteralPath $sourceLockFile -PathType Leaf) {
    Copy-Item -LiteralPath $sourceLockFile -Destination $workComponent -Force -WhatIf:$false
}

$bucketListingJson = & aws s3api list-buckets `
    --profile $profile `
    --region $region `
    --query "Buckets[].Name" `
    --output json `
    --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    throw "Could not list S3 buckets for profile $profile."
}

$bucketExists = @($bucketListingJson | ConvertFrom-Json) -contains $bucketName
$remoteStateExists = $false
if ($bucketExists) {
    $remoteStateCount = & aws s3api list-objects-v2 `
        --profile $profile `
        --region $region `
        --bucket $bucketName `
        --prefix $stateKey `
        --max-keys 1 `
        --query "KeyCount" `
        --output text `
        --no-cli-pager
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect s3://$bucketName/$stateKey."
    }

    $remoteStateExists = [int]$remoteStateCount -gt 0
}

if ($remoteStateExists) {
    Write-Host "Prod backend state already exists at s3://$bucketName/$stateKey."
    Write-Host "+ atmos terraform plan tfstate-backend -s prod"
    atmos terraform plan tfstate-backend -s prod
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    exit 0
}

if ($bucketExists -and -not (Test-Path -LiteralPath $localStatePath -PathType Leaf)) {
    throw @"
The prod state bucket already exists, but neither remote component state nor the
expected local bootstrap state was found. Refusing automatic adoption:
  bucket: $bucketName
  remote key: $stateKey
  local state: $localStatePath
"@
}

if (Test-Path -LiteralPath $workBackendPath -PathType Leaf) {
    Remove-Item -LiteralPath $workBackendPath -Force -WhatIf:$false
}

$localTfDataDirectory = Join-Path $resolvedBootstrapDirectory "tfdata-local"
$previousTfDataDirectory = $env:TF_DATA_DIR

try {
    $env:TF_DATA_DIR = $localTfDataDirectory

    Write-Host "+ terraform -chdir=$workComponent init -backend=false -input=false"
    terraform "-chdir=$workComponent" init -backend=false -input=false
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    Write-Host "+ terraform -chdir=$workComponent plan <prod bootstrap vars>"
    terraform "-chdir=$workComponent" plan `
        -input=false `
        -out="$localPlanPath" `
        -var="environment=prod" `
        -var="profile=$profile" `
        -var="region=$region" `
        -var="project=halospawns"
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    if (-not $PSCmdlet.ShouldProcess($bucketName, "Apply the prod tfstate-backend component with local state")) {
        Write-Host "Prod backend bootstrap apply skipped."
        exit 0
    }

    Write-Host "+ terraform -chdir=$workComponent apply <bootstrap plan>"
    terraform "-chdir=$workComponent" apply -input=false "$localPlanPath"
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    $env:TF_DATA_DIR = $previousTfDataDirectory
}

if (-not (Test-Path -LiteralPath $localStatePath -PathType Leaf)) {
    throw "Terraform did not create the expected local bootstrap state: $localStatePath"
}

$backendConfiguration = @{
    terraform = @{
        backend = @{
            s3 = @{
                bucket               = $bucketName
                key                  = $stateKey
                profile              = $profile
                region               = $region
                use_lockfile         = $true
                workspace_key_prefix = "tfstate-backend"
            }
        }
    }
}
$backendConfiguration |
    ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath $workBackendPath -Encoding utf8NoBOM -WhatIf:$false

$remoteTfDataDirectory = Join-Path $resolvedBootstrapDirectory "tfdata-remote"
try {
    $env:TF_DATA_DIR = $remoteTfDataDirectory

    Write-Host "+ terraform -chdir=$workComponent init -migrate-state -force-copy -input=false"
    terraform "-chdir=$workComponent" init -migrate-state -force-copy -input=false
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    $env:TF_DATA_DIR = $previousTfDataDirectory
}

$remoteStateCount = & aws s3api list-objects-v2 `
    --profile $profile `
    --region $region `
    --bucket $bucketName `
    --prefix $stateKey `
    --max-keys 1 `
    --query "KeyCount" `
    --output text `
    --no-cli-pager
if ($LASTEXITCODE -ne 0 -or [int]$remoteStateCount -lt 1) {
    throw "Remote state migration did not create s3://$bucketName/$stateKey."
}

Write-Host "Retained bootstrap working files and state backups under $resolvedBootstrapDirectory."
Write-Host "+ atmos terraform plan tfstate-backend -s prod"
atmos terraform plan tfstate-backend -s prod
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
