param (
    [Parameter(Position = 0)]
    [ValidateSet("dev")]
    [string]$Stack = "dev",

    [Parameter()]
    [string]$Region = "us-east-1",

    [Parameter()]
    [string]$Profile,

    [Parameter()]
    [string]$AccountId = "283279960672",

    [Parameter()]
    [string]$RepositoryName = "halospawns-replay-parser",

    [Parameter()]
    [string]$Tag = "latest",

    [Parameter()]
    [string]$FunctionName
)

Set-StrictMode -Version Latest

if (-not $Profile) {
    $Profile = "halospawns-$Stack"
}

if (-not $FunctionName) {
    $FunctionName = "halospawns-replay-parser-$Stack"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is required to build and push the replay parser image."
    exit 1
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI is required to log in to ECR."
    exit 1
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$buildContext = "lambda\replay_parser"
$buildContextPath = Join-Path $repoRoot $buildContext

if (-not (Test-Path -LiteralPath $buildContextPath -PathType Container)) {
    Write-Error "Replay parser build context does not exist: $buildContextPath"
    exit 1
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
        exit 1
    }

    $buildCommandText = "docker build -t $localImage -t $remoteImage $buildContext"
    Write-Host "+ $buildCommandText"
    & docker build -t $localImage -t $remoteImage $buildContext
    if ($LASTEXITCODE -ne 0) {
        exit 1
    }

    $pushCommandText = "docker push $remoteImage"
    Write-Host "+ $pushCommandText"
    & docker push $remoteImage
    if ($LASTEXITCODE -ne 0) {
        exit 1
    }

    $updateFunctionCommandText = "aws lambda update-function-code --profile $Profile --region $Region --function-name $FunctionName --image-uri $remoteImage"
    Write-Host "+ $updateFunctionCommandText"
    & aws lambda update-function-code `
        --profile $Profile `
        --region $Region `
        --function-name $FunctionName `
        --image-uri $remoteImage
    if ($LASTEXITCODE -ne 0) {
        exit 1
    }
}
finally {
    Pop-Location
}
