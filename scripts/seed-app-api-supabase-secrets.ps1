[CmdletBinding()]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack,

    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrlPath,

    [Parameter()]
    [string]$ServiceRoleKeyPath,

    [Parameter()]
    [string]$DatabaseUrlSecretName,

    [Parameter()]
    [string]$ServiceRoleSecretName,

    [Parameter()]
    [string]$Project = "halospawns",

    [Parameter()]
    [string]$Region = "us-east-1",

    [Parameter()]
    [string]$Profile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$accountIds = @{
    dev  = "283279960672"
    prod = "659571592246"
}
$expectedAccountId = $accountIds[$Stack]

if (-not $Profile) {
    $Profile = "halospawns-$Stack"
}

if (-not $DatabaseUrlSecretName) {
    $DatabaseUrlSecretName = "/$Project/$Stack/app-api/supabase/database-url"
}

if (-not $ServiceRoleSecretName) {
    $ServiceRoleSecretName = "/$Project/$Stack/app-api/supabase/service-role-key"
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is required to seed App API Supabase secrets."
}

function Resolve-SecretValuePath {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $resolvedPath = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolvedPath -or -not (Test-Path -LiteralPath $resolvedPath.ProviderPath -PathType Leaf)) {
        throw "$Label file does not exist: $Path"
    }

    $value = [System.IO.File]::ReadAllText($resolvedPath.ProviderPath)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$Label file must not be empty."
    }

    if ($value.Contains("`r") -or $value.Contains("`n")) {
        throw "$Label file must contain exactly one value without a trailing newline."
    }

    return $resolvedPath.ProviderPath
}

function Set-SecretValueFromFile {
    param (
        [Parameter(Mandatory = $true)]
        [string]$SecretName,

        [Parameter(Mandatory = $true)]
        [string]$ValuePath
    )

    & aws secretsmanager describe-secret `
        --profile $Profile `
        --region $Region `
        --secret-id $SecretName `
        --no-cli-pager 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Secrets Manager secret does not exist yet: $SecretName. Apply app-api metadata first."
    }

    Write-Host "+ aws secretsmanager put-secret-value --secret-id $SecretName --secret-string file://<redacted>"
    & aws secretsmanager put-secret-value `
        --profile $Profile `
        --region $Region `
        --secret-id $SecretName `
        --secret-string "file://$($ValuePath.Replace('\', '/'))" `
        --no-cli-pager 1>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not seed Secrets Manager secret $SecretName."
    }
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

$databaseUrlFullPath = Resolve-SecretValuePath -Path $DatabaseUrlPath -Label "Database URL"
Set-SecretValueFromFile -SecretName $DatabaseUrlSecretName -ValuePath $databaseUrlFullPath
Write-Host "Seeded the App API Supabase database URL secret for stack '$Stack'."

if ($ServiceRoleKeyPath) {
    $serviceRoleKeyFullPath = Resolve-SecretValuePath -Path $ServiceRoleKeyPath -Label "Service role key"
    Set-SecretValueFromFile -SecretName $ServiceRoleSecretName -ValuePath $serviceRoleKeyFullPath
    Write-Host "Seeded the optional App API Supabase service role key secret for stack '$Stack'."
}
