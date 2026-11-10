[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Film,
    [Parameter(Mandatory)][string]$Map,
    [Parameter(Mandatory)][string]$Output,
    [string]$Image = 'halospawns-h1-film:20261109-r4',
    [int]$ClientConcurrency = 1,
    [int]$Cpus = 2,
    [int]$MemoryMb = 6000
)
$ErrorActionPreference = 'Stop'
$runtimeRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$filmPath = (Resolve-Path -LiteralPath $Film).Path
$mapPath = (Resolve-Path -LiteralPath $Map).Path
if (Test-Path -LiteralPath $Output) { throw 'Output must be a fresh directory' }
New-Item -ItemType Directory -Path $Output | Out-Null
$outputPath = (Resolve-Path -LiteralPath $Output).Path
$scenario = [IO.Path]::GetFileNameWithoutExtension($mapPath)
@{schema='halospawns.h1FilmMapCatalog.v1';maps=@(@{
    engine_profile='h1-performance-beta6-p9839-wasm-v1';scenario=$scenario
    size_bytes=(Get-Item -LiteralPath $mapPath).Length
    sha256=(Get-FileHash -LiteralPath $mapPath -Algorithm SHA256).Hash.ToLower()
})} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $outputPath 'catalog.json')
@{image=$Image;film=$filmPath;map=$mapPath;cpus=$Cpus;memory_mb=$MemoryMb;
  client_concurrency=$ClientConcurrency;output_storage='host bind mount';
  scope='conversion only; excludes match packing, cloud I/O and startup'} |
    ConvertTo-Json | Set-Content (Join-Path $outputPath 'configuration.json')
docker run --rm --network none --cpus $Cpus --memory "${MemoryMb}m" `
    --mount "type=bind,source=$filmPath,target=/input/film.h1film,readonly" `
    --mount "type=bind,source=$mapPath,target=/assets/maps/$scenario.map,readonly" `
    --mount "type=bind,source=$outputPath,target=/evidence" `
    --mount "type=bind,source=$runtimeRoot/runtime,target=/var/task/runtime,readonly" `
    --mount "type=bind,source=$runtimeRoot/convert.mjs,target=/var/task/convert.mjs,readonly" `
    --entrypoint /var/lang/bin/node $Image /var/task/convert.mjs `
    --film /input/film.h1film --assets /assets --encoder /var/task/bin/h1-film-encoder `
    --output /evidence/result --map-catalog /evidence/catalog.json `
    --trusted-local --skip-readback --source-viewer-only --analytics `
    --analytics-revision 5 --exporter-revision 24 --viewer-revision 5 `
    --client-concurrency $ClientConcurrency *> (Join-Path $outputPath 'run.log')
if ($LASTEXITCODE) { throw "Conversion failed: $outputPath/run.log" }
Get-Content -Raw (Join-Path $outputPath 'result/report.json') |
    ConvertFrom-Json | Select-Object -ExpandProperty timing
