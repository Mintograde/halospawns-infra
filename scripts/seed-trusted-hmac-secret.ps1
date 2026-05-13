param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack,

    [Parameter(Mandatory = $true)]
    [string]$ClientName,

    [Parameter()]
    [string]$SecretValuePath,

    [Parameter()]
    [ValidateRange(32, 128)]
    [int]$GeneratedSecretBytes = 48,

    [Parameter()]
    [string]$SecretName,

    [Parameter()]
    [string]$Project = "halospawns",

    [Parameter()]
    [string]$Region = "us-east-1",

    [Parameter()]
    [string]$Profile
)

Set-StrictMode -Version Latest

if (-not $Profile) {
    $Profile = "halospawns-$Stack"
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI is required to seed trusted HMAC secret values."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($ClientName)) {
    Write-Error "ClientName must not be empty."
    exit 1
}

if (-not $SecretName) {
    $SecretName = "/$Project/$Stack/app-api/trusted-clients/$ClientName/hmac-secret"
}

$awsBaseArgs = @("--profile", $Profile, "--region", $Region, "--no-cli-pager")

& aws @awsBaseArgs secretsmanager describe-secret --secret-id $SecretName 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Secrets Manager secret does not exist yet: $SecretName. Apply the Terraform metadata resource first, then rerun this script."
    exit 1
}

$createdTempSecretFile = $false
$secretValueFullPath = $null

try {
    if ($SecretValuePath) {
        $resolvedPath = Resolve-Path -LiteralPath $SecretValuePath -ErrorAction SilentlyContinue
        if (-not $resolvedPath) {
            Write-Error "Secret value file does not exist: $SecretValuePath"
            exit 1
        }

        if (-not (Test-Path -LiteralPath $resolvedPath.ProviderPath -PathType Leaf)) {
            Write-Error "Secret value path is not a file: $($resolvedPath.ProviderPath)"
            exit 1
        }

        $secretValueFullPath = $resolvedPath.ProviderPath
    }
    else {
        $tempFile = New-TemporaryFile
        $secretValueFullPath = $tempFile.FullName
        $createdTempSecretFile = $true

        $bytes = [byte[]]::new($GeneratedSecretBytes)
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        $secretValue = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
        [System.IO.File]::WriteAllText($secretValueFullPath, $secretValue, [System.Text.UTF8Encoding]::new($false))

        Write-Host "Generated a $GeneratedSecretBytes-byte random HMAC secret in a temporary file."
    }

    Write-Host "+ aws secretsmanager put-secret-value --secret-id $SecretName --secret-string file://<redacted>"
    & aws @awsBaseArgs secretsmanager put-secret-value `
        --secret-id $SecretName `
        --secret-string "file://$secretValueFullPath"

    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    if ($createdTempSecretFile -and $secretValueFullPath -and (Test-Path -LiteralPath $secretValueFullPath -PathType Leaf)) {
        Remove-Item -LiteralPath $secretValueFullPath -Force
    }
}

Write-Host "Seeded trusted HMAC secret for '$ClientName' in stack '$Stack'."
