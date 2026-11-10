[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Film,
    [Parameter(Mandatory)][string]$Map,
    [Parameter(Mandatory)][string]$Output,
    [string]$Image = 'halospawns-h1-film:20261109-r4',
    # A prior run's code/ directory permits comparisons against frozen source.
    [string]$CodeSource,
    [ValidateRange(1,16)][int]$ClientConcurrency = 1,
    [ValidateRange(128,10240)][int]$MemoryMb = 3008,
    [switch]$OverlapHost,
    [switch]$Fanout,
    # Diagnostic ceiling only: extra aggregate CPU is not a single Lambda setting.
    [ValidateRange(0,48)][double]$AggregateCpuQuota = 0
)
$ErrorActionPreference = 'Stop'
if ($Fanout -and ($MemoryMb -ne 3008 -or $ClientConcurrency -ne 4 -or !$OverlapHost -or $AggregateCpuQuota)) {
    throw 'Offline fan-out requires 3008 MB, four clients, host overlap and no aggregate override'
}
$runtimeRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$codeSourcePath = if ($CodeSource) { (Resolve-Path -LiteralPath $CodeSource).Path } else { $runtimeRoot }
if (!(Test-Path -LiteralPath (Join-Path $codeSourcePath 'runtime')) -or
    !(Test-Path -LiteralPath (Join-Path $codeSourcePath 'convert.mjs'))) {
    throw 'CodeSource must contain runtime/ and convert.mjs'
}
$filmPath = (Resolve-Path -LiteralPath $Film).Path
$mapPath = (Resolve-Path -LiteralPath $Map).Path
if (Test-Path -LiteralPath $Output) { throw 'Output must be a fresh directory' }
New-Item -ItemType Directory -Path $Output | Out-Null
$outputPath = (Resolve-Path -LiteralPath $Output).Path
$codePath = Join-Path $outputPath 'code'
New-Item -ItemType Directory -Path $codePath | Out-Null
Copy-Item -LiteralPath (Join-Path $codeSourcePath 'runtime') -Destination $codePath -Recurse
Copy-Item -LiteralPath (Join-Path $codeSourcePath 'convert.mjs') -Destination $codePath
$codeHashes = @(Get-ChildItem -LiteralPath $codePath -Recurse -File | Sort-Object FullName | ForEach-Object {
    @{path=[IO.Path]::GetRelativePath($codePath,$_.FullName);sha256=(Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant()}
})
$cpus = ($MemoryMb / 1769.0).ToString('0.000000', [Globalization.CultureInfo]::InvariantCulture)
$scope = 'offline worker including packing and finalization; excludes cloud network and startup'
if ($AggregateCpuQuota -gt 0) {
    if (!$OverlapHost -or $ClientConcurrency -lt 2) { throw 'Aggregate CPU experiment requires concurrent worlds' }
    $cpus = $AggregateCpuQuota.ToString('0.000000', [Globalization.CultureInfo]::InvariantCulture)
    $scope = 'optimistic distributed compute ceiling only; NOT a single Lambda configuration; excludes dispatch, startup and transfers'
}
if ($Fanout) { $scope = 'offline isolated 3008 MB parent/client containers with shared disk; excludes AWS dispatch, cold starts and transfers' }
$imageId = docker image inspect --format '{{.Id}}' $Image
if ($LASTEXITCODE) { throw 'Image inspection failed' }
@{image=$Image;image_id=$imageId;film=$filmPath;map=$mapPath;cpus=$cpus;memory_mb=$MemoryMb;
  runtime_source=$codeSourcePath;exceeds_confirmed_account_memory_cap=($MemoryMb -gt 3008);
  client_concurrency=$ClientConcurrency;overlap_host=[bool]$OverlapHost;
  aggregate_cpu_experiment=($AggregateCpuQuota -gt 0);
  fanout=[bool]$Fanout;
  output_storage='Linux Docker volume /tmp (disk, not tmpfs)';
  scope=$scope} |
    ConvertTo-Json | Set-Content (Join-Path $outputPath 'configuration.json')
$codeHashes | ConvertTo-Json | Set-Content (Join-Path $outputPath 'runtime-hashes.json')
if ($Fanout) {
    & node (Join-Path $PSScriptRoot 'benchmark-fanout.mjs') $runtimeRoot $outputPath
    if ($LASTEXITCODE) { throw 'Isolated fan-out benchmark failed' }
    Get-Content -Raw (Join-Path $outputPath 'stages.json') | ConvertFrom-Json | Select-Object -ExpandProperty spans
    return
}
docker run --rm --network none --read-only --cpus $cpus --memory "${MemoryMb}m" --memory-swap "${MemoryMb}m" `
    --env PYTHONPATH=/var/task --env PYTHONDONTWRITEBYTECODE=1 `
    --env H1_BENCH_EVIDENCE=/evidence --env "H1_BENCH_CLIENTS=$ClientConcurrency" `
    --env "H1_BENCH_OVERLAP=$([int][bool]$OverlapHost)" `
    --mount 'type=volume,target=/tmp' `
    --mount "type=bind,source=$filmPath,target=/input/film.h1film,readonly" `
    --mount "type=bind,source=$mapPath,target=/input/$([IO.Path]::GetFileName($mapPath)),readonly" `
    --mount "type=bind,source=$outputPath,target=/evidence" `
    --mount "type=bind,source=$runtimeRoot,target=/checks,readonly" `
    --mount "type=bind,source=$codePath/runtime,target=/var/task/runtime,readonly" `
    --mount "type=bind,source=$codePath/convert.mjs,target=/var/task/convert.mjs,readonly" `
    --mount "type=bind,source=$runtimeRoot/tests,target=/var/task/h1_film/tests,readonly" `
    --entrypoint /var/lang/bin/python3.12 $Image /checks/tools/benchmark-worker.py `
    --film /input/film.h1film --map "/input/$([IO.Path]::GetFileName($mapPath))" `
    --output /tmp/benchmark-products --analytics-revision 5 --exporter-revision 24 --viewer-revision 10 `
    *> (Join-Path $outputPath 'run.log')
if ($LASTEXITCODE) { throw "Worker benchmark failed: $outputPath/run.log" }
Get-Content -Raw (Join-Path $outputPath 'stages.json') | ConvertFrom-Json | Select-Object -ExpandProperty spans
