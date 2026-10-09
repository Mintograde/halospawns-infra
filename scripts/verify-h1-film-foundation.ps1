[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Tag,
    [ValidateSet('foundation', 'intake')][string]$Mode = 'foundation'
)
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
if ($vars.ENVIRONMENT -ne 'dev' -or $vars.H1_WORKER_MODE -ne $Mode -or
    $vars.H1_ENGINE_ROOT -ne '/var/task/engines') {
    throw 'Unexpected H1 environment contract.'
}
$queueArn = "arn:aws:sqs:us-east-1:${account}:films-processing-queue"
$bucketArn = "arn:aws:s3:::uploads-dev-${account}"
$parameter = '/halospawns/dev/app-api/trusted-clients/h1-film/hmac-secret'
if ($Mode -eq 'foundation' -and @($vars.PSObject.Properties).Count -ne 3) {
    throw 'Foundation environment contains intake configuration.'
}
if ($Mode -eq 'intake' -and (
    $vars.H1_QUEUE_ARN -ne $queueArn -or
    $vars.H1_TOPIC_ARN -ne "arn:aws:sns:us-east-1:${account}:films-uploaded-topic" -or
    $vars.H1_UPLOADS_BUCKET -ne "uploads-dev-${account}" -or
    $vars.APP_API_BASE_URL -ne 'https://api.dev.halospawns.com' -or
    $vars.APP_API_TRUSTED_CLIENT_NAME -ne 'h1-film' -or
    $vars.APP_API_TRUSTED_CLIENT_HMAC_PARAMETER_NAME -ne $parameter -or
    $vars.VIEWER_ARTIFACT_PREFIX -ne 'replays/derived/viewer/' -or
    $vars.SPATIAL_ARTIFACT_PREFIX -ne 'replays/derived/spatial/' -or
    $vars.REPLAY_EXTRACTOR_MODE -ne 'native' -or
    [int]$vars.H1_MAX_SIZE_BYTES -le 0 -or [int]$vars.H1_MAX_SIZE_BYTES -gt 536870912 -or
    [int]$vars.H1_MAX_SOURCE_TICKS -le 0 -or [int]$vars.H1_MAX_SOURCE_TICKS -gt 432000 -or
    [int]$vars.H1_MAX_PLAYERS -le 0 -or [int]$vars.H1_MAX_PLAYERS -gt 4
)) { throw 'Unexpected H1 intake environment contract.' }
$concurrency = Read-Aws @('lambda', 'get-function-concurrency', '--function-name', $function)
if ($concurrency.ReservedConcurrentExecutions -ne 0) { throw 'H1 concurrency must be zero.' }
$mappings = Read-Aws @('lambda', 'list-event-source-mappings', '--function-name', $function)
if ($Mode -eq 'foundation' -and @($mappings.EventSourceMappings).Count) {
    throw 'Foundation must have no event source mappings.'
}
if ($Mode -eq 'intake') {
    if (@($mappings.EventSourceMappings).Count -ne 1) { throw 'Expected one disabled H1 mapping.' }
    $mapping = $mappings.EventSourceMappings[0]
    if ($mapping.State -ne 'Disabled' -or $mapping.EventSourceArn -ne $queueArn -or
        $mapping.BatchSize -ne 1 -or (@($mapping.FunctionResponseTypes) -join ',') -ne 'ReportBatchItemFailures') {
        throw 'H1 queue mapping is not safely dormant.'
    }
}
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
$expectedPolicies = if ($Mode -eq 'intake') { 'h1-film-foundation-logs,h1-film-intake' } else { 'h1-film-foundation-logs' }
if ((@($inline.PolicyNames | Sort-Object) -join ',') -ne $expectedPolicies) {
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
if ($Mode -eq 'intake') {
    $intake = (Read-Aws @('iam', 'get-role-policy', '--role-name', $role,
        '--policy-name', 'h1-film-intake')).PolicyDocument
    function Statement-Key($Value) {
        $condition = if ($Value.PSObject.Properties.Name -contains 'Condition') {
            $Value.Condition | ConvertTo-Json -Depth 5 -Compress
        } else { '' }
        "$($Value.Effect)|$(@($Value.Action | Sort-Object) -join ',')|$(@($Value.Resource | Sort-Object) -join ',')|$condition"
    }
    $expected = @(
        [pscustomobject]@{Effect='Allow'; Action=@('ssm:GetParameter'); Resource=@("arn:aws:ssm:us-east-1:${account}:parameter$parameter")},
        [pscustomobject]@{Effect='Allow'; Action=@('sqs:ReceiveMessage','sqs:DeleteMessage','sqs:GetQueueAttributes'); Resource=@($queueArn)},
        [pscustomobject]@{Effect='Allow'; Action=@('s3:GetObjectVersion'); Resource=@("$bucketArn/films/unprocessed/*","$bucketArn/maps/unprocessed/*","$bucketArn/maps/processed/*")},
        [pscustomobject]@{Effect='Allow'; Action=@('s3:GetObject','s3:PutObject'); Resource=@("$bucketArn/films/derived/*","$bucketArn/replays/derived/viewer/*","$bucketArn/replays/derived/spatial/*")},
        [pscustomobject]@{Effect='Allow'; Action=@('s3:ListBucket'); Resource=@($bucketArn); Condition=[pscustomobject]@{StringLike=[pscustomobject]@{'s3:prefix'=@('replays/derived/viewer/*')}}}
    )
    $actualKeys = @($intake.Statement | ForEach-Object { Statement-Key $_ } | Sort-Object)
    $expectedKeys = @($expected | ForEach-Object { Statement-Key $_ } | Sort-Object)
    if (Compare-Object $actualKeys $expectedKeys) { throw 'H1 intake IAM differs from the exact scoped contract.' }
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
    mode = $Mode
    event_source_mappings = @($mappings.EventSourceMappings).Count
    function_urls = 0
    runtime_permissions = if ($Mode -eq 'intake') { 'scoped S3 versions/derived objects, films SQS, exact SSM, own logs' } else { 'own log streams only' }
    intake_enabled = $false
} | ConvertTo-Json
