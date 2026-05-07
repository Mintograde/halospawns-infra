param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack,

    [Parameter(Position = 1)]
    [string]$Component
)

if (-not $Component) {
    if ($Stack -eq "prod") {
        Write-Error "Prod Atmos components are disabled until backend bootstrap is ready."
        exit 1
    }

    $commandText = "atmos workflow apply-$Stack --file apply"
    Write-Host "+ $commandText"

    atmos workflow "apply-$Stack" --file apply
    if ($LASTEXITCODE -ne 0) {
        exit 1
    }

    exit 0
}

$commandText = "atmos terraform apply $Component -s $Stack"
Write-Host "+ $commandText"

atmos terraform apply $Component -s $Stack
if ($LASTEXITCODE -ne 0) {
    exit 1
}
