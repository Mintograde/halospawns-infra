param(
    [Parameter(Mandatory)][string]$Output,
    [string]$ToolchainImage = 'halospawns-h1-encoder:linux-pgo',
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]+$')][string]$TargetVolume,
    [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Architecture = 'haswell',
    [ValidateRange(1, 32)][int]$Jobs = 8,
    [switch]$Pipeline,
    [switch]$CachedSpawns,
    [string]$PgoProfile,
    [switch]$GeneratePgo
)
$ErrorActionPreference = 'Stop'
if ($PgoProfile -and $GeneratePgo) { throw 'Choose PGO generation or consumption, not both.' }
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../../..')).Path
$outputPath = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $outputPath) { throw 'Use a new encoder output directory.' }
New-Item -ItemType Directory -Path $outputPath | Out-Null
$inputs = & node (Join-Path $PSScriptRoot 'encoder-inputs.mjs') | ConvertFrom-Json
if ($LASTEXITCODE) { throw 'Encoder fingerprint failed.' }
$inputs | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath 'inputs.json') -Encoding utf8
foreach ($entry in $inputs.entries) {
    $destination = Join-Path $outputPath "source/$entry"
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $entry) -Destination $destination -Recurse
}
$snapshot = & node (Join-Path $PSScriptRoot 'encoder-inputs.mjs') (Join-Path $outputPath 'source') | ConvertFrom-Json
if ($LASTEXITCODE -or $snapshot.tree.sha256 -ne $inputs.tree.sha256) { throw 'Encoder source changed during snapshot.' }
$imageId = & docker image inspect $ToolchainImage --format '{{.Id}}'
if ($LASTEXITCODE) { throw 'Encoder toolchain image missing.' }
if (!$TargetVolume) { $TargetVolume = 'h1-linux-encoder-' + [Guid]::NewGuid().ToString('N') }
& docker volume create $TargetVolume | Out-Null
if ($LASTEXITCODE) { throw 'Encoder build volume creation failed.' }
$mounts = @('--rm', '--network', 'none', '--mount', "type=volume,source=$TargetVolume,target=/target",
    '--mount', "type=bind,source=$outputPath/source,target=/build,readonly",
    '--mount', "type=bind,source=$outputPath,target=/out")
$flags = "-C target-feature=+crt-static -C target-cpu=$Architecture"
$features = @()
if ($Pipeline) { $features += 'native-pipeline' }
if ($CachedSpawns) { $features += 'native-cached-spawns' }
$pgoHash = $null
if ($PgoProfile) {
    $pgoPath = (Resolve-Path -LiteralPath $PgoProfile).Path
    $training = Get-Content -LiteralPath (Join-Path (Split-Path $pgoPath) 'build.json') -Raw | ConvertFrom-Json
    if ($training.schema -ne 'halospawns.h1LinuxEncoderBuild.v1' -or !$training.generate_pgo -or
        $training.source_sha256 -ne $inputs.tree.sha256 -or $training.image_id -ne $imageId -or
        ($training.features -join ',') -ne ($features -join ',') -or
        $training.rustflags -ne "$flags -C profile-generate=/bench/rust-pgo") {
        throw 'PGO training must match the exact encoder source, features, architecture and toolchain. Retrain this variant.'
    }
    Copy-Item -LiteralPath $pgoPath -Destination (Join-Path $outputPath 'encoder.profdata')
    $pgoHash = (Get-FileHash -LiteralPath $pgoPath).Hash.ToLowerInvariant()
    $flags += ' -C profile-use=/out/encoder.profdata'
} elseif ($GeneratePgo) { $flags += ' -C profile-generate=/bench/rust-pgo' }
$featureFlag = if ($features.Count) { '--features ' + ($features -join ',') } else { '' }
& docker run @mounts -e 'CARGO_PROFILE_RELEASE_STRIP=false' -e 'CARGO_PROFILE_RELEASE_DEBUG=1' -e "RUSTFLAGS=$flags" $imageId sh -ec "cargo build --locked --offline --release --jobs $Jobs $featureFlag --target x86_64-unknown-linux-gnu --manifest-path lambda/h1_film/encoder/Cargo.toml --target-dir /target > /out/build.log 2>&1; cp /target/x86_64-unknown-linux-gnu/release/h1-film-encoder /out/; rustc -vV > /out/toolchain.txt; cargo -vV >> /out/toolchain.txt"
if ($LASTEXITCODE) { throw 'Encoder build failed; inspect build.log.' }
@{
    schema = 'halospawns.h1LinuxEncoderBuild.v1'
    image_id = $imageId
    target_volume = $TargetVolume
    source_sha256 = $inputs.tree.sha256
    rustflags = $flags
    features = $features
    generate_pgo = [bool]$GeneratePgo
    pgo_sha256 = $pgoHash
    executable_sha256 = (Get-FileHash -LiteralPath (Join-Path $outputPath 'h1-film-encoder')).Hash.ToLowerInvariant()
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath 'build.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $outputPath 'build.log') -Tail 12
