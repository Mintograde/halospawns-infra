param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack
)

if ($Stack -eq "prod") {
    Write-Error "Prod bootstrap is not implemented yet. See ATMOS_MIGRATION_PLAN.md Phase 5."
    exit 1
}

$commandText = "atmos workflow bootstrap-$Stack --file bootstrap"
Write-Host "+ $commandText"

atmos workflow "bootstrap-$Stack" --file bootstrap
if ($LASTEXITCODE -ne 0) {
    exit 1
}
