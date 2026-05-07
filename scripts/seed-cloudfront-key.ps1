param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack,

    [Parameter(Mandatory = $true)]
    [string]$PublicKeyPath,

    [Parameter()]
    [string]$PrivateKeyPath,

    [Parameter()]
    [string]$Project = "halospawns",

    [Parameter()]
    [string]$Region = "us-east-1",

    [Parameter()]
    [string]$Profile,

    [switch]$PublicOnly
)

Set-StrictMode -Version Latest

if (-not $Profile) {
    $Profile = "halospawns-$Stack"
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI is required to seed CloudFront signing key material."
    exit 1
}

function Resolve-KeyPath {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $resolvedPath = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolvedPath) {
        Write-Error "$Label file does not exist: $Path"
        exit 1
    }

    if (-not (Test-Path -LiteralPath $resolvedPath.ProviderPath -PathType Leaf)) {
        Write-Error "$Label path is not a file: $($resolvedPath.ProviderPath)"
        exit 1
    }

    return $resolvedPath.ProviderPath
}

function Invoke-AwsCli {
    param (
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    Write-Host "+ aws $($Arguments -join ' ')"
    & aws @Arguments
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$publicKeyFullPath = Resolve-KeyPath -Path $PublicKeyPath -Label "Public key"

if (-not $PublicOnly -and -not $PrivateKeyPath) {
    Write-Error "PrivateKeyPath is required unless -PublicOnly is set."
    exit 1
}

if (-not $PublicOnly) {
    $privateKeyFullPath = Resolve-KeyPath -Path $PrivateKeyPath -Label "Private key"
}

$privateSecretName = "/$Project/$Stack/cloudfront/upload-signing/private-key"
$publicParameterName = "/$Project/$Stack/cloudfront/upload-signing/public-key"

$awsBaseArgs = @("--profile", $Profile, "--region", $Region, "--no-cli-pager")

& aws @awsBaseArgs ssm get-parameter --name $publicParameterName 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "SSM parameter does not exist yet: $publicParameterName. Apply the Terraform-managed parameter first, then rerun this script."
    exit 1
}

Invoke-AwsCli -Arguments ($awsBaseArgs + @(
        "ssm",
        "put-parameter",
        "--name", $publicParameterName,
        "--type", "String",
        "--value", "file://$publicKeyFullPath",
        "--overwrite"
    ))

if ($PublicOnly) {
    Write-Host "Seeded CloudFront public signing key parameter: $publicParameterName"
    exit 0
}

& aws @awsBaseArgs secretsmanager describe-secret --secret-id $privateSecretName 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Secrets Manager secret does not exist yet: $privateSecretName. Apply the Terraform metadata resource first, then rerun this script without -PublicOnly."
    exit 1
}

Invoke-AwsCli -Arguments ($awsBaseArgs + @(
        "secretsmanager",
        "put-secret-value",
        "--secret-id", $privateSecretName,
        "--secret-string", "file://$privateKeyFullPath"
    ))

Write-Host "Seeded CloudFront signing keys for stack '$Stack'."
