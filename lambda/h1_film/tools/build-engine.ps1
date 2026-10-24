param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$BuildDirectory,
    [Parameter(Mandatory)][string]$Port,
    [switch]$Combat,
    [switch]$NetworkReplayFixes,
    [int]$Jobs = 12,
    [string]$Volume = 'halospawns-h1-engine-builds'
)
$ErrorActionPreference = 'Stop'
if ($NetworkReplayFixes -and $Port -ne 'beta4') { throw 'Network replay corrections require the beta4 port.' }
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$worker = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$buildPath = [IO.Path]::GetFullPath($BuildDirectory)
if (Test-Path -LiteralPath $buildPath) { throw 'Use a new candidate directory; existing engines are never replaced.' }
if ($Volume -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]+$') { throw 'Invalid Docker build volume name.' }
$inputJson = & node (Join-Path $PSScriptRoot 'describe-build.mjs') --source $sourcePath --port $Port
if ($LASTEXITCODE) { throw 'Source/port fingerprint failed.' }
$inputs = $inputJson | ConvertFrom-Json
$image = $inputs.port.toolchain_image
$sourceStage = "/cache/sources/$($inputs.source.sha256)"
$variant = if ($Combat) { 'combat-v1' } else { 'standard' }
if ($NetworkReplayFixes) { $variant += '-network-replay-v1' }
$cacheBuild = "/cache/builds/$Port/$($inputs.source.sha256)/$($inputs.port_source.sha256)/$variant"
New-Item -ItemType Directory -Path $buildPath | Out-Null
$inputJson | Set-Content -LiteralPath (Join-Path $buildPath 'build-inputs.json') -Encoding utf8
$mounts = @('--rm', '--mount', "type=bind,source=$sourcePath,target=/source,readonly",
    '--mount', "type=bind,source=$worker,target=/worker,readonly",
    '--mount', "type=bind,source=$buildPath,target=/work",
    '--mount', "type=volume,source=$Volume,target=/cache", '-w', '/work')
& docker volume create $Volume | Out-Null
if ($LASTEXITCODE) { throw "Build volume creation failed: $LASTEXITCODE" }
& docker run @mounts $image mkdir -p $sourceStage $cacheBuild
if ($LASTEXITCODE) { throw "Cache directory creation failed: $LASTEXITCODE" }
$sourceEntries = if ($inputs.port.source_entries) { @($inputs.port.source_entries) } else { @('CMakeLists.txt', 'engine', 'host') }
$sourceFiles = @($sourceEntries | ForEach-Object { "/source/$_" })
& docker run @mounts $image cp -a @sourceFiles $sourceStage
if ($LASTEXITCODE) { throw "Source staging failed: $LASTEXITCODE" }
$revisionArguments = if ($inputs.source.git_commit) { @("-DH1_SOURCE_COMMIT=$($inputs.source.git_commit)", "-DH1_SOURCE_DATE=$($inputs.source.git_date)") } else { @() }
$combatFlag = if ($Combat) { 'ON' } else { 'OFF' }
[string[]]$networkReplayArguments = if ($NetworkReplayFixes) { @('-DH1_NETWORK_REPLAY_FIXES=ON') } else { @() }
& docker run @mounts $image emcmake cmake -S "/worker/engines/$Port/wasm" -B $cacheBuild -G 'Unix Makefiles' "-DH1_SOURCE=$sourceStage" "-DH1_COMBAT_EXPORT=$combatFlag" @networkReplayArguments @revisionArguments
if ($LASTEXITCODE) { throw "WASM configure failed: $LASTEXITCODE" }
$log = Join-Path $buildPath ('build-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
& docker run @mounts $image cmake --build $cacheBuild --parallel $Jobs -- -k *> $log
$buildExit = $LASTEXITCODE
Get-Content -LiteralPath $log -Tail 100
if ($buildExit) { throw "WASM build failed: $buildExit. See $log" }
& docker run @mounts $image cp "$cacheBuild/h1-film.js" "$cacheBuild/h1-film.wasm" "$cacheBuild/engine.map" /work/
if ($LASTEXITCODE) { throw "Artifact copy failed: $LASTEXITCODE" }
$afterJson = & node (Join-Path $PSScriptRoot 'describe-build.mjs') --source $sourcePath --port $Port
if ($LASTEXITCODE -or (($afterJson | ConvertFrom-Json | ConvertTo-Json -Depth 8 -Compress) -ne
    ($inputs | ConvertTo-Json -Depth 8 -Compress))) { throw 'Build inputs changed during compilation; candidate is not verified.' }
@{
    schema = 'halospawns.h1EngineBuildCandidate.v1'
    status = 'candidate_requires_native_parity_and_profile_registration'
    inputs = $inputs
    combat_contract = if ($Combat) { 'halospawns.h1CombatSource.v1' } else { $null }
    network_replay_fixes = [bool]$NetworkReplayFixes
    wasm_sha256 = (Get-FileHash -LiteralPath (Join-Path $buildPath 'h1-film.wasm')).Hash.ToLowerInvariant()
    glue_sha256 = (Get-FileHash -LiteralPath (Join-Path $buildPath 'h1-film.js')).Hash.ToLowerInvariant()
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $buildPath 'build-candidate.json') -Encoding utf8
