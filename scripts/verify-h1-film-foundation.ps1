[CmdletBinding()]
param([Parameter(Mandatory)][string]$Tag)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$account = '283279960672'
$function = 'halospawns-h1-film-dev'
$repository = 'halospawns-h1-film'
$common = @('--profile', 'halospawns-dev', '--region', 'us-east-1', '--output', 'json', '--no-cli-pager')
function Read-Aws {
    param([string[]]$Arguments)
    $json = & aws @Arguments @common
    if ($LASTEXITCODE -ne 0) { throw "AWS read failed: $($Arguments[0..1] -join ' ')" }
    $json | ConvertFrom-Json
}
if ((Read-Aws @('sts', 'get-caller-identity')).Account -ne $account) { throw 'Not the dev account.' }
$repo = (Read-Aws @('ecr', 'describe-repositories', '--repository-names', $repository)).repositories[0]
if ($repo.imageTagMutability -ne 'IMMUTABLE') { throw 'H1 release tags are not immutable.' }
$image = (Read-Aws @('ecr', 'describe-images', '--repository-name', $repository, '--image-ids', "imageTag=$Tag")).imageDetails[0]
$expectedImage = "$($repo.repositoryUri)@$($image.imageDigest)"
$deployed = Read-Aws @('lambda', 'get-function', '--function-name', $function)
$config = $deployed.Configuration
if ($config.State -ne 'Active' -or $config.LastUpdateStatus -ne 'Successful' -or
    $config.PackageType -ne 'Image' -or $deployed.Code.ResolvedImageUri -ne $expectedImage) {
    throw 'The expected H1 image is not active.'
}
$vars = $config.Environment.Variables
if ($vars.ENVIRONMENT -ne 'dev' -or $vars.H1_WORKER_MODE -ne 'foundation' -or
    $vars.H1_ENGINE_ROOT -ne '/var/task/engines' -or @($vars.PSObject.Properties).Count -ne 3) {
    throw 'Unexpected H1 environment contract.'
}
$concurrency = Read-Aws @('lambda', 'get-function-concurrency', '--function-name', $function)
if ($concurrency.ReservedConcurrentExecutions -ne 0) { throw 'H1 concurrency must be zero.' }
$mappings = Read-Aws @('lambda', 'list-event-source-mappings', '--function-name', $function)
if (@($mappings.EventSourceMappings).Count) { throw 'H1 must have no event source mappings.' }
$urls = Read-Aws @('lambda', 'list-function-url-configs', '--function-name', $function)
if (@($urls.FunctionUrlConfigs).Count) { throw 'H1 must have no function URL.' }
$policy = & aws lambda get-policy --function-name $function @common 2>&1
if ($LASTEXITCODE -eq 0 -or ($policy -join "`n") -notmatch 'ResourceNotFoundException') {
    throw 'Expected no H1 resource-based invocation policy.'
}
$role = ($config.Role -split '/')[-1]
$attached = Read-Aws @('iam', 'list-attached-role-policies', '--role-name', $role)
if (@($attached.AttachedPolicies).Count) { throw 'Unexpected managed policy on H1 execution role.' }
$inline = Read-Aws @('iam', 'list-role-policies', '--role-name', $role)
if (@($inline.PolicyNames).Count -ne 1 -or $inline.PolicyNames[0] -ne 'h1-film-foundation-logs') {
    throw 'Unexpected inline policies on H1 execution role.'
}
$permissions = (Read-Aws @('iam', 'get-role-policy', '--role-name', $role,
    '--policy-name', 'h1-film-foundation-logs')).PolicyDocument
$statement = @($permissions.Statement)
$logArn = "arn:aws:logs:us-east-1:${account}:log-group:/aws/lambda/${function}:*"
if ($statement.Count -ne 1 -or $statement[0].Effect -ne 'Allow' -or
    (@($statement[0].Action | Sort-Object) -join ',') -ne 'logs:CreateLogStream,logs:PutLogEvents' -or
    (@($statement[0].Resource) -join ',') -ne $logArn) {
    throw 'H1 permissions must be limited to its own log streams.'
}
[ordered]@{
    function = $function
    state = $config.State
    image_tag = $Tag
    image_digest = $image.imageDigest
    memory_mb = $config.MemorySize
    timeout_seconds = $config.Timeout
    ephemeral_storage_mb = $config.EphemeralStorage.Size
    reserved_concurrency = 0
    event_source_mappings = 0
    function_urls = 0
    runtime_permissions = 'own log streams only'
    intake_enabled = $false
} | ConvertTo-Json
