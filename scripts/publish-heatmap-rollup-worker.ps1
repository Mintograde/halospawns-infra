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
    [string]$FunctionName,

    [Parameter()]
    [string]$AliasName = "live"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $Profile) {
    $Profile = "halospawns-$Stack"
}

if (-not $FunctionName) {
    $FunctionName = "halospawns-heatmap-rollup-worker-$Stack"
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI is required to publish the heatmap rollup worker."
    exit 1
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$sourceRoot = Join-Path $repoRoot "lambda\heatmap_rollup_worker"
$sourceFiles = @(
    (Join-Path $sourceRoot "handler.py"),
    (Join-Path $sourceRoot "region_stats.py")
)

foreach ($sourceFile in $sourceFiles) {
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        Write-Error "Heatmap rollup worker source file does not exist: $sourceFile"
        exit 1
    }
}

$callerAccountId = & aws sts get-caller-identity `
    --profile $Profile `
    --region $Region `
    --query Account `
    --output text
if ($LASTEXITCODE -ne 0) {
    exit 1
}

if ($callerAccountId.Trim() -ne $AccountId) {
    Write-Error "AWS profile $Profile resolved to account $callerAccountId; expected $AccountId."
    exit 1
}

$packagePath = Join-Path ([System.IO.Path]::GetTempPath()) "halospawns-heatmap-rollup-worker-$([guid]::NewGuid().ToString('N')).zip"
$packageUri = "fileb://$($packagePath.Replace('\', '/'))"

try {
    Compress-Archive -LiteralPath $sourceFiles -DestinationPath $packagePath -CompressionLevel Optimal

    Write-Host "+ aws lambda update-function-code --profile $Profile --region $Region --function-name $FunctionName --zip-file <package> --publish"
    $publishResponse = & aws lambda update-function-code `
        --profile $Profile `
        --region $Region `
        --function-name $FunctionName `
        --zip-file $packageUri `
        --publish `
        --output json
    if ($LASTEXITCODE -ne 0) {
        exit 1
    }

    $publishedVersion = ($publishResponse | ConvertFrom-Json).Version
    if (-not $publishedVersion -or $publishedVersion -eq '$LATEST') {
        Write-Error "AWS did not return a published Lambda version."
        exit 1
    }

    Write-Host "+ aws lambda wait function-updated-v2 --profile $Profile --region $Region --function-name $FunctionName"
    & aws lambda wait function-updated-v2 `
        --profile $Profile `
        --region $Region `
        --function-name $FunctionName
    if ($LASTEXITCODE -ne 0) {
        exit 1
    }

    Write-Host "+ aws lambda update-alias --profile $Profile --region $Region --function-name $FunctionName --name $AliasName --function-version $publishedVersion"
    & aws lambda update-alias `
        --profile $Profile `
        --region $Region `
        --function-name $FunctionName `
        --name $AliasName `
        --function-version $publishedVersion `
        --query '{Alias:Name,FunctionVersion:FunctionVersion,AliasArn:AliasArn}' `
        --output json
    if ($LASTEXITCODE -ne 0) {
        exit 1
    }
}
finally {
    Remove-Item -LiteralPath $packagePath -Force -ErrorAction SilentlyContinue
}
