param(
    [Parameter(Mandatory)][string]$Wasm,
    [Parameter(Mandatory)][string]$Profile,
    [Parameter(Mandatory)][string]$BuildDirectory,
    [switch]$OmitHudOdds
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Wasm).Path
$directory = [IO.Path]::GetFullPath($BuildDirectory)
if (Test-Path -LiteralPath $directory) { throw 'Use a new native experiment directory.' }
$registry = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../profiles/registry.json') -Raw | ConvertFrom-Json
$profiles = @($registry.profiles | Where-Object id -EQ $Profile)
if ($profiles.Count -ne 1) { throw 'Expected one retained profile.' }
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sourceHash -ne $profiles[0].wasm_sha256) { throw 'WASM does not match the retained profile.' }
New-Item -ItemType Directory -Path $directory | Out-Null
$image = 'halospawns-h1-wasm2c-build:experiment'
function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE) { throw "$Program failed ($LASTEXITCODE)." }
}
Invoke-Checked docker @('build', '-t', $image, $PSScriptRoot)
$mounts = @('run', '--rm', '--network', 'none', '--memory', '5g',
    '--mount', "type=bind,source=$source,target=/engine.wasm,readonly",
    '--mount', "type=bind,source=$directory,target=/work", $image)
Invoke-Checked docker ($mounts + @('wasm2c', '/engine.wasm', '--module-name', 'h1', '-o', '/work/engine.c'))
Invoke-Checked node @((Join-Path $PSScriptRoot 'generate.mjs'), $directory, $source)
$translation = '/work/engine.c'
if ($OmitHudOdds) {
    Invoke-Checked node @((Join-Path $PSScriptRoot 'omit-hud.mjs'), $directory)
    $translation = '/work/engine-no-hud.c'
}
$flags = @('-O3', '-fPIC', '-shared', '-fno-optimize-sibling-calls', '-frounding-math', '-fsignaling-nans', '-ffp-contract=off')
Invoke-Checked docker ($mounts + @('gcc') + $flags + @('-I/usr/include/node', '-I/usr/share/wabt/wasm2c',
    $translation, '/work/host.c', '/usr/share/wabt/wasm2c/wasm-rt-impl.c', '-lm', '-o', '/work/h1-aot.node'))
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sourceHash) {
    throw 'WASM changed during the experiment build.'
}
$builderId = (Invoke-Checked docker @('image', 'inspect', $image, '--format', '{{.Id}}')).Trim()
$versions = Invoke-Checked docker ($mounts + @('dpkg-query', '--show', 'wabt', 'libnode-dev', 'gcc'))
@{
    status = 'offline_experiment_not_a_registered_engine'
    profile = $Profile
    wasm_sha256 = $sourceHash
    builder_image_id = $builderId
    package_versions = $versions
    compiler_flags = $flags
    omit_hud_odds = [bool]$OmitHudOdds
    translation_sha256 = (Get-FileHash -LiteralPath (Join-Path $directory ([IO.Path]::GetFileName($translation)))).Hash.ToLowerInvariant()
    host_sha256 = (Get-FileHash -LiteralPath (Join-Path $directory 'host.c')).Hash.ToLowerInvariant()
    module_sha256 = (Get-FileHash -LiteralPath (Join-Path $directory 'h1-aot.node')).Hash.ToLowerInvariant()
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $directory 'candidate.json') -Encoding utf8
Write-Output (Join-Path $directory 'h1-aot.node')
