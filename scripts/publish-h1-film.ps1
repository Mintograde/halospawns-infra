[CmdletBinding()]
param(
    [ValidateSet('dev')][string]$Stack = 'dev',
    [Parameter(Mandatory)]
    [ValidateLength(11, 128)]
    [ValidatePattern('\A[0-9]{8}-r[1-9][0-9]*\z', Options = 'None')]
    [ValidateScript({
        [void][datetime]::ParseExact($_.Split('-')[0], 'yyyyMMdd', [cultureinfo]::InvariantCulture)
        $true
    })]
    [string]$Tag,
    [string]$EngineRoot,
    [string]$PreviousRegistry,
    [string]$CorpusPath = '.build/h1-film-corpus.json',
    [switch]$BuildOnly,
    [switch]$ResumePublication
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ($ResumePublication) {
    if ($BuildOnly) { throw 'ResumePublication and BuildOnly cannot be combined.' }
    & (Join-Path $PSScriptRoot 'complete-h1-film-publication.ps1') -Tag $Tag -CorpusPath $CorpusPath
    return
}
if (-not $EngineRoot) { throw 'EngineRoot is required when building a new image.' }
$engines = (Resolve-Path -LiteralPath $EngineRoot).Path
$profile = "halospawns-$Stack"
$account = '283279960672'
$region = 'us-east-1'
$repository = 'halospawns-h1-film'
$registry = "$account.dkr.ecr.$region.amazonaws.com"
$localImage = "${repository}:${Tag}"
$remoteImage = "${registry}/${repository}:${Tag}"

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed ($LASTEXITCODE)." }
}

Push-Location -LiteralPath $repo
$stage = $null
try {
    $audit = @('lambda/h1_film/tools/check-release.mjs', '--engine-root', $engines)
    if ($PreviousRegistry) { $audit += @('--previous-registry', (Resolve-Path -LiteralPath $PreviousRegistry).Path) }
    Invoke-Checked node $audit
    if (-not $BuildOnly) {
        $caller = (Invoke-Checked aws @('sts', 'get-caller-identity', '--profile', $profile, '--query', 'Account', '--output', 'text')).Trim()
        if ($caller -ne $account) { throw "Expected dev account $account; received $caller." }
        $mutability = (Invoke-Checked aws @('ecr', 'describe-repositories', '--profile', $profile, '--region', $region,
            '--repository-names', $repository, '--query', 'repositories[0].imageTagMutability', '--output', 'text')).Trim()
        if ($mutability -ne 'IMMUTABLE') { throw 'Apply the immutable H1 ECR foundation first.' }
        $images = Invoke-Checked aws @('ecr', 'list-images', '--profile', $profile, '--region', $region,
            '--repository-name', $repository, '--output', 'json') | ConvertFrom-Json
        if (@($images.imageIds | Where-Object imageTag -EQ $Tag).Count) { throw "Release tag already exists: $Tag" }
    }

    # Copy only verified, registered binaries into the private Docker context.
    $buildRoot = [IO.Path]::GetFullPath((Join-Path $repo '.build'))
    $stage = Join-Path $buildRoot "h1-film-$([guid]::NewGuid().ToString('N'))"
    $engineRegistry = Get-Content -Raw -LiteralPath 'lambda/h1_film/profiles/registry.json' | ConvertFrom-Json
    $profiles = $engineRegistry.profiles
    foreach ($engine in $profiles) {
        Invoke-Checked node @('lambda/h1_film/tools/stage-engine.mjs', '--profile', $engine.id,
            '--from', (Join-Path $engines "$($engine.id)/h1-film.js"), '--engine-root', $stage)
    }
    if ($engineRegistry.PSObject.Properties.Name -contains 'exporters') {
        foreach ($exporter in $engineRegistry.exporters) {
            Invoke-Checked node @('lambda/h1_film/tools/stage-engine.mjs', '--profile', $exporter.engine_profile,
                '--exporter-revision', [string]$exporter.revision,
                '--from', (Join-Path $engines "$($exporter.engine_profile)/exporter-$($exporter.revision)/h1-film.js"),
                '--engine-root', $stage)
        }
    }
    Invoke-Checked docker @('buildx', 'build', '--platform', 'linux/amd64', '--provenance=false', '--load',
        '--build-arg', "H1_WORKER_RELEASE_ID=$Tag",
        '--build-context', "engines=$stage", '-f', 'lambda/h1_film/Dockerfile', '-t', $localImage, '-t', $remoteImage, '.')
    & ./lambda/h1_film/tests/container.test.ps1 -Image $localImage

    if ($BuildOnly) {
        Write-Host "Built $localImage. No AWS writes or Lambda updates."
    } else {
        $password = Invoke-Checked aws @('ecr', 'get-login-password', '--profile', $profile, '--region', $region)
        $password | & docker login --username AWS --password-stdin $registry
        if ($LASTEXITCODE -ne 0) { throw 'ECR login failed.' }
        $password = $null
        Invoke-Checked docker @('push', $remoteImage)
        & ./scripts/complete-h1-film-publication.ps1 -Tag $Tag -CorpusPath $CorpusPath
    }
} finally {
    if ($stage -and (Test-Path -LiteralPath $stage)) {
        $resolved = (Resolve-Path -LiteralPath $stage).Path
        if ([IO.Path]::GetDirectoryName($resolved) -ne $buildRoot -or
            [IO.Path]::GetFileName($resolved) -notmatch '^h1-film-[0-9a-f]{32}$') {
            throw "Refusing to remove unexpected staging path: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
    Pop-Location
}
