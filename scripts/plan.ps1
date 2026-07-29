param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack,

    [Parameter(Position = 1)]
    [string]$Component
)

if (-not $Component) {
    if ($Stack -eq "prod") {
        Write-Error "Prod uses a staged rollout. Supply a component name or run an explicit prod workflow."
        exit 1
    }

    $commandText = "atmos workflow plan-$Stack --file plan"
    Write-Host "+ $commandText"

    atmos workflow "plan-$Stack" --file plan
    if ($LASTEXITCODE -ne 0) {
        exit 1
    }

    exit 0
}

$commandText = "atmos terraform plan $Component -s $Stack"
Write-Host "+ $commandText"

atmos terraform plan $Component -s $Stack
if ($LASTEXITCODE -ne 0) {
    exit 1
}
