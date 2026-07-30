[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack,

    [Parameter(Mandatory = $true)]
    [string]$ClientName,

    [Parameter()]
    [string]$ValuePath,

    [Parameter()]
    [ValidateRange(32, 128)]
    [int]$GeneratedSecretBytes = 48,

    [Parameter()]
    [string]$ParameterName,

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
if (-not $ParameterName) {
    $ParameterName = "/$Project/$Stack/app-api/trusted-clients/$ClientName/hmac-secret"
}
if ([string]::IsNullOrWhiteSpace($ClientName)) {
    throw "ClientName must not be empty."
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required to run the Parameter Store lifecycle tool with boto3."
}
if ($ValuePath) {
    $resolvedValuePath = Resolve-Path -LiteralPath $ValuePath -ErrorAction SilentlyContinue
    if (-not $resolvedValuePath -or -not (Test-Path -LiteralPath $resolvedValuePath.ProviderPath -PathType Leaf)) {
        throw "Secret value file does not exist: $ValuePath"
    }
    $value = [System.IO.File]::ReadAllText($resolvedValuePath.ProviderPath)
    if ([string]::IsNullOrWhiteSpace($value) -or $value.Contains("`r") -or $value.Contains("`n")) {
        throw "Secret value file must contain one non-empty value without a newline."
    }
    $value = $null
}

$toolArgs = @(
    "run", "--with", "boto3", "--no-project", "python",
    (Join-Path $PSScriptRoot "ssm-secret-tool.py"),
    "--profile", $Profile,
    "--region", $Region,
    "--expected-account-id", $expectedAccountId,
    "--environment", $Stack,
    "--project", $Project,
    "--parameter-name", $ParameterName,
    "--description", "HMAC signing secret for the Halospawns $ClientName trusted client in $Stack"
)
if ($ValuePath) {
    $toolArgs += @("--value-file", $ValuePath)
}
else {
    $toolArgs += @("--generate-bytes", "$GeneratedSecretBytes")
}
if ($PSCmdlet.ShouldProcess($ParameterName, "Create or rotate SSM SecureString")) {
    & uv @toolArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Trusted HMAC parameter seed failed."
    }
}
