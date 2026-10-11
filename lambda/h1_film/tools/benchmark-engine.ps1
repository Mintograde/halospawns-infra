param(
    [Parameter(Mandatory)][string]$Image,
    [Parameter(Mandatory)][string]$Film,
    [Parameter(Mandatory)][string]$Map,
    [Parameter(Mandatory)][string]$Output,
    [ValidateRange(1, 256)][int]$ExporterRevision = 2,
    [string]$EngineRoot,
    [switch]$CpuProfile
)
$ErrorActionPreference = 'Stop'
$worker = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$filmPath = (Resolve-Path -LiteralPath $Film).Path
$mapPath = (Resolve-Path -LiteralPath $Map).Path
$outputPath = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $outputPath) { throw 'Engine proof must be a new file.' }
$parent = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$arguments = @(
    'run', '--rm', '--network', 'none', '--read-only', '--user', '1000:1000',
    '--cpus', '2', '--memory', '3008m', '--tmpfs', '/tmp:rw,nosuid,size=2g',
    '--mount', "type=bind,source=$worker,target=/tools,readonly",
    '--mount', "type=bind,source=$filmPath,target=/input/film.h1film,readonly",
    '--mount', "type=bind,source=$mapPath,target=/input/map.map,readonly",
    '--mount', "type=bind,source=$parent,target=/out"
)
if ($EngineRoot) {
    $enginePath = (Resolve-Path -LiteralPath $EngineRoot).Path
    $arguments += @('--mount', "type=bind,source=$enginePath,target=/var/task/engines,readonly")
}
$arguments += @('--entrypoint', '/var/lang/bin/node', $Image, '/tools/tools/benchmark-engine.mjs',
    '--film', '/input/film.h1film', '--map', '/input/map.map', '--hash-export',
    '--exporter-revision', "$ExporterRevision", '--output', "/out/$([IO.Path]::GetFileName($outputPath))")
if ($CpuProfile) { $arguments += '--cpu-profile' }
& docker @arguments
if ($LASTEXITCODE) { throw 'Engine export verification failed.' }
