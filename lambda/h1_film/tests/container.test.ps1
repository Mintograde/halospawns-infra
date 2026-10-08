param([Parameter(Mandatory)][string]$Image)
$ErrorActionPreference = 'Stop'
$container = $null
try {
    $container = & docker run --detach --rm --read-only --user 1000:1000 `
        --tmpfs /tmp:rw,nosuid,size=256m --publish 127.0.0.1::8080 $Image
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the local Lambda runtime.' }
    $container = $container.Trim()
    $binding = & docker port $container 8080
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') {
        throw 'Could not resolve the loopback-only test port.'
    }
    $uri = "http://127.0.0.1:$($Matches[1])/2015-03-31/functions/function/invocations"
    $health = @{schema = 'halospawns.h1FilmHealth.v1'; action = 'health'} | ConvertTo-Json -Compress
    $response = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Post -ContentType application/json -Body $health -TimeoutSec 15
            break
        } catch {
            if ($attempt -eq 19) { throw }
            Start-Sleep -Milliseconds 250
        }
    }
    if ($response.mode -ne 'foundation' -or $response.intake_enabled -ne $false -or
        $response.runtime.platform -ne 'linux' -or $response.runtime.arch -ne 'x64' -or
        $response.profiles.Count -lt 1 -or $response.encoder_sha256 -notmatch '^[0-9a-f]{64}$') {
        throw "Unexpected runtime health: $($response | ConvertTo-Json -Depth 5 -Compress)"
    }
    $response | ConvertTo-Json -Depth 5
    foreach ($payload in @('{"Records":[{"messageId":"no-ack","body":"{}"}]}',
        '{"schema":"halospawns.h1FilmHealth.v1","action":"health","film":"/tmp/film"}')) {
        $rejected = Invoke-RestMethod -Uri $uri -Method Post -ContentType application/json -Body $payload -TimeoutSec 15
        if ($rejected.errorMessage -notmatch 'intake is not implemented') {
            throw 'The foundation must fail, never acknowledge a job event.'
        }
    }
    Write-Host 'Read-only, non-root Lambda runtime: health and job rejection passed.'
} finally {
    if ($container) {
        & docker stop --time 5 $container | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Failed to stop test container $container" }
    }
}
