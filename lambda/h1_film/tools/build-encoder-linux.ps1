param(
    [Parameter(Mandatory)][string]$BuildDirectory,
    [int]$Jobs = 8
)
$ErrorActionPreference = 'Stop'
$image = 'rust@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$buildPath = [IO.Path]::GetFullPath($BuildDirectory)
New-Item -ItemType Directory -Force -Path (Join-Path $buildPath 'tmp') | Out-Null
& docker run --rm --mount "type=bind,source=$repo,target=/repo,readonly" `
    --mount "type=bind,source=$buildPath,target=/out" `
    --env CARGO_HOME=/out/cargo-home --env TMPDIR=/out/tmp `
    --env 'RUSTFLAGS=-C target-feature=+crt-static' $image `
    cargo build --locked --release --jobs $Jobs --target x86_64-unknown-linux-gnu `
    --manifest-path /repo/lambda/h1_film/encoder/Cargo.toml --target-dir /out/target
if ($LASTEXITCODE) { throw "Linux encoder build failed: $LASTEXITCODE" }
Write-Output (Join-Path $buildPath 'target/x86_64-unknown-linux-gnu/release/h1-film-encoder')
