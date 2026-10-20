param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$ToolchainImage,
    [int]$Jobs = 12,
    [switch]$Profile,
    [switch]$Optimize,
    [ValidateSet('thin', 'full')][string]$Lto = 'full',
    [ValidatePattern('^[a-zA-Z0-9_-]*$')][string]$Architecture = 'haswell',
    [string]$PgoProfile,
    [switch]$GeneratePgo
)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
if (($PgoProfile -or $GeneratePgo) -and !$Optimize) { throw 'PGO requires -Optimize.' }
if ($PgoProfile -and $GeneratePgo) { throw 'Choose PGO generation or consumption, not both.' }
$outputPath = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $outputPath) { throw 'Use a new candidate output directory.' }
$volume = 'h1-linux-candidate-' + [Guid]::NewGuid().ToString('N')
New-Item -ItemType Directory -Path $outputPath | Out-Null
& node (Join-Path $PSScriptRoot 'prepare.mjs') $sourcePath (Join-Path $outputPath 'generated')
if ($LASTEXITCODE) { throw 'Candidate preparation failed.' }
$imageId = & docker image inspect $ToolchainImage --format '{{.Id}}'
if ($LASTEXITCODE) { throw 'Toolchain image missing.' }
& docker volume create $volume | Out-Null
if ($LASTEXITCODE) { throw 'Build volume creation failed.' }
$mounts = @('--rm', '--network', 'none', '--mount', "type=volume,source=$volume,target=/b",
    '--mount', "type=bind,source=$sourcePath,target=/source,readonly",
    '--mount', "type=bind,source=$PSScriptRoot,target=/integration,readonly",
    '--mount', "type=bind,source=$outputPath,target=/out")
$profileFlag = if ($Profile) { 'ON' } else { 'OFF' }
$optimizeFlag = if ($Optimize) { 'ON' } else { 'OFF' }
$pgoFlag = ''
$pgoHash = $null
if ($PgoProfile) {
    $pgoPath = (Resolve-Path -LiteralPath $PgoProfile).Path
    $pgoHash = (Get-FileHash -LiteralPath $pgoPath).Hash.ToLowerInvariant()
    $mounts += @('--mount', "type=bind,source=$pgoPath,target=/pgo.profdata,readonly")
    $pgoFlag = '-DH1_PGO_USE=/pgo.profdata'
} elseif ($GeneratePgo) { $pgoFlag = '-DH1_PGO_GENERATE=/out/pgo' }
& docker run @mounts $imageId sh -ec "cp -a /source /b/src; ln -s fcolor.h /b/src/engine/headers/FCOLOR.h; cp -a /out/generated /b/generated; cmake -S /integration -B /b/obj -G Ninja -DCMAKE_C_COMPILER=clang-18 -DCMAKE_BUILD_TYPE=Release -DH1_SOURCE=/b/src -DH1_GENERATED=/b/generated -DH1_PROFILE=$profileFlag -DH1_OPTIMIZE=$optimizeFlag -DH1_LTO=$Lto -DH1_ARCH=$Architecture $pgoFlag > /out/configure.log 2>&1"
if ($LASTEXITCODE) { throw 'Native configure failed; inspect configure.log.' }
for ($pass = 1; $pass -le 3; $pass++) {
    & docker run @mounts $imageId sh -c "cmake --build /b/obj --parallel $Jobs > /out/build-$pass.log 2>&1"
    $buildExit = $LASTEXITCODE
    Get-Content -LiteralPath (Join-Path $outputPath "build-$pass.log") -Tail 12
    if (!$buildExit) { break }
    & docker run @mounts $imageId cp /b/obj/trap_stubs.c /out/trap_stubs.c
    if ($LASTEXITCODE) { throw 'Cannot read generated stubs.' }
    & node (Join-Path $PSScriptRoot 'trap-stubs.mjs') (Join-Path $outputPath "build-$pass.log") (Join-Path $outputPath 'trap_stubs.c') (Join-Path $sourcePath 'linux_server/data_symbols.txt')
    if ($LASTEXITCODE) { throw 'Native build failed; inspect build log.' }
    & docker run @mounts $imageId cp /out/trap_stubs.c /b/obj/trap_stubs.c
    if ($LASTEXITCODE) { throw 'Cannot stage trap stubs.' }
}
if ($buildExit) { throw 'Native build failed after three passes.' }
& docker run @mounts $imageId sh -ec 'cp /b/obj/server/h1-film-linux /out/; clang-18 -O2 -static /integration/measure.c -o /out/measure; file /out/h1-film-linux; clang-18 --version > /out/toolchain.txt; dpkg-query -W >> /out/toolchain.txt'
if ($LASTEXITCODE) { throw 'Native artifact collection failed.' }
@{
    schema = 'halospawns.h1LinuxCandidateBuild.v1'
    image_id = $imageId
    build_volume = $volume
    profile = [bool]$Profile
    optimize = [bool]$Optimize
    lto = $Lto
    architecture = $Architecture
    generate_pgo = [bool]$GeneratePgo
    pgo_sha256 = $pgoHash
    executable_sha256 = (Get-FileHash -LiteralPath (Join-Path $outputPath 'h1-film-linux')).Hash.ToLowerInvariant()
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'build.json') -Encoding utf8
