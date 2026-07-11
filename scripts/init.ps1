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

    $components = @(
        "tfstate-backend",
        "frontend-site",
        "app-api",
        "uploads-ingest",
        "ecr",
        "map-processing"
    )

    foreach ($componentName in $components) {
        $commandText = "atmos terraform init $componentName -s $Stack"
        Write-Host "+ $commandText"

        atmos terraform init $componentName -s $Stack
        if ($LASTEXITCODE -ne 0) {
            exit 1
        }
    }

    exit 0
}

$commandText = "atmos terraform init $Component -s $Stack"
Write-Host "+ $commandText"

atmos terraform init $Component -s $Stack
if ($LASTEXITCODE -ne 0) {
    exit 1
}
