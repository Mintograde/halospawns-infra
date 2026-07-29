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
    [ValidateRange(16, 128)]
    [int]$PasswordLength = 24,

    [Parameter()]
    [string]$CredentialOutputPath
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

if ($Stack -eq "prod" -and -not $CredentialOutputPath) {
    throw "CredentialOutputPath is required for prod so the generated password is retained without printing it."
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is required to seed frontend Basic Auth credentials."
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

& aws ssm get-parameter `
    --profile $Profile `
    --region $Region `
    --name $ParameterName `
    --no-with-decryption `
    --no-cli-pager 1>$null
if ($LASTEXITCODE -ne 0) {
    throw "SSM parameter does not exist yet: $ParameterName. Apply frontend-site first."
}

$alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
$password = -join (1..$PasswordLength | ForEach-Object {
    $alphabet[[System.Security.Cryptography.RandomNumberGenerator]::GetInt32($alphabet.Length)]
})
$raw = "${Username}:${password}"
$encoded = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($raw))
$encodedPath = Join-Path ([System.IO.Path]::GetTempPath()) "halospawns-basic-auth-$PID.txt"

try {
    [System.IO.File]::WriteAllText($encodedPath, $encoded, [System.Text.UTF8Encoding]::new($false))

    if ($PSCmdlet.ShouldProcess($ParameterName, "Replace frontend Basic Auth credentials in $Stack")) {
        & aws ssm put-parameter `
            --profile $Profile `
            --region $Region `
            --name $ParameterName `
            --type SecureString `
            --value "file://$($encodedPath.Replace('\', '/'))" `
            --overwrite `
            --no-cli-pager 1>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Could not update Basic Auth parameter $ParameterName."
        }

        if ($CredentialOutputPath) {
            $fullOutputPath = [System.IO.Path]::GetFullPath($CredentialOutputPath)
            $outputDirectory = Split-Path -Parent $fullOutputPath
            if ($outputDirectory) {
                New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
            }

            @(
                "Username: $Username"
                "Password: $password"
            ) | Set-Content -LiteralPath $fullOutputPath -Encoding utf8NoBOM
            Write-Host "Seeded Basic Auth credentials and wrote the one-time credential copy to $fullOutputPath."
        }
        else {
            Write-Host "Username: $Username"
            Write-Host "Password: $password"
        }
    }
}
finally {
    Remove-Item -LiteralPath $encodedPath -Force -ErrorAction SilentlyContinue -WhatIf:$false
}
