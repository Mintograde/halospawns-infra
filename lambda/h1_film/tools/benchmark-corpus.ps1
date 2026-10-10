param(
    [Parameter(Mandatory)][string]$BaselineImage,
    [Parameter(Mandatory)][string]$CandidateImage,
    [Parameter(Mandatory)][string]$FilmsDirectory,
    [Parameter(Mandatory)][string]$MapsDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$CandidateEncoder,
    [string]$NativeModule,
    [switch]$AllFilms
)
$ErrorActionPreference = 'Stop'
if ($CandidateEncoder) { $CandidateEncoder = (Resolve-Path -LiteralPath $CandidateEncoder).Path }
if ($NativeModule) { $NativeModule = (Resolve-Path -LiteralPath $NativeModule).Path }
$root = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $root) { throw 'Corpus output must be a new directory.' }
$films = @(
    foreach ($film in Get-ChildItem -LiteralPath $FilmsDirectory -Filter '*.h1film' -File) {
        $inspection = & node (Join-Path $PSScriptRoot '../runtime/inspect.mjs') $film.FullName | ConvertFrom-Json
        if ($LASTEXITCODE) { throw "Unsupported film: $($film.Name)" }
        [pscustomobject]@{
            film = $film.FullName
            map = $inspection.envelope.map
            ticks = $inspection.envelope.ticks
            map_bytes = $inspection.envelope.map_bytes
            profile = $inspection.profile
        }
    }
)
if (-not $films.Count) { throw 'No films found.' }
if (-not $AllFilms) {
    $films = @($films | Group-Object map | ForEach-Object { $_.Group | Sort-Object ticks, film | Select-Object -First 1 })
}
$films = @($films | Sort-Object map, film)
foreach ($film in $films) {
    if ($film.map -notmatch '^[a-z0-9_-]+$') { throw 'Invalid map scenario name.' }
    $map = Get-Item -LiteralPath (Join-Path $MapsDirectory "$($film.map).map")
    if ($map.Length -ne $film.map_bytes) { throw "Map size mismatch: $($film.map)" }
}
New-Item -ItemType Directory -Path $root | Out-Null
$films | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'selection.json') -Encoding utf8
$results = [Collections.Generic.List[object]]::new()
for ($i = 0; $i -lt $films.Count; $i++) {
    $film = $films[$i]
    $name = '{0:d2}-{1}' -f $i, $film.map
    $map = Join-Path $MapsDirectory "$($film.map).map"
    $images = @{ baseline = $BaselineImage; candidate = $CandidateImage }
    $order = if ($i % 2) { @('candidate', 'baseline') } else { @('baseline', 'candidate') }
    $errors = @{}
    foreach ($side in $order) {
        Write-Host "[$($i + 1)/$($films.Count)] $name $side"
        try {
            $overrides = @{}
            if ($side -eq 'candidate') {
                if ($CandidateEncoder) { $overrides.CandidateEncoder = $CandidateEncoder }
                if ($NativeModule) { $overrides.NativeModule = $NativeModule }
            }
            & (Join-Path $PSScriptRoot 'benchmark.ps1') -Image $images[$side] -Film $film.film -Map $map -OutputDirectory (Join-Path $root "$name-$side") @overrides
        } catch {
            $errors[$side] = $_.Exception.Message
        }
    }
    if ($errors.Count) {
        $result = [pscustomobject]@{ film = $film.film; map = $film.map; status = 'failed'; errors = $errors }
    } else {
        $comparison = & node (Join-Path $PSScriptRoot 'compare-performance.mjs') --baseline (Join-Path $root "$name-baseline/worker") --candidate (Join-Path $root "$name-candidate/worker") --output (Join-Path $root "$name-comparison.json")
        if ($LASTEXITCODE) { throw "Product comparison failed for $name" }
        $result = [pscustomobject]@{ film = $film.film; map = $film.map; status = 'verified'; comparison = ($comparison | ConvertFrom-Json) }
    }
    $results.Add($result)
    $results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $root 'results.json') -Encoding utf8
}
if (@($results | Where-Object status -NE 'verified').Count) { throw 'Some corpus films failed; inspect results.json and individual logs.' }
