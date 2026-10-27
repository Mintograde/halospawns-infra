[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^\d{8}-r[1-9]\d*$')][string]$Tag,
    [string]$CorpusPath = '.build/h1-film-corpus.json'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
function Invoke-Aws {
    param([string[]]$Arguments)
    $result = & aws --profile halospawns-dev --region us-east-1 @Arguments
    if ($LASTEXITCODE) { throw 'Release publication AWS operation failed.' }
    $result
}
$account = (Invoke-Aws @('sts', 'get-caller-identity', '--query', 'Account', '--output', 'text')).Trim()
if ($account -ne '283279960672') { throw 'Expected the dev AWS account.' }
$digest = (Invoke-Aws @('ecr', 'describe-images', '--repository-name', 'halospawns-h1-film',
    '--image-ids', "imageTag=$Tag", '--query', 'imageDetails[0].imageDigest', '--output', 'text')).Trim()
$bucket = (Invoke-Aws @('lambda', 'get-function-configuration', '--function-name', 'halospawns-h1-film-dev',
    '--query', 'Environment.Variables.H1_UPLOADS_BUCKET', '--output', 'text')).Trim()
if ($digest -notmatch '^sha256:[0-9a-f]{64}$' -or -not $bucket -or $bucket -eq 'None') {
    throw 'Published image or release bucket is unavailable.'
}
$root = Join-Path $repo ".build/h1-releases/$Tag-publication"
New-Item -ItemType Directory -Path $root -Force | Out-Null
$objects = Invoke-Aws @('s3api', 'list-objects-v2', '--bucket', $bucket, '--prefix', "films/releases/$Tag.") | ConvertFrom-Json
$keys = if ($objects.PSObject.Properties.Name -contains 'Contents') { @($objects.Contents.Key) } else { @() }
$manifestPath = Join-Path $root 'manifest.json'
$checkpointPath = Join-Path $root 'checkpoint.json'
if ("films/releases/$Tag.json" -in $keys) {
    foreach ($suffix in @('.json', '.validation.json', '.contracts.zip')) {
        if ("films/releases/$Tag$suffix" -notin $keys) { throw 'Published release is incomplete.' }
        Invoke-Aws @('s3api', 'get-object', '--bucket', $bucket, '--key', "films/releases/$Tag$suffix",
            (Join-Path $root "published$suffix")) | Out-Null
    }
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'published.json') | ConvertFrom-Json
    $index = Get-Content -Raw -LiteralPath (Join-Path $root 'published.validation.json') | ConvertFrom-Json
    if ($manifest.release_id -ne $Tag -or $manifest.image_digest -ne $digest -or
        $index.release_id -ne $Tag -or $index.image_digest -ne $digest -or
        (Get-FileHash -LiteralPath (Join-Path $root 'published.contracts.zip')).Hash.ToLowerInvariant() -ne $index.archive_sha256) {
        throw 'Published release evidence differs from its image.'
    }
    Write-Host "Release $Tag is already fully published and verified."
    return
}
$image = "283279960672.dkr.ecr.us-east-1.amazonaws.com/halospawns-h1-film@$digest"
$packaged = & docker run --rm --network none --read-only --entrypoint /var/lang/bin/node $image -e `
    'console.log(JSON.stringify({release_id:process.env.H1_WORKER_RELEASE_ID,registry:require("/var/task/profiles/registry.json")}))'
if ($LASTEXITCODE) { throw 'Cannot read the published image registry.' }
$packaged = $packaged | ConvertFrom-Json
if ($packaged.release_id -ne $Tag) { throw 'Image has a different baked release ID.' }
$registryPath = Join-Path $root 'registry.json'
$packaged.registry | ConvertTo-Json -Depth 70 | Set-Content -LiteralPath $registryPath -Encoding utf8NoBOM
& node (Join-Path $repo 'lambda/h1_film/tools/release-manifest.mjs') $Tag $digest $manifestPath $registryPath
if ($LASTEXITCODE) { throw 'Manifest generation failed.' }
if (Test-Path -LiteralPath $checkpointPath) {
    $validation = Get-Content -Raw -LiteralPath $checkpointPath | ConvertFrom-Json
} else {
    $validation = & (Join-Path $repo 'scripts/test-h1-film-release.ps1') -Image $image -ManifestPath $manifestPath -CorpusPath $CorpusPath
    $validation | ConvertTo-Json | Set-Content -LiteralPath $checkpointPath -Encoding utf8NoBOM
}
$index = Get-Content -Raw -LiteralPath $validation.Index | ConvertFrom-Json
if ($index.release_id -ne $Tag -or $index.image_digest -ne $digest -or
    (Get-FileHash -LiteralPath $validation.Archive).Hash.ToLowerInvariant() -ne $index.archive_sha256) {
    throw 'Local publication checkpoint differs from the immutable image.'
}
foreach ($profile in $packaged.registry.processing.defaults.PSObject.Properties.Name) {
    if ($profile -notin @($index.cases.engine_profile)) { throw "Missing profile validation: $profile" }
}
foreach ($artifact in @(
    @{ Suffix = '.contracts.zip'; Path = $validation.Archive; Type = 'application/zip' },
    @{ Suffix = '.validation.json'; Path = $validation.Index; Type = 'application/json' },
    @{ Suffix = '.json'; Path = $manifestPath; Type = 'application/json' }
)) {
    $key = "films/releases/$Tag$($artifact.Suffix)"
    if ($key -in $keys) {
        $existing = Join-Path $root "existing$($artifact.Suffix)"
        Invoke-Aws @('s3api', 'get-object', '--bucket', $bucket, '--key', $key, $existing) | Out-Null
        if ((Get-FileHash -LiteralPath $existing).Hash -ne (Get-FileHash -LiteralPath $artifact.Path).Hash) {
            throw "Existing immutable artifact differs: $key. Preserve it and use a fresh tag."
        }
    } else {
        Invoke-Aws @('s3api', 'put-object', '--bucket', $bucket, '--key', $key,
            '--body', $artifact.Path, '--content-type', $artifact.Type, '--if-none-match', '*') | Out-Null
    }
}
Write-Host "Published release $Tag at $digest. Set image_tag/default_release and run the H1 promotion workflow."
