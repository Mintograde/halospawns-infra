param(
    [Parameter(Mandatory)][string]$NativeDirectory,
    [Parameter(Mandatory)][string]$Film,
    [Parameter(Mandatory)][string]$Map,
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]+$')][string]$OutputName,
    [string]$CandidateEncoder,
    [string]$Image = 'halospawns-h1-film:20261025-r3',
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]+$')][string]$Volume = 'h1-beta4-performance-20261025',
    [ValidateRange(1, 10)][int]$Repeats = 3,
    [ValidateSet('compare', 'training')][string]$Phase = 'compare',
    [ValidateRange(1, 4)][double]$Cpus = 2
)
$ErrorActionPreference = 'Stop'
$workerPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$nativePath = (Resolve-Path -LiteralPath $NativeDirectory).Path
$filmPath = (Resolve-Path -LiteralPath $Film).Path
$mapPath = (Resolve-Path -LiteralPath $Map).Path
foreach ($file in @('h1-film-linux', 'measure', 'build.json')) {
    if (!(Test-Path -LiteralPath (Join-Path $nativePath $file) -PathType Leaf)) { throw "Incomplete native build: $file" }
}
$imageId = & docker image inspect $Image --format '{{.Id}}'
if ($LASTEXITCODE) { throw 'Runtime image missing.' }
& docker volume create $Volume | Out-Null
if ($LASTEXITCODE) { throw 'Benchmark volume creation failed.' }
$mounts = @('--rm', '--read-only', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--cpus', $Cpus.ToString([Globalization.CultureInfo]::InvariantCulture), '--memory', '3008m', '--memory-swap', '3008m',
    '--mount', "type=volume,source=$Volume,target=/bench",
    '--mount', "type=bind,source=$nativePath,target=/native,readonly",
    '--mount', "type=bind,source=$filmPath,target=/input/film.h1film,readonly",
    '--mount', "type=bind,source=$mapPath,target=/input/map.map,readonly",
    '--mount', "type=bind,source=$workerPath,target=/worker,readonly")
$arguments = @('/worker/tools/linux-candidate/benchmark-beta4.mjs',
    '--film', '/input/film.h1film', '--map', '/input/map.map', '--native', '/native/h1-film-linux',
    '--measure', '/native/measure', '--encoder', '/var/task/bin/h1-film-encoder',
    '--output', "/bench/$OutputName", '--repeats', "$Repeats", '--phase', $Phase,
    '--cpus', $Cpus.ToString([Globalization.CultureInfo]::InvariantCulture), '--image-id', $imageId)
if ($CandidateEncoder) {
    $encoderPath = (Resolve-Path -LiteralPath $CandidateEncoder).Path
    $mounts += @('--mount', "type=bind,source=$encoderPath,target=/candidate-encoder,readonly")
    $arguments += @('--candidate-encoder', '/candidate-encoder')
}
Write-Output "Offline Beta 4 comparison: image=$imageId volume=$Volume output=$OutputName CPUs=$Cpus memory=3008MiB"
& docker run @mounts --entrypoint /var/lang/bin/node $imageId @arguments
if ($LASTEXITCODE) { throw 'Comparison failed; evidence remains in the named volume.' }
