[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Image,
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$Bucket,
    [Parameter(Mandatory)][string]$CatalogPath,
    [Parameter(Mandatory)][string]$OutputPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
$root = (Resolve-Path -LiteralPath $OutputPath).Path
function Invoke-Aws {
    param([string[]]$Arguments)
    $result = & aws --profile halospawns-dev --region us-east-1 @Arguments
    if ($LASTEXITCODE) { throw 'Release verification AWS read failed.' }
    $result
}
$indexPath = Join-Path $root 'validation.json'
$archive = Join-Path $root 'contracts.zip'
Invoke-Aws @('s3api', 'get-object', '--bucket', $Bucket, '--key', "films/releases/$ReleaseId.validation.json", $indexPath) | Out-Null
Invoke-Aws @('s3api', 'get-object', '--bucket', $Bucket, '--key', "films/releases/$ReleaseId.contracts.zip", $archive) | Out-Null
$index = Get-Content -Raw -LiteralPath $indexPath | ConvertFrom-Json
$catalog = Get-Content -Raw -LiteralPath $CatalogPath | ConvertFrom-Json
$manifest = @($catalog.manifests | Where-Object release_id -EQ $ReleaseId)
if ($manifest.Count -ne 1 -or $index.release_id -ne $ReleaseId -or
    $index.image_digest -ne $manifest[0].image_digest -or
    (Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant() -ne $index.archive_sha256) {
    throw 'Callback archive differs from the registered release.'
}
foreach ($profile in $manifest[0].defaults.PSObject.Properties.Name) {
    if ($profile -notin @($index.cases.engine_profile)) { throw "Missing callback coverage: $profile" }
}
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $root 'callbacks')
$snapshot = Invoke-Aws @('lambda', 'get-function', '--function-name', 'halospawns-dev-app-api', '--qualifier', 'live') | ConvertFrom-Json
$version = [string]$snapshot.Configuration.Version
$zip = Join-Path $root 'api.zip'
Invoke-WebRequest -Uri $snapshot.Code.Location -OutFile $zip
if ((Get-FileHash -LiteralPath $zip).Hash -ne [Convert]::ToHexString([Convert]::FromBase64String($snapshot.Configuration.CodeSha256))) {
    throw 'Deployed API ZIP hash differs.'
}
$api = Join-Path $root 'api'
Expand-Archive -LiteralPath $zip -DestinationPath $api
foreach ($case in $index.cases) {
    if ($case.name -notmatch '^[a-z0-9-]+$') { throw 'Invalid callback case.' }
    docker run --rm --network none --read-only --user 10001:10001 --cpus 2 --memory 3008m `
        --env PYTHONPATH=/api:/var/task --tmpfs /tmp:rw,nosuid,size=512m,mode=1777 `
        --mount "type=bind,source=$api,target=/api,readonly" `
        --mount "type=bind,source=$root,target=/evidence" `
        --mount "type=bind,source=$CatalogPath,target=/catalog.json,readonly" `
        --mount "type=bind,source=$repo/lambda/h1_film,target=/checks,readonly" `
        --entrypoint /var/lang/bin/python3.12 $Image /checks/tools/verify-api-products.py `
        --api /api --release-catalog /catalog.json --finalization "/evidence/callbacks/$($case.name)/finalization.json" `
        --output "/evidence/$($case.name)-api.json" *> (Join-Path $root "$($case.name)-api.log")
    if ($LASTEXITCODE) { throw "Deployed API rejected $($case.name) callbacks. Evidence: $root" }
    Write-Host "API live=$version accepts $($case.name) success/failure callbacks and receipt serialization."
}
$after = Invoke-Aws @('lambda', 'get-alias', '--function-name', 'halospawns-dev-app-api', '--name', 'live') | ConvertFrom-Json
if ($after.FunctionVersion -ne $version) { throw 'API changed during verification; run promotion again.' }
$version
