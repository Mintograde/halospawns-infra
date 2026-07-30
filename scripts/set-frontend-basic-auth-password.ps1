[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter(Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack = "dev",

    [Parameter()]
    [string]$Region = "us-east-1",

    [Parameter()]
    [string]$Profile,

    [Parameter()]
    [string]$ParameterName,

    [Parameter()]
    [string]$Username,

    [Parameter()]
    [System.Security.SecureString]$Password
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
    $ParameterName = "/halospawns/$Stack/frontend-site/basic-auth/credentials-base64"
}
if (-not $Username) {
    $Username = $Stack -eq "prod" ? "preview" : "dev"
}
if ([string]::IsNullOrWhiteSpace($Username) -or $Username.Contains(":") -or $Username -notmatch "^[\x21-\x7E]+$") {
    throw "Username must be non-empty printable ASCII without a colon."
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required to run the Parameter Store lifecycle tool with boto3."
}
if (-not $PSCmdlet.ShouldProcess($ParameterName, "Create or rotate frontend Basic Auth SSM SecureString")) {
    return
}
if (-not $Password) {
    $Password = Read-Host "Password for $Username" -AsSecureString
}

$plainPassword = [System.Net.NetworkCredential]::new("", $Password).Password
try {
    if ([string]::IsNullOrWhiteSpace($plainPassword) -or $plainPassword -notmatch "^[\x21-\x7E]+$") {
        throw "Password must be non-empty printable ASCII without spaces."
    }

    $rawCredential = "${Username}:${plainPassword}"
    $encodedCredential = [Convert]::ToBase64String(
        [System.Text.Encoding]::ASCII.GetBytes($rawCredential)
    )
    $toolArgs = @(
        "run", "--with", "boto3", "--no-project", "python",
        (Join-Path $PSScriptRoot "ssm-secret-tool.py"),
        "--profile", $Profile,
        "--region", $Region,
        "--expected-account-id", $expectedAccountId,
        "--environment", $Stack,
        "--parameter-name", $ParameterName,
        "--description", "Base64 Basic Auth credential for the Halospawns frontend site in $Stack",
        "--value-stdin"
    )

    $encodedCredential | & uv @toolArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend Basic Auth parameter rotation failed."
    }
}
finally {
    $plainPassword = $null
    $rawCredential = $null
    $encodedCredential = $null
}

Write-Host "Rotated frontend Basic Auth credentials for '$Username' in stack '$Stack'."
