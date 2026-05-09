<#
.SYNOPSIS
Delegates dev.halospawns.com from the halospawns.com parent zone.

.DESCRIPTION
This script reads the public hosted zone created in the halospawns-dev account
and upserts the matching NS delegation record in the halospawns-mgmt parent
hosted zone. Terraform intentionally does not manage the parent-zone record.

Run this after applying the frontend-site component once with
create_delegated_hosted_zone enabled.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter()]
    [string]$ChildZoneName = "dev.halospawns.com",

    [Parameter()]
    [string]$ParentZoneName = "halospawns.com",

    [Parameter()]
    [string]$DevProfile = "halospawns-dev",

    [Parameter()]
    [string]$MgmtProfile = "halospawns-mgmt",

    [Parameter()]
    [ValidateRange(60, 86400)]
    [int]$Ttl = 300
)

$ErrorActionPreference = "Stop"

function Format-DnsName {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    return "$($Name.Trim().TrimEnd('.'))."
}

function Get-PublicHostedZoneByName {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Profile,

        [Parameter(Mandatory = $true)]
        [string]$ZoneName
    )

    $zones = aws route53 list-hosted-zones-by-name `
        --profile $Profile `
        --dns-name $ZoneName `
        --max-items 10 | ConvertFrom-Json

    return @($zones.HostedZones) |
        Where-Object { $_.Name -eq $ZoneName -and -not $_.Config.PrivateZone } |
        Select-Object -First 1
}

$childZoneNameFqdn = Format-DnsName -Name $ChildZoneName
$parentZoneNameFqdn = Format-DnsName -Name $ParentZoneName

$childZone = Get-PublicHostedZoneByName -Profile $DevProfile -ZoneName $childZoneNameFqdn
if (-not $childZone) {
    throw "Could not find public hosted zone $childZoneNameFqdn in profile $DevProfile. Apply '.\scripts\apply.ps1 dev frontend-site' first."
}

$childZoneId = $childZone.Id -replace "^/hostedzone/", ""
$childZoneDetails = aws route53 get-hosted-zone `
    --profile $DevProfile `
    --id $childZoneId | ConvertFrom-Json

$nameServers = @($childZoneDetails.DelegationSet.NameServers) | Sort-Object
if ($nameServers.Count -eq 0) {
    throw "Hosted zone $childZoneNameFqdn did not return any name servers."
}

$parentZone = Get-PublicHostedZoneByName -Profile $MgmtProfile -ZoneName $parentZoneNameFqdn
if (-not $parentZone) {
    throw "Could not find public hosted zone $parentZoneNameFqdn in profile $MgmtProfile."
}

$parentZoneId = $parentZone.Id -replace "^/hostedzone/", ""

Write-Host "Child zone:  $childZoneNameFqdn ($DevProfile / $childZoneId)"
Write-Host "Parent zone: $parentZoneNameFqdn ($MgmtProfile / $parentZoneId)"
Write-Host "Delegating with these name servers:"
$nameServers | ForEach-Object { Write-Host "  $_" }

$changeBatch = @{
    Comment = "Delegate $childZoneNameFqdn to halospawns-dev hosted zone $childZoneId"
    Changes = @(
        @{
            Action            = "UPSERT"
            ResourceRecordSet = @{
                Name            = $childZoneNameFqdn
                Type            = "NS"
                TTL             = $Ttl
                ResourceRecords = @($nameServers | ForEach-Object { @{ Value = $_ } })
            }
        }
    )
}

$changeBatchPath = Join-Path ([System.IO.Path]::GetTempPath()) "halospawns-delegate-$($ChildZoneName.TrimEnd('.') -replace '[^A-Za-z0-9_.-]', '-')-$PID.json"
$changeBatchUri = "file://$changeBatchPath"

try {
    $changeBatch | ConvertTo-Json -Depth 10 | Set-Content -Path $changeBatchPath -Encoding utf8NoBOM

    if ($PSCmdlet.ShouldProcess("$parentZoneNameFqdn in $MgmtProfile", "UPSERT NS record for $childZoneNameFqdn")) {
        aws route53 change-resource-record-sets `
            --profile $MgmtProfile `
            --hosted-zone-id $parentZoneId `
            --change-batch $changeBatchUri
    }
} finally {
    Remove-Item -LiteralPath $changeBatchPath -Force -ErrorAction SilentlyContinue
}
