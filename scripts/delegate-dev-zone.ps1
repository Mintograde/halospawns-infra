<#
.SYNOPSIS
Backward-compatible wrapper for delegating dev.halospawns.com.
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

$delegateScript = Join-Path $PSScriptRoot "delegate-zone.ps1"
$arguments = @{
    ChildZoneName          = $ChildZoneName
    ParentZoneName         = $ParentZoneName
    ChildProfile           = $DevProfile
    ParentProfile          = $MgmtProfile
    ExpectedChildAccountId = "283279960672"
    ExpectedParentAccountId = "862739531359"
    Ttl                    = $Ttl
}

if ($WhatIfPreference) {
    $arguments.WhatIf = $true
}

& $delegateScript @arguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
