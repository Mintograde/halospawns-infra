param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Output,
    [ValidateSet('beta3', 'h1arena', 'beta4')][string]$Port = 'beta3',
    [switch]$DamageAttribution
)
$ErrorActionPreference = 'Stop'
if ($DamageAttribution -and $Port -ne 'beta4') { throw 'Damage attribution requires the beta4 port.' }
$testName = if ($DamageAttribution) { 'damage-attribution' } else { 'combat-hooks' }
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$worker = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outputPath = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$image = (Get-Content -LiteralPath (Join-Path $worker "engines/$Port/port.json") -Raw | ConvertFrom-Json).toolchain_image
$mounts = @('--rm', '--network', 'none',
    '--mount', "type=bind,source=$sourcePath,target=/source,readonly",
    '--mount', "type=bind,source=$worker,target=/worker,readonly",
    '--mount', "type=bind,source=$outputPath,target=/out")
& docker run @mounts $image emcc -O2 -std=c17 -fms-extensions -fshort-wchar `
    -Wno-microsoft -Wno-incompatible-pointer-types -Wno-int-conversion -Wno-ignored-attributes `
    -DBLAMPC_LOCAL_2V2 -DBLAMPC_TICK_RATE=120 -include /worker/engines/beta3/wasm/prelude.h `
    -I/worker/engines/beta3/wasm/include -I/source/engine -I/source/engine/data -I/source/engine/headers `
    -I/source/host/compat -I/source/host -I/source/host/stubs `
    "/worker/tests/$testName.test.c" -o "/out/$testName.cjs" -sENVIRONMENT=node -sASSERTIONS=1
if ($LASTEXITCODE) { throw 'Combat hook harness compilation failed.' }
& node (Join-Path $outputPath "$testName.cjs")
if ($LASTEXITCODE) { throw 'Combat hook harness failed.' }
