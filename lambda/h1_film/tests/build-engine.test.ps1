$ErrorActionPreference = 'Stop'
$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$root = Join-Path $temporaryParent ('h1-build-test-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $root 'source'
$builder = Join-Path $PSScriptRoot '../tools/build-engine.ps1'
$h1BuildTestState = @{ commands = [Collections.Generic.List[object]]::new()
    mutateSource = $false; candidate = $null; source = $source }

# Exercise the real fingerprint/build orchestration without Docker or a compiler.
function docker {
    $h1BuildTestState.commands.Add(@($args))
    if ($h1BuildTestState.mutateSource -and $args -contains '--build') {
        [IO.File]::WriteAllText((Join-Path $h1BuildTestState.source 'host/test.c'), 'changed during build')
    }
    if ($args[-1] -eq '/work/') {
        foreach ($name in @('h1-film.js', 'h1-film.wasm', 'engine.map')) {
            [IO.File]::WriteAllText((Join-Path $h1BuildTestState.candidate $name), 'mock compiler output')
        }
    }
    $global:LASTEXITCODE = 0
}

try {
    New-Item -ItemType Directory -Path (Join-Path $source 'engine'), (Join-Path $source 'host') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $source 'CMakeLists.txt'), 'mock upstream')
    [IO.File]::WriteAllText((Join-Path $source 'engine/test.c'), 'first source version')
    [IO.File]::WriteAllText((Join-Path $source 'host/test.c'), 'host source')
    $h1BuildTestState.candidate = Join-Path $root 'first'
    & $builder -Source $source -Port beta3 -BuildDirectory $h1BuildTestState.candidate -Jobs 1
    $first = Get-Content -LiteralPath (Join-Path $h1BuildTestState.candidate 'build-candidate.json') -Raw | ConvertFrom-Json
    if ($first.status -ne 'candidate_requires_native_parity_and_profile_registration') { throw 'Candidate was incorrectly marked released.' }

    [IO.File]::WriteAllText((Join-Path $source 'engine/test.c'), 'second source version')
    $h1BuildTestState.candidate = Join-Path $root 'second'
    & $builder -Source $source -Port beta3 -BuildDirectory $h1BuildTestState.candidate -Jobs 1
    $second = Get-Content -LiteralPath (Join-Path $h1BuildTestState.candidate 'build-candidate.json') -Raw | ConvertFrom-Json
    if ($first.inputs.source.sha256 -eq $second.inputs.source.sha256) { throw 'Source versions reused one fingerprint.' }
    $configure = @($h1BuildTestState.commands | Where-Object { $_ -contains 'emcmake' })
    if ($configure.Count -ne 2) { throw 'Expected two independent configurations.' }
    $sourceStages = @($configure | ForEach-Object { $_ | Where-Object { $_ -like '-DH1_SOURCE=*' } })
    if ($sourceStages[0] -eq $sourceStages[1]) { throw 'Different sources reused one staged tree.' }

    try {
        & $builder -Source $source -Port beta3 -BuildDirectory $h1BuildTestState.candidate
        throw 'Existing candidate was overwritten.'
    } catch {
        if ($_.Exception.Message -notlike '*new candidate directory*') { throw }
    }
    $h1BuildTestState.candidate = Join-Path $root 'mutating'
    $h1BuildTestState.mutateSource = $true
    try {
        & $builder -Source $source -Port beta3 -BuildDirectory $h1BuildTestState.candidate
        throw 'Mutating source was accepted.'
    } catch {
        if ($_.Exception.Message -notlike '*inputs changed during compilation*') { throw }
    }
    if (Test-Path -LiteralPath (Join-Path $h1BuildTestState.candidate 'build-candidate.json')) { throw 'Invalid build received a candidate manifest.' }
    $h1BuildTestState.mutateSource = $false
    New-Item -ItemType Directory -Path (Join-Path $source 'tools') | Out-Null
    [IO.File]::WriteAllText((Join-Path $source 'tools/build.c'), 'source generation input')
    $fingerprintScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../tools/source-fingerprint.mjs')).Path
    $fingerprint = & node --input-type=module -e 'import {pathToFileURL} from "node:url"; const {fingerprintTree}=await import(pathToFileURL(process.argv[1])); console.log(JSON.stringify(await fingerprintTree(process.argv[2],["CMakeLists.txt","engine","host","tools"])));' $fingerprintScript $source
    if ($LASTEXITCODE) { throw 'Fixture fingerprint failed.' }
    $revision = $fingerprint | ConvertFrom-Json -AsHashtable
    $revision.project = 'h1arena'
    $revision.git_commit = '197bb65ca6e9cef94c126904bf39ecdd1ea5929d'
    $revision.git_date = '2026-10-14'
    $revision | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $source 'source-revision.json') -Encoding utf8
    $h1BuildTestState.candidate = Join-Path $root 'h1arena'
    & $builder -Source $source -Port h1arena -BuildDirectory $h1BuildTestState.candidate -Jobs 1
    $arena = Get-Content -LiteralPath (Join-Path $h1BuildTestState.candidate 'build-candidate.json') -Raw | ConvertFrom-Json
    if ($arena.inputs.source.git_commit -ne $revision.git_commit) { throw 'Source commit was lost.' }
    $arenaConfigure = @($h1BuildTestState.commands | Where-Object { $_ -contains 'emcmake' })[-1]
    if ($arenaConfigure -notcontains "-DH1_SOURCE_COMMIT=$($revision.git_commit)" -or
        $arenaConfigure -notcontains '-DH1_SOURCE_DATE=2026-10-14') { throw 'Observable build identity was not pinned.' }
    [IO.File]::WriteAllText((Join-Path $source 'tools/build.c'), 'changed after snapshot')
    try {
        & $builder -Source $source -Port h1arena -BuildDirectory (Join-Path $root 'changed-snapshot')
        throw 'Changed Git snapshot was accepted.'
    } catch {
        if ($_.Exception.Message -notlike '*Source/port fingerprint failed*') { throw }
    }
    $global:LASTEXITCODE = 0
    Write-Output 'Build orchestration passed: isolated snapshots, no overwrite, mutation rejection.'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $temporaryParent -or
        [IO.Path]::GetFileName($resolved) -notmatch '^h1-build-test-[0-9a-f]{32}$') {
        throw 'Refusing cleanup outside the test temporary directory.'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
