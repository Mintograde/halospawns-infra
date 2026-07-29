[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack = "dev",

    [Parameter()]
    [string]$Region = "us-east-1",

    [Parameter()]
    [string]$Profile,

    [Parameter()]
    [ValidatePattern("^[0-9]{12}$")]
    [string]$AccountId,

    [Parameter()]
    [string]$RepositoryName = "halospawns-replay-parser",

    [Parameter()]
    [ValidatePattern("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")]
    [string]$Tag = "latest",

    [Parameter()]
    [string]$FunctionName,

    [Parameter()]
    [switch]$PushOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$accountIds = @{
    dev  = "283279960672"
    prod = "659571592246"
}
$expectedAccountId = $accountIds[$Stack]

if (-not $AccountId) {
    $AccountId = $expectedAccountId
}

if ($AccountId -ne $expectedAccountId) {
    throw "Stack '$Stack' is pinned to AWS account $expectedAccountId, not $AccountId."
}

if (-not $Profile) {
    $Profile = "halospawns-$Stack"
}

if (-not $FunctionName) {
    $FunctionName = "halospawns-replay-parser-$Stack"
}

if ([string]::IsNullOrWhiteSpace($Tag)) {
    throw "Tag must not be empty."
}

if ($Stack -eq "prod" -and $Tag.Trim().ToLowerInvariant() -eq "latest") {
    throw "Prod replay parser images require an immutable release tag; latest is not allowed."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is required to build and push the replay parser image."
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is required to log in to ECR."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$buildContext = "lambda\replay_parser"
$buildContextPath = Join-Path $repoRoot $buildContext

if (-not (Test-Path -LiteralPath $buildContextPath -PathType Container)) {
    throw "Replay parser build context does not exist: $buildContextPath"
}

$callerAccountId = & aws sts get-caller-identity `
    --profile $Profile `
    --region $Region `
    --query Account `
    --output text `
    --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    throw "Could not resolve AWS identity for profile $Profile."
}

if ($callerAccountId.Trim() -ne $expectedAccountId) {
    throw "AWS profile $Profile resolved to account $callerAccountId; expected $expectedAccountId."
}

& aws ecr describe-repositories `
    --profile $Profile `
    --region $Region `
    --repository-names $RepositoryName `
    --no-cli-pager 1>$null
if ($LASTEXITCODE -ne 0) {
    throw "ECR repository does not exist yet: $RepositoryName. Apply the ecr component first."
}

$registry = "$AccountId.dkr.ecr.$Region.amazonaws.com"
$localImage = "${RepositoryName}:${Tag}"
$remoteImage = "${registry}/${RepositoryName}:${Tag}"

Push-Location -LiteralPath $repoRoot
try {
    $loginCommandText = "aws ecr get-login-password --profile $Profile --region $Region | docker login --username AWS --password-stdin $registry"
    Write-Host "+ $loginCommandText"
    & aws ecr get-login-password --profile $Profile --region $Region | & docker login --username AWS --password-stdin $registry
    if ($LASTEXITCODE -ne 0) {
        throw "Docker login to $registry failed."
    }

    $buildCommandText = "docker build -t $localImage -t $remoteImage $buildContext"
    Write-Host "+ $buildCommandText"
    & docker build -t $localImage -t $remoteImage $buildContext
    if ($LASTEXITCODE -ne 0) {
        throw "Replay parser image build failed."
    }

    $pushCommandText = "docker push $remoteImage"
    Write-Host "+ $pushCommandText"
    & docker push $remoteImage
    if ($LASTEXITCODE -ne 0) {
        throw "Replay parser image push failed."
    }

    $imageDigest = & aws ecr describe-images `
        --profile $Profile `
        --region $Region `
        --repository-name $RepositoryName `
        --image-ids "imageTag=$Tag" `
        --query "imageDetails[0].imageDigest" `
        --output text `
        --no-cli-pager
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($imageDigest) -or $imageDigest -eq "None") {
        throw "Could not resolve the ECR digest for $remoteImage."
    }

    Write-Host "Published image: ${remoteImage}@$($imageDigest.Trim())"

    if ($PushOnly) {
        Write-Host "Push-only mode complete; Lambda code was not updated."
        exit 0
    }

    $updateFunctionCommandText = "aws lambda update-function-code --profile $Profile --region $Region --function-name $FunctionName --image-uri $remoteImage"
    Write-Host "+ $updateFunctionCommandText"
    & aws lambda update-function-code `
        --profile $Profile `
        --region $Region `
        --function-name $FunctionName `
        --image-uri $remoteImage
    if ($LASTEXITCODE -ne 0) {
        throw "Lambda update failed for $FunctionName."
    }
}
finally {
    Pop-Location
}
