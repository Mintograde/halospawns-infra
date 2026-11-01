[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Image,
    [Parameter(Mandatory)][string]$ManifestPath,
    [string]$CorpusPath = '.build/h1-film-corpus.json'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifestPath = (Resolve-Path -LiteralPath $ManifestPath).Path
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$cases = @(Get-Content -Raw -LiteralPath $CorpusPath | ConvertFrom-Json)
$profiles = @($cases.engine_profile | Sort-Object -Unique)
foreach ($profile in $manifest.defaults.PSObject.Properties.Name) {
    if ($profile -notin $profiles) { throw "Release corpus lacks profile $profile" }
}
$output = Join-Path $repo ".build/h1-contracts/$($manifest.release_id)-$([guid]::NewGuid().ToString('N'))"
$archiveRoot = Join-Path $output 'callbacks'
$clientCases = @()
New-Item -ItemType Directory -Path $archiveRoot -Force | Out-Null
docker run --rm --network none --read-only --env PYTHONPATH=/var/task --tmpfs /tmp:rw,nosuid,size=512m `
    --mount "type=bind,source=$repo/lambda/h1_film/tests,target=/var/task/h1_film/tests,readonly" `
    --entrypoint /var/lang/bin/python3.12 $Image -m unittest discover -s /var/task/h1_film/tests -p 'test_*.py' *> (Join-Path $output 'worker-tests.log')
if ($LASTEXITCODE) { throw "Packaged worker tests failed: $output" }
foreach ($case in $cases) {
    if ($case.name -notmatch '^[a-z0-9-]+$') { throw 'Invalid corpus case name.' }
    $film = (Resolve-Path -LiteralPath $case.film).Path
    $map = (Resolve-Path -LiteralPath $case.map).Path
    $recipe = $manifest.defaults.($case.engine_profile)
    docker run --rm --network none --read-only --user 10001:10001 --cpus 2 --memory 3008m `
        --env PYTHONPATH=/var/task --env "H1_WORKER_IMAGE_DIGEST=$($manifest.image_digest)" `
        --tmpfs /tmp:rw,nosuid,size=6g,mode=1777 `
        --mount "type=bind,source=$film,target=/input/film.h1film,readonly" `
        --mount "type=bind,source=$map,target=/input/$([IO.Path]::GetFileName($map)),readonly" `
        --mount "type=bind,source=$manifestPath,target=/input/release.json,readonly" `
        --mount "type=bind,source=$output,target=/evidence" `
        --mount "type=bind,source=$repo/lambda/h1_film,target=/checks,readonly" `
        --mount "type=bind,source=$repo/lambda/h1_film/tests,target=/var/task/h1_film/tests,readonly" `
        --entrypoint /var/lang/bin/python3.12 $Image /checks/tools/verify-cloud.py `
        --film /input/film.h1film --map "/input/$([IO.Path]::GetFileName($map))" `
        --output "/evidence/$($case.name)" --analytics-revision $recipe.analytics_revision `
        --exporter-revision $recipe.exporter_revision --viewer-revision $recipe.viewer_revision `
        --release-manifest /input/release.json *> (Join-Path $output "$($case.name).log")
    if ($LASTEXITCODE) { throw "Packaged film failed: $($case.name). Evidence: $output" }
    $destination = Join-Path $archiveRoot $case.name
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($name in @('finalization.json', 'job.json', 'viewer-rebuild-completion.json',
        'viewer-rebuild-job.json', 'full-reparse-completion.json', 'full-reparse-job.json', 'failure-status.json')) {
        Copy-Item -LiteralPath (Join-Path $output "$($case.name)/$name") -Destination $destination
    }
    Write-Host "Packaged initial/full/viewer callbacks and receipt retries passed: $($case.name)"
    if ($case.PSObject.Properties.Name -contains 'client_film') {
        $client = (Resolve-Path -LiteralPath $case.client_film).Path
        docker run --rm --network none --read-only --user 10001:10001 --cpus 2 --memory 3008m `
            --env PYTHONPATH=/var/task --env "H1_WORKER_IMAGE_DIGEST=$($manifest.image_digest)" `
            --tmpfs /tmp:rw,nosuid,size=6g,mode=1777 `
            --mount "type=bind,source=$film,target=/input/host.h1film,readonly" `
            --mount "type=bind,source=$client,target=/input/client.h1film,readonly" `
            --mount "type=bind,source=$map,target=/input/map.map,readonly" `
            --mount "type=bind,source=$manifestPath,target=/input/release.json,readonly" `
            --mount "type=bind,source=$output,target=/evidence" `
            --mount "type=bind,source=$repo/lambda/h1_film,target=/checks,readonly" `
            --entrypoint /var/lang/bin/python3.12 $Image /checks/tools/verify-client-view.py `
            --host /input/host.h1film --client /input/client.h1film --map /input/map.map `
            --host-output "/evidence/$($case.name)" --output "/evidence/$($case.name)-client" `
            --manifest /input/release.json *> (Join-Path $output "$($case.name)-client.log")
        if ($LASTEXITCODE) { throw "Packaged client failed: $($case.name). Evidence: $output" }
        $clientDestination = Join-Path $archiveRoot "$($case.name)-client"
        New-Item -ItemType Directory -Path $clientDestination | Out-Null
        foreach ($name in @('context.json', 'prepare.json', 'job.json', 'completion.json', 'verification.json', 'client.h1film', 'artifact', 'timeline')) {
            Copy-Item -LiteralPath (Join-Path $output "$($case.name)-client/$name") -Destination $clientDestination
        }
        $clientCases += @{ name = "$($case.name)-client"; engine_profile = $case.engine_profile }
        Write-Host "Packaged client conversion and immutable callback retries passed: $($case.name)"
    }
}
if ($manifest.PSObject.Properties.Name -contains 'client_view_recipes') {
    foreach ($profile in $manifest.client_view_recipes.PSObject.Properties.Name) {
        if ($profile -notin @($clientCases.engine_profile)) { throw "Release corpus lacks a verified client pair for $profile" }
    }
}
$archive = Join-Path $output 'contracts.zip'
Compress-Archive -Path (Join-Path $archiveRoot '*') -DestinationPath $archive
$index = @{
    release_id = $manifest.release_id
    image_digest = $manifest.image_digest
    archive_sha256 = (Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant()
    cases = @($cases | ForEach-Object { @{ name = $_.name; engine_profile = $_.engine_profile } })
}
if ($clientCases.Count) { $index.client_views = $clientCases }
$index | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $output 'validation.json') -Encoding utf8NoBOM
@{ Archive = $archive; Index = (Join-Path $output 'validation.json') }
