$ErrorActionPreference = "Stop"

$profile = "halospawns-dev"
$region = "us-east-1"
$name = "/halospawns/dev/frontend-site/basic-auth/credentials-base64"
$username = "dev"
$alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

aws ssm get-parameter `
  --profile $profile `
  --region $region `
  --name $name `
  --no-with-decryption `
  --no-cli-pager | Out-Null

$password = -join (1..12 | ForEach-Object {
    $alphabet[[System.Security.Cryptography.RandomNumberGenerator]::GetInt32($alphabet.Length)]
  })

$raw = "${username}:${password}"
$encoded = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes($raw))

aws ssm put-parameter `
  --profile $profile `
  --region $region `
  --name $name `
  --type SecureString `
  --value $encoded `
  --overwrite `
  --no-cli-pager | Out-Null

Write-Host "Username: $username"
Write-Host "Password: $password"
