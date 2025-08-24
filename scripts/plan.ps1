param (
    [string]$env
)

if (-not $env) {
    Write-Error "Usage: plan.ps1 [dev|prod]"
    exit 1
}

terraform plan -var-file="./configuration/$env/this.tfvars"
