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
    Write-Output 'Build orchestration passed: isolated snapshots, no overwrite, mutation rejection.'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $temporaryParent -or
        [IO.Path]::GetFileName($resolved) -notmatch '^h1-build-test-[0-9a-f]{32}$') {
        throw 'Refusing cleanup outside the test temporary directory.'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
