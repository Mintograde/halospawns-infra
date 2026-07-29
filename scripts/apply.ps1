param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("dev", "prod")]
    [string]$Stack,

    [Parameter(Position = 1)]
    [string]$Component
)

if (-not $Component) {
    if ($Stack -eq "prod") {
        Write-Error "Prod aggregate apply is intentionally disabled. Supply one reviewed component name."
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
