param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$worker = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outputPath = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $outputPath) { throw 'Use a new particle-count test output directory.' }
$inputs = & node (Join-Path $worker 'tools/describe-build.mjs') --source $sourcePath --port beta4
if ($LASTEXITCODE) { throw 'Pinned source verification failed.' }
$image = ($inputs | ConvertFrom-Json).port.toolchain_image
New-Item -ItemType Directory -Path $outputPath | Out-Null
$inputs | Set-Content -LiteralPath (Join-Path $outputPath 'build-inputs.json') -Encoding utf8
$mounts = @('--rm', '--network', 'none',
    '--mount', "type=bind,source=$sourcePath,target=/source,readonly",
    '--mount', "type=bind,source=$worker,target=/worker,readonly",
    '--mount', "type=bind,source=$outputPath,target=/out")
& docker run @mounts $image cmake -DH1_SOURCE=/source -DH1_OUTPUT=/out -P /worker/tests/particle-counts.test.cmake
if ($LASTEXITCODE) { throw 'Particle source transformations failed.' }
$expected = '0860b58c4ec3962c242fc5ba43cbbd64660f240eac221310d51d0858d198209f'
foreach ($variant in @('original', 'candidate')) {
    & docker run @mounts $image emcc -O2 -std=c17 -ffp-contract=off -fno-fast-math `
        -I/source/engine "-I/out/$variant" /worker/tests/particle-counts.test.c `
        "/out/$variant/effect_evaluate_function_integral.c" -o "/out/$variant/particle-counts.cjs" `
        -sENVIRONMENT=node -sNODERAWFS=1 -sASSERTIONS=1 -sEXIT_RUNTIME=1
    if ($LASTEXITCODE) { throw "Particle harness compilation failed: $variant" }
    $corpus = Join-Path $outputPath "$variant/counts.bin"
    & node (Join-Path $outputPath "$variant/particle-counts.cjs") $corpus
    if ($LASTEXITCODE) { throw "Particle harness failed: $variant" }
    if ((Get-Item -LiteralPath $corpus).Length -ne 28800000) { throw 'Particle count corpus is incomplete.' }
    $actual = (Get-FileHash -LiteralPath $corpus).Hash.ToLowerInvariant()
    if (($variant -eq 'candidate') -ne ($actual -eq $expected)) {
        throw "Particle parity or negative-control regression: $variant ($actual)"
    }
}
Write-Output 'Particle count parity passed: 7,200,000 native-reference cases; original WASM negative control differs.'
