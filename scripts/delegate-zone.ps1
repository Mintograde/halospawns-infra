<#
.SYNOPSIS
Delegates a public child hosted zone from the halospawns.com parent zone.

.DESCRIPTION
Reads a child hosted zone from its owning AWS account and upserts only the
matching NS record in the management-account parent zone. Existing apex, www,
and unrelated records are never read into Terraform or modified.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter(Mandatory = $true)]
    [string]$ChildZoneName,

    [Parameter()]
    [string]$ParentZoneName = "halospawns.com",

    [Parameter(Mandatory = $true)]
    [string]$ChildProfile,

    [Parameter()]
    [string]$ParentProfile = "halospawns-mgmt",

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[0-9]{12}$")]
    [string]$ExpectedChildAccountId,

    [Parameter()]
    [ValidatePattern("^[0-9]{12}$")]
    [string]$ExpectedParentAccountId = "862739531359",

    [Parameter()]
    [ValidateRange(60, 86400)]
    [int]$Ttl = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is required to delegate a hosted zone."
}

function Invoke-AwsJson {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Profile,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & aws --profile $Profile --no-cli-pager @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI command failed for profile $Profile."
    }

    return $output | ConvertFrom-Json
}

function Assert-AwsAccount {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Profile,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedAccountId
    )

    $identity = Invoke-AwsJson -Profile $Profile -Arguments @(
        "sts",
        "get-caller-identity",
        "--output",
        "json"
    )

    if ($identity.Account -ne $ExpectedAccountId) {
        throw "AWS profile $Profile resolved to account $($identity.Account); expected $ExpectedAccountId."
    }
}

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

    $zones = Invoke-AwsJson -Profile $Profile -Arguments @(
        "route53",
        "list-hosted-zones-by-name",
        "--dns-name",
        $ZoneName,
        "--max-items",
        "10",
        "--output",
        "json"
    )

    return @($zones.HostedZones) |
        Where-Object { $_.Name -eq $ZoneName -and -not $_.Config.PrivateZone } |
        Select-Object -First 1
}

Assert-AwsAccount -Profile $ChildProfile -ExpectedAccountId $ExpectedChildAccountId
Assert-AwsAccount -Profile $ParentProfile -ExpectedAccountId $ExpectedParentAccountId

$childZoneNameFqdn = Format-DnsName -Name $ChildZoneName
$parentZoneNameFqdn = Format-DnsName -Name $ParentZoneName

$childZone = Get-PublicHostedZoneByName -Profile $ChildProfile -ZoneName $childZoneNameFqdn
if (-not $childZone) {
    throw "Could not find public hosted zone $childZoneNameFqdn in profile $ChildProfile."
}

$childZoneId = $childZone.Id -replace "^/hostedzone/", ""
$childZoneDetails = Invoke-AwsJson -Profile $ChildProfile -Arguments @(
    "route53",
    "get-hosted-zone",
    "--id",
    $childZoneId,
    "--output",
    "json"
)

$nameServers = @($childZoneDetails.DelegationSet.NameServers) | Sort-Object
if ($nameServers.Count -eq 0) {
    throw "Hosted zone $childZoneNameFqdn did not return any name servers."
}

$parentZone = Get-PublicHostedZoneByName -Profile $ParentProfile -ZoneName $parentZoneNameFqdn
if (-not $parentZone) {
    throw "Could not find public hosted zone $parentZoneNameFqdn in profile $ParentProfile."
}

$parentZoneId = $parentZone.Id -replace "^/hostedzone/", ""

Write-Host "Child zone:  $childZoneNameFqdn ($ChildProfile / $childZoneId)"
Write-Host "Parent zone: $parentZoneNameFqdn ($ParentProfile / $parentZoneId)"
Write-Host "Delegating with these name servers:"
$nameServers | ForEach-Object { Write-Host "  $_" }

$changeBatch = @{
    Comment = "Delegate $childZoneNameFqdn to account $ExpectedChildAccountId hosted zone $childZoneId"
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

$safeChildName = $ChildZoneName.TrimEnd(".") -replace "[^A-Za-z0-9_.-]", "-"
$changeBatchPath = Join-Path ([System.IO.Path]::GetTempPath()) "halospawns-delegate-$safeChildName-$PID.json"
$changeBatchUri = "file://$($changeBatchPath.Replace('\', '/'))"

try {
    $changeBatch | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $changeBatchPath -Encoding utf8NoBOM

    if ($PSCmdlet.ShouldProcess("$parentZoneNameFqdn in $ParentProfile", "UPSERT NS record for $childZoneNameFqdn")) {
        $change = Invoke-AwsJson -Profile $ParentProfile -Arguments @(
            "route53",
            "change-resource-record-sets",
            "--hosted-zone-id",
            $parentZoneId,
            "--change-batch",
            $changeBatchUri,
            "--output",
            "json"
        )

        & aws --profile $ParentProfile --no-cli-pager route53 wait resource-record-sets-changed --id $change.ChangeInfo.Id
        if ($LASTEXITCODE -ne 0) {
            throw "Timed out waiting for Route 53 change $($change.ChangeInfo.Id)."
        }

        Write-Host "Delegation is INSYNC: $childZoneNameFqdn"
    }
}
finally {
    Remove-Item -LiteralPath $changeBatchPath -Force -ErrorAction SilentlyContinue
}
