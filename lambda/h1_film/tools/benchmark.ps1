param(
    [Parameter(Mandatory)][string]$Image,
    [Parameter(Mandatory)][string]$Film,
    [Parameter(Mandatory)][string]$Map,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$CandidateEncoder,
    [ValidateSet(1, 2, 3)][int]$AnalyticsRevision = 3
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$filmPath = (Resolve-Path -LiteralPath $Film).Path
$mapPath = (Resolve-Path -LiteralPath $Map).Path
$mapName = [IO.Path]::GetFileName($mapPath)
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $outputPath) { throw 'Benchmark output must be a new directory.' }
$encoderPath = if ($CandidateEncoder) { (Resolve-Path -LiteralPath $CandidateEncoder).Path }
New-Item -ItemType Directory -Path $outputPath | Out-Null
$arguments = @(
    'run', '--rm', '--network', 'none', '--read-only', '--user', '1000:1000',
    '--cpus', '2', '--memory', '3008m', '--tmpfs', '/tmp:rw,nosuid,size=2g',
    '--mount', "type=bind,source=$repo/lambda/h1_film/tools/verify-cloud.py,target=/harness.py,readonly",
    '--mount', "type=bind,source=$repo/lambda/h1_film/tests/fixtures,target=/var/task/h1_film/tests/fixtures,readonly",
    '--mount', "type=bind,source=$filmPath,target=/input/film.h1film,readonly",
    '--mount', "type=bind,source=$mapPath,target=/input/$mapName,readonly",
    '--mount', "type=bind,source=$outputPath,target=/out",
    '--env', 'PYTHONPATH=/var/task'
)
if ($encoderPath) {
    foreach ($file in @('cloud.py', 'analytics.py')) {
        $arguments += @('--mount', "type=bind,source=$repo/lambda/h1_film/$file,target=/var/task/h1_film/$file,readonly")
    }
    $arguments += @(
        '--mount', "type=bind,source=$repo/lambda/h1_film/runtime,target=/var/task/runtime,readonly",
        '--mount', "type=bind,source=$repo/lambda/h1_film/convert.mjs,target=/var/task/convert.mjs,readonly",
        '--mount', "type=bind,source=$encoderPath,target=/var/task/bin/h1-film-encoder,readonly"
    )
}
$arguments += @('--entrypoint', '/var/lang/bin/python3', $Image, '/harness.py',
    '--film', '/input/film.h1film', '--map', "/input/$mapName", '--output', '/out/worker',
    '--analytics-revision', "$AnalyticsRevision")
& docker @arguments *> (Join-Path $outputPath 'worker.log')
if ($LASTEXITCODE) { throw "Offline worker failed. See $outputPath/worker.log" }
$report = Get-Content -LiteralPath (Join-Path $outputPath 'worker/report.json') -Raw | ConvertFrom-Json
$verification = Get-Content -LiteralPath (Join-Path $outputPath 'worker/verification.json') -Raw | ConvertFrom-Json
$completion = Get-Content -LiteralPath (Join-Path $outputPath 'worker/finalization.json') -Raw | ConvertFrom-Json
[pscustomobject]@{
    status = $verification.status
    image = $Image
    encoder_sha256 = $report.provenance.encoder_sha256
    film_sha256 = $report.provenance.film_sha256
    analytics_revision = $AnalyticsRevision
    source_ticks = $verification.source_ticks
    hash_checks = $verification.hash_checks
    conversion_seconds = $report.timing.total_seconds
    harness_seconds = $verification.total_seconds
    viewer_sha256 = $completion.viewer_artifact.sha256
    viewer_bytes = $verification.viewer_bytes
    evidence = $outputPath
} | ConvertTo-Json
