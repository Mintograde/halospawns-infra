param(
    [Parameter(Mandatory)][ValidateSet('record', 'compare')][string]$Mode,
    [Parameter(Mandatory)][string]$NativeDirectory,
    [Parameter(Mandatory)][string]$MapsDirectory,
    [Parameter(Mandatory)][string]$OutputName,
    [string]$WasmDirectory,
    [string]$CandidateEncoder,
    [string]$FixturesName = 'fixtures',
    [string]$Volume = 'h1-linux-benchmark-865d1b3d',
    [string]$Image = 'halospawns-h1-film:h1arena-197bb65c-20261015-r1',
    [string]$Only,
    [ValidateRange(1, 32)][int]$Cpus = 2,
    [int]$Repeats = 3
)
$ErrorActionPreference = 'Stop'
foreach ($name in @($OutputName, $FixturesName, $Volume)) {
    if ($name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]+$') { throw 'Invalid artifact name.' }
}
$workerPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$nativePath = (Resolve-Path -LiteralPath $NativeDirectory).Path
$mapsPath = (Resolve-Path -LiteralPath $MapsDirectory).Path
foreach ($file in @('h1-film-linux', 'measure')) {
    if (!(Test-Path -LiteralPath (Join-Path $nativePath $file) -PathType Leaf)) { throw "Native build is incomplete: $file" }
}
$imageId = & docker image inspect $Image --format '{{.Id}}'
if ($LASTEXITCODE) { throw 'Benchmark runtime image missing.' }
& docker volume create $Volume | Out-Null
if ($LASTEXITCODE) { throw 'Benchmark volume creation failed.' }
$mounts = @('--rm', '--read-only', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--cpus', "$Cpus", '--memory', '3008m', '--memory-swap', '3008m',
    '--mount', "type=volume,source=$Volume,target=/bench",
    '--mount', "type=bind,source=$nativePath,target=/native,readonly",
    '--mount', "type=bind,source=$mapsPath,target=/maps,readonly",
    '--mount', "type=bind,source=$workerPath,target=/worker,readonly")
$arguments = @('/worker/tools/linux-candidate/benchmark.mjs', '--mode', $Mode,
    '--native', '/native/h1-film-linux', '--measure', '/native/measure', '--maps', '/maps',
    '--output', "/bench/$OutputName", '--cpus', "$Cpus")
if ($Only) { $arguments += @('--only', $Only) }
if ($CandidateEncoder) {
    $encoderPath = (Resolve-Path -LiteralPath $CandidateEncoder).Path
    $mounts += @('--mount', "type=bind,source=$encoderPath,target=/candidate-encoder,readonly")
    $arguments += @('--candidate-encoder', '/candidate-encoder')
}
if ($Mode -eq 'compare') {
    if (!$WasmDirectory) { throw 'Comparison requires a WASM directory.' }
    $wasmPath = (Resolve-Path -LiteralPath $WasmDirectory).Path
    $mounts += @('--mount', "type=bind,source=$wasmPath,target=/wasm,readonly")
    $arguments += @('--wasm', '/wasm/h1-film.js', '--encoder', '/var/task/bin/h1-film-encoder',
        '--fixtures', "/bench/$FixturesName", '--repeats', "$Repeats")
}
Write-Output "Offline $Mode using $imageId; volume=$Volume output=$OutputName; $Cpus CPUs / 3008 MiB"
& docker run @mounts --entrypoint /var/lang/bin/node $imageId @arguments
if ($LASTEXITCODE) { throw 'Candidate run failed; evidence remains in the named volume.' }
