[CmdletBinding(SupportsShouldProcess = $true)]
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

$accountIds = @{
    dev  = "283279960672"
    prod = "659571592246"
}
$expectedAccountId = $accountIds[$Stack]

if (-not $Profile) {
    $Profile = "halospawns-$Stack"
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI is required to seed CloudFront signing key material."
    exit 1
}
if (-not $PublicOnly -and -not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Error "uv is required to seed the CloudFront private key through the Parameter Store lifecycle tool."
    exit 1
}

$callerAccountId = & aws sts get-caller-identity `
    --profile $Profile `
    --region $Region `
    --query Account `
    --output text `
    --no-cli-pager
if ($LASTEXITCODE -ne 0) {
    Write-Error "Could not resolve AWS identity for profile $Profile."
    exit 1
}

if ($callerAccountId.Trim() -ne $expectedAccountId) {
    Write-Error "AWS profile $Profile resolved to account $callerAccountId; expected $expectedAccountId."
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

$privateParameterName = "/$Project/$Stack/cloudfront/upload-signing/private-key"
$publicParameterName = "/$Project/$Stack/cloudfront/upload-signing/public-key"

$awsBaseArgs = @("--profile", $Profile, "--region", $Region, "--no-cli-pager")

& aws @awsBaseArgs ssm get-parameter --name $publicParameterName 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "SSM parameter does not exist yet: $publicParameterName. Apply the Terraform-managed parameter first, then rerun this script."
    exit 1
}

$publicKeySeeded = $false
if ($PSCmdlet.ShouldProcess($publicParameterName, "Update CloudFront public signing-key parameter")) {
    Invoke-AwsCli -Arguments ($awsBaseArgs + @(
            "ssm",
            "put-parameter",
            "--name", $publicParameterName,
            "--type", "String",
            "--value", "file://$publicKeyFullPath",
            "--overwrite"
        ))
    $publicKeySeeded = $true
}

if ($PublicOnly) {
    if ($publicKeySeeded) {
        Write-Host "Seeded CloudFront public signing key parameter: $publicParameterName"
    }
    exit 0
}

$toolArgs = @(
    "run", "--with", "boto3", "--no-project", "python",
    (Join-Path $PSScriptRoot "ssm-secret-tool.py"),
    "--profile", $Profile,
    "--region", $Region,
    "--expected-account-id", $expectedAccountId,
    "--environment", $Stack,
    "--project", $Project,
    "--parameter-name", $privateParameterName,
    "--description", "Private key for signing Halospawns CloudFront upload URLs in $Stack",
    "--value-file", $privateKeyFullPath
)
$privateKeySeeded = $false
if ($PSCmdlet.ShouldProcess($privateParameterName, "Create or rotate CloudFront private signing-key SecureString")) {
    & uv @toolArgs
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    $privateKeySeeded = $true
}

if ($publicKeySeeded -and $privateKeySeeded) {
    Write-Host "Seeded CloudFront public and private signing-key parameters for stack '$Stack'."
}
