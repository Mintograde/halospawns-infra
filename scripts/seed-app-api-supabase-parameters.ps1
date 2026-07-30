[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack,

    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrlPath,

    [Parameter()]
    [string]$ServiceRoleKeyPath,

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
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required to run the Parameter Store lifecycle tool with boto3."
}

function Assert-SingleLineSecretFile {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolved -or -not (Test-Path -LiteralPath $resolved.ProviderPath -PathType Leaf)) {
        throw "$Label file does not exist: $Path"
    }
    $value = [System.IO.File]::ReadAllText($resolved.ProviderPath)
    if ([string]::IsNullOrWhiteSpace($value) -or $value.Contains("`r") -or $value.Contains("`n")) {
        throw "$Label file must contain one non-empty value without a newline."
    }
}

$values = @(
    @{
        Name        = "/$Project/$Stack/app-api/supabase/database-url"
        Description = "Supabase database URL used by the Halospawns app API in $Stack"
        Path        = $DatabaseUrlPath
    }
)
if ($ServiceRoleKeyPath) {
    $values += @{
        Name        = "/$Project/$Stack/app-api/supabase/service-role-key"
        Description = "Supabase service role key used by the Halospawns app API in $Stack"
        Path        = $ServiceRoleKeyPath
    }
}

foreach ($value in $values) {
    Assert-SingleLineSecretFile -Path $value.Path -Label $value.Description

    $toolArgs = @(
        "run", "--with", "boto3", "--no-project", "python",
        (Join-Path $PSScriptRoot "ssm-secret-tool.py"),
        "--profile", $Profile,
        "--region", $Region,
        "--expected-account-id", $expectedAccountId,
        "--environment", $Stack,
        "--project", $Project,
        "--parameter-name", $value.Name,
        "--description", $value.Description,
        "--value-file", $value.Path
    )
    if ($PSCmdlet.ShouldProcess($value.Name, "Create or rotate SSM SecureString")) {
        & uv @toolArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Supabase parameter seed failed."
        }
    }
}
