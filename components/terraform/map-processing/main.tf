resource "terraform_data" "native_maps_processor_required_inputs" {
  input = {
    github_oidc_provider_arn = local.maps_github_oidc_provider_arn
    map_unprocessed_prefix   = local.map_unprocessed_prefix
    map_processed_prefix     = local.map_processed_prefix
    map_failed_prefix        = local.map_failed_prefix
    map_support_prefix       = local.map_support_resource_prefix
  }

  lifecycle {
    precondition {
      condition     = local.maps_github_oidc_provider_arn != null
      error_message = "GitHub OIDC provider ARN is required. Pass maps_github_oidc_provider_arn, set maps_github_create_oidc_provider = true, or ensure the provider exists in the account."
    }

    precondition {
      condition     = local.map_unprocessed_prefix != "" && local.map_processed_prefix != "" && local.map_failed_prefix != "" && local.map_support_resource_prefix != ""
      error_message = "Map S3 prefixes must be non-empty."
    }
  }
}

resource "aws_s3_bucket" "maps_artifacts" {
  bucket = "${var.project}-maps-artifacts-${var.environment}-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "maps_artifacts" {
  bucket = aws_s3_bucket.maps_artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "maps_artifacts" {
  bucket = aws_s3_bucket.maps_artifacts.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "maps_artifacts" {
  bucket                  = aws_s3_bucket.maps_artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "maps_artifacts" {
  bucket     = aws_s3_bucket.maps_artifacts.id
  policy     = data.aws_iam_policy_document.maps_artifact_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.maps_artifacts]
}

resource "aws_sqs_queue" "map_rendering_dlq" {
  name                      = "map-rendering-dlq"
  message_retention_seconds = var.renderer.queue.message_retention_seconds
}

resource "aws_sqs_queue" "map_rendering" {
  name                       = "map-rendering-queue"
  visibility_timeout_seconds = var.renderer.queue.visibility_timeout_seconds
  message_retention_seconds  = var.renderer.queue.message_retention_seconds
  receive_wait_time_seconds  = var.renderer.queue.receive_wait_time_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.map_rendering_dlq.arn
    maxReceiveCount     = var.renderer.queue.max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "map_rendering" {
  queue_url = aws_sqs_queue.map_rendering_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.map_rendering.arn]
  })
}

module "native_maps_processor" {
  source = "../../../modules/lambda-s3-managed"

  function_name                  = local.native_maps_processor_function_name
  runtime                        = var.native_maps.runtime
  handler                        = var.native_maps.handler
  source_dir                     = "../../../lambda/maps_processor_placeholder"
  alias_name                     = var.native_maps.alias_name
  timeout                        = var.native_maps.lambda.timeout_seconds
  memory_size                    = var.native_maps.lambda.memory_mb
  ephemeral_storage_size         = var.native_maps.lambda.ephemeral_storage_mb
  reserved_concurrent_executions = var.native_maps.lambda.reserved_concurrent_executions

  environment_variables = merge(
    {
      ENVIRONMENT                                    = var.environment
      UPLOADS_BUCKET_NAME                            = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      MAP_UNPROCESSED_PREFIX                         = "${local.map_unprocessed_prefix}/"
      MAP_PROCESSED_PREFIX                           = "${local.map_processed_prefix}/"
      MAP_FAILED_PREFIX                              = "${local.map_failed_prefix}/"
      MAP_SUPPORT_RESOURCE_PREFIX                    = "${local.map_support_resource_prefix}/"
      APP_API_MAP_FINALIZATION_PATH                  = var.callbacks.paths.map_finalization
      APP_API_MAP_SUPPORT_RESOURCE_INGEST_PATH       = var.callbacks.paths.map_support_resource_ingest
      APP_API_MAP_SUPPORT_RESOURCE_RESOLVE_PATH      = var.callbacks.paths.map_support_resource_resolve
      APP_API_UPLOAD_PROCESSING_STATUS_PATH_TEMPLATE = var.callbacks.paths.processing_status_template
      REPORT_BATCH_ITEM_FAILURES                     = tostring(var.native_maps.event_source.report_batch_item_failures)
    },
    var.native_maps.enqueue_render_jobs ? {
      MAP_RENDERING_QUEUE_URL            = aws_sqs_queue.map_rendering.url
      MAP_RENDER_OUTPUT_PREFIX_TEMPLATE  = "${local.map_processed_prefix}/{upload_id}/screenshots/v1/"
      APP_API_MAP_SCREENSHOT_INGEST_PATH = var.callbacks.paths.map_screenshot_ingest
      RENDER_SET_NAME                    = var.renderer.render_set.name
      RENDER_SET_VERSION                 = tostring(var.renderer.render_set.version)
    } : {},
    local.app_api_base_url == null || lookup(local.trusted_service_hmac_secret_ids_by_client, local.native_maps_processor_trusted_hmac_client, null) == null ? {} : {
      APP_API_BASE_URL                      = local.app_api_base_url
      APP_API_TRUSTED_CLIENT_NAME           = local.native_maps_processor_trusted_hmac_client
      APP_API_TRUSTED_CLIENT_HMAC_SECRET_ID = local.trusted_service_hmac_secret_ids_by_client[local.native_maps_processor_trusted_hmac_client]
    },
    var.native_maps.lambda.environment_variables,
  )

  policies_json = concat(
    [data.aws_iam_policy_document.native_maps_processor_s3.json],
    contains(keys(local.trusted_service_hmac_secret_arns_by_client), local.native_maps_processor_trusted_hmac_client) ? [
      data.aws_iam_policy_document.trusted_service_hmac_secret[local.native_maps_processor_trusted_hmac_client].json
    ] : [],
    var.native_maps.enqueue_render_jobs ? [
      data.aws_iam_policy_document.native_maps_processor_map_rendering.json
    ] : [],
  )

  role_policy_arns = [
    "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole",
  ]

  depends_on = [terraform_data.native_maps_processor_required_inputs]
}

resource "aws_lambda_event_source_mapping" "native_maps_processor_sqs_trigger" {
  event_source_arn        = local.upload_pipelines.maps.queue_arn
  function_name           = module.native_maps_processor.alias_arn
  batch_size              = var.native_maps.event_source.batch_size
  enabled                 = var.native_maps.event_source.enabled
  function_response_types = var.native_maps.event_source.report_batch_item_failures ? ["ReportBatchItemFailures"] : []
}

resource "terraform_data" "heatmap_rollup_worker_required_inputs" {
  count = var.heatmap_rollup_worker.enabled ? 1 : 0

  input = {
    app_api_base_url = local.app_api_base_url
    hmac_secret_id   = local.heatmap_rollup_worker_trusted_service_hmac_secret_id
    input_prefix     = local.replay_spatial_artifact_prefix
    output_prefix    = local.heatmap_rollup_artifact_prefix
  }

  lifecycle {
    precondition {
      condition     = local.app_api_base_url != null && local.heatmap_rollup_worker_trusted_service_hmac_secret_id != null && local.heatmap_rollup_worker_trusted_service_hmac_secret_arn != null
      error_message = "The heatmap rollup worker requires an app API base URL and a dedicated heatmap-processing HMAC secret in app-api remote state."
    }

    precondition {
      condition     = local.replay_spatial_artifact_prefix != "" && local.heatmap_rollup_artifact_prefix != "" && local.region_stat_rollup_artifact_prefix != ""
      error_message = "The spatial rollup worker input and output prefixes must be non-empty."
    }
  }
}

resource "aws_sqs_queue" "heatmap_rollup_schedule_dlq" {
  count = var.heatmap_rollup_worker.enabled ? 1 : 0

  name                      = "heatmap-rollup-schedule-dlq"
  message_retention_seconds = var.heatmap_rollup_worker.dlq.message_retention_seconds
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue_policy" "heatmap_rollup_schedule_dlq" {
  count = var.heatmap_rollup_worker.enabled ? 1 : 0

  queue_url = aws_sqs_queue.heatmap_rollup_schedule_dlq[0].id
  policy    = data.aws_iam_policy_document.heatmap_rollup_schedule_dlq[0].json
}

module "heatmap_rollup_worker" {
  count  = var.heatmap_rollup_worker.enabled ? 1 : 0
  source = "../../../modules/lambda-s3-managed"

  function_name                  = local.heatmap_rollup_worker_function_name
  runtime                        = var.heatmap_rollup_worker.runtime
  handler                        = var.heatmap_rollup_worker.handler
  source_dir                     = "../../../lambda/heatmap_rollup_worker"
  alias_name                     = var.heatmap_rollup_worker.alias_name
  timeout                        = var.heatmap_rollup_worker.lambda.timeout_seconds
  memory_size                    = var.heatmap_rollup_worker.lambda.memory_mb
  ephemeral_storage_size         = var.heatmap_rollup_worker.lambda.ephemeral_storage_mb
  reserved_concurrent_executions = var.heatmap_rollup_worker.lambda.reserved_concurrent_executions

  environment_variables = merge(
    {
      ENVIRONMENT                                   = var.environment
      UPLOADS_BUCKET_NAME                           = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      SPATIAL_ARTIFACT_PREFIX                       = "${local.replay_spatial_artifact_prefix}/"
      HEATMAP_ROLLUP_ARTIFACT_PREFIX                = "${local.heatmap_rollup_artifact_prefix}/"
      REGION_STAT_ROLLUP_ARTIFACT_PREFIX            = "${local.region_stat_rollup_artifact_prefix}/"
      REGION_STAT_ROLLUP_SCHEMA                     = "halospawns.regionStatsRollup.v1"
      REGION_STATS_CAPABILITY                       = "region_stats_v1"
      REGION_STATS_ENABLED                          = tostring(var.heatmap_rollup_worker.region_stats.enabled)
      REGION_STATS_MAX_MEMBERSHIP_CHECKS            = tostring(var.heatmap_rollup_worker.region_stats.max_membership_checks)
      APP_API_BASE_URL                              = local.app_api_base_url
      APP_API_TRUSTED_CLIENT_NAME                   = local.heatmap_rollup_worker_trusted_hmac_client
      APP_API_TRUSTED_CLIENT_HMAC_SECRET_ID         = local.heatmap_rollup_worker_trusted_service_hmac_secret_id
      APP_API_HEATMAP_ROLLUP_CLAIM_PATH             = var.callbacks.paths.heatmap_rollup_claim
      APP_API_HEATMAP_ROLLUP_INPUTS_PATH_TEMPLATE   = var.callbacks.paths.heatmap_rollup_inputs_template
      APP_API_HEATMAP_ROLLUP_COMPLETE_PATH_TEMPLATE = var.callbacks.paths.heatmap_rollup_complete_template
      APP_API_HEATMAP_ROLLUP_FAILED_PATH_TEMPLATE   = var.callbacks.paths.heatmap_rollup_failed_template
      HEATMAP_ROLLUP_INPUT_PAGE_LIMIT               = tostring(var.heatmap_rollup_worker.processing.input_page_limit)
      HEATMAP_ROLLUP_MAX_SCOPES_PER_INVOCATION      = tostring(var.heatmap_rollup_worker.processing.max_scopes_per_invocation)
      HEATMAP_ROLLUP_RETRY_AFTER_SECONDS            = tostring(var.heatmap_rollup_worker.processing.retry_after_seconds)
    },
    var.heatmap_rollup_worker.lambda.environment_variables,
  )

  policies_json = [
    data.aws_iam_policy_document.heatmap_rollup_worker_runtime[0].json,
    data.aws_iam_policy_document.trusted_service_hmac_secret[local.heatmap_rollup_worker_trusted_hmac_client].json,
  ]

  depends_on = [terraform_data.heatmap_rollup_worker_required_inputs]
}

resource "aws_cloudwatch_event_rule" "heatmap_rollup" {
  count = var.heatmap_rollup_worker.enabled ? 1 : 0

  name                = "${var.project}-${var.environment}-heatmap-rollup"
  description         = "Claims and builds dirty all-time heatmap rollup scopes."
  schedule_expression = var.heatmap_rollup_worker.schedule.expression
}

resource "aws_cloudwatch_event_target" "heatmap_rollup" {
  count = var.heatmap_rollup_worker.enabled ? 1 : 0

  rule      = aws_cloudwatch_event_rule.heatmap_rollup[0].name
  target_id = "heatmap-rollup-worker"
  arn       = module.heatmap_rollup_worker[0].alias_arn

  dead_letter_config {
    arn = aws_sqs_queue.heatmap_rollup_schedule_dlq[0].arn
  }

  retry_policy {
    maximum_event_age_in_seconds = var.heatmap_rollup_worker.schedule.maximum_event_age_seconds
    maximum_retry_attempts       = var.heatmap_rollup_worker.schedule.maximum_retry_attempts
  }

  depends_on = [aws_sqs_queue_policy.heatmap_rollup_schedule_dlq]
}

resource "aws_lambda_permission" "heatmap_rollup_schedule" {
  count = var.heatmap_rollup_worker.enabled ? 1 : 0

  statement_id  = "AllowHeatmapRollupSchedule"
  action        = "lambda:InvokeFunction"
  function_name = module.heatmap_rollup_worker[0].function_name
  qualifier     = module.heatmap_rollup_worker[0].alias_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.heatmap_rollup[0].arn
}

resource "aws_cloudwatch_metric_alarm" "heatmap_rollup_errors" {
  count = var.heatmap_rollup_worker.enabled && var.heatmap_rollup_worker.alarms.enabled ? 1 : 0

  alarm_name          = "${var.project}-${var.environment}-heatmap-rollup-errors"
  alarm_description   = "Heatmap rollup worker invocations are failing."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = var.heatmap_rollup_worker.alarms.error_evaluation_periods
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = module.heatmap_rollup_worker[0].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "heatmap_rollup_duration" {
  count = var.heatmap_rollup_worker.enabled && var.heatmap_rollup_worker.alarms.enabled ? 1 : 0

  alarm_name          = "${var.project}-${var.environment}-heatmap-rollup-duration"
  alarm_description   = "Heatmap rollup worker duration is approaching the Lambda timeout."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.heatmap_rollup_worker.alarms.duration_threshold_ms
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = module.heatmap_rollup_worker[0].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "heatmap_rollup_dlq" {
  count = var.heatmap_rollup_worker.enabled && var.heatmap_rollup_worker.alarms.enabled ? 1 : 0

  alarm_name          = "${var.project}-${var.environment}-heatmap-rollup-dlq"
  alarm_description   = "The heatmap rollup schedule DLQ contains a failed invocation."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.heatmap_rollup_schedule_dlq[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "heatmap_rollup_scope_failures" {
  count = var.heatmap_rollup_worker.enabled && var.heatmap_rollup_worker.alarms.enabled ? 1 : 0

  alarm_name          = "${var.project}-${var.environment}-heatmap-rollup-scope-failures"
  alarm_description   = "The heatmap rollup worker reported a scope build failure."
  namespace           = "Halospawns/HeatmapRollups"
  metric_name         = "ScopesFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Worker = "heatmap-rollup-worker.v1"
  }
}

module "map_renderer" {
  source = "../../../modules/lambda-s3-managed"

  function_name                  = local.map_renderer_function_name
  runtime                        = var.renderer.runtime
  handler                        = var.renderer.handler
  source_dir                     = "../../../lambda/map_renderer_placeholder"
  alias_name                     = var.renderer.alias_name
  timeout                        = var.renderer.lambda.timeout_seconds
  memory_size                    = var.renderer.lambda.memory_mb
  ephemeral_storage_size         = var.renderer.lambda.ephemeral_storage_mb
  reserved_concurrent_executions = var.renderer.lambda.reserved_concurrent_executions

  environment_variables = merge(
    {
      ENVIRONMENT                        = var.environment
      UPLOADS_BUCKET_NAME                = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      MAP_RENDER_OUTPUT_PREFIX_TEMPLATE  = "${local.map_processed_prefix}/{upload_id}/screenshots/v1/"
      APP_API_MAP_SCREENSHOT_INGEST_PATH = var.callbacks.paths.map_screenshot_ingest
      APP_API_TRUSTED_CLIENT_NAME        = local.map_renderer_trusted_hmac_client
      REPORT_BATCH_ITEM_FAILURES         = tostring(var.renderer.event_source.report_batch_item_failures)
      RENDER_SET_NAME                    = var.renderer.render_set.name
      RENDER_SET_VERSION                 = tostring(var.renderer.render_set.version)
    },
    local.app_api_base_url == null || local.map_renderer_trusted_service_hmac_secret_id == null ? {} : {
      APP_API_BASE_URL                      = local.app_api_base_url
      APP_API_TRUSTED_CLIENT_HMAC_SECRET_ID = local.map_renderer_trusted_service_hmac_secret_id
    },
    var.renderer.lambda.environment_variables,
  )

  policies_json = [data.aws_iam_policy_document.map_renderer_runtime.json]

  role_policy_arns = [
    "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole",
  ]
}

resource "aws_lambda_event_source_mapping" "map_renderer_sqs_trigger" {
  event_source_arn        = aws_sqs_queue.map_rendering.arn
  function_name           = module.map_renderer.alias_arn
  batch_size              = var.renderer.event_source.batch_size
  enabled                 = var.renderer.event_source.enabled
  function_response_types = var.renderer.event_source.report_batch_item_failures ? ["ReportBatchItemFailures"] : []
}

module "maps_code_updater" {
  source = "../../../modules/lambda-code-updater"

  function_name           = "${var.project}-${var.environment}-maps-code-updater"
  role_name               = "${var.project}-${var.environment}-maps-code-updater-exec-role"
  policy_name             = "maps-code-updater"
  permission_statement_id = "AllowMapsArtifactBucket"
  source_dir              = "${path.root}/../../../lambda/app_api_code_updater"
  output_path             = "${path.root}/maps-code-updater.zip"

  artifact_bucket_arn       = aws_s3_bucket.maps_artifacts.arn
  artifact_release_prefix   = local.normalized_maps_artifact_release_prefix
  target_function_name      = module.native_maps_processor.function_name
  target_function_arn       = module.native_maps_processor.function_arn
  target_alias_name         = module.native_maps_processor.alias_name
  target_alias_arn          = module.native_maps_processor.alias_arn
  update_code_statement_sid = "UpdateNativeMapsProcessorCode"

  reserved_concurrent_executions = var.release.maps.updater_reserved_concurrent_executions
}

module "map_renderer_code_updater" {
  source = "../../../modules/lambda-code-updater"

  function_name           = "${var.project}-${var.environment}-map-renderer-code-updater"
  role_name               = "${var.project}-${var.environment}-map-renderer-code-updater-exec-role"
  policy_name             = "map-renderer-code-updater"
  permission_statement_id = "AllowMapRendererArtifactBucket"
  source_dir              = "${path.root}/../../../lambda/app_api_code_updater"
  output_path             = "${path.root}/map-renderer-code-updater.zip"

  artifact_bucket_arn       = aws_s3_bucket.maps_artifacts.arn
  artifact_release_prefix   = local.normalized_map_renderer_release_prefix
  target_function_name      = module.map_renderer.function_name
  target_function_arn       = module.map_renderer.function_arn
  target_alias_name         = module.map_renderer.alias_name
  target_alias_arn          = module.map_renderer.alias_arn
  update_code_statement_sid = "UpdateMapRendererCode"

  reserved_concurrent_executions = var.release.renderer.updater_reserved_concurrent_executions
}

resource "aws_s3_bucket_notification" "maps_release_artifacts" {
  bucket = aws_s3_bucket.maps_artifacts.id

  lambda_function {
    lambda_function_arn = module.maps_code_updater.function_arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = local.normalized_maps_artifact_release_prefix
    filter_suffix       = ".zip"
  }

  lambda_function {
    lambda_function_arn = module.map_renderer_code_updater.function_arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = local.normalized_map_renderer_release_prefix
    filter_suffix       = ".zip"
  }

  depends_on = [
    module.maps_code_updater,
    module.map_renderer_code_updater,
  ]
}

resource "aws_iam_role" "maps_github_deploy" {
  name                 = "${var.project}-${var.environment}-maps-deploy"
  assume_role_policy   = data.aws_iam_policy_document.maps_github_assume_role.json
  max_session_duration = 3600

  depends_on = [terraform_data.native_maps_processor_required_inputs]
}

resource "aws_iam_role_policy" "maps_github_deploy" {
  name   = "maps-release-artifacts"
  role   = aws_iam_role.maps_github_deploy.id
  policy = data.aws_iam_policy_document.maps_github_deploy.json
}

resource "aws_iam_role" "map_renderer_github_deploy" {
  name                 = "${var.project}-${var.environment}-map-renderer-deploy"
  assume_role_policy   = data.aws_iam_policy_document.map_renderer_github_assume_role.json
  max_session_duration = 3600

  depends_on = [terraform_data.native_maps_processor_required_inputs]
}

resource "aws_iam_role_policy" "map_renderer_github_deploy" {
  name   = "map-renderer-artifacts"
  role   = aws_iam_role.map_renderer_github_deploy.id
  policy = data.aws_iam_policy_document.map_renderer_github_deploy.json
}

module "sqs_lambda_consumers" {
  for_each = local.lambda_configurations
  source   = "../../../modules/lambda-container"

  function_name  = "${each.key}-${var.environment}"
  image_uri      = "${data.terraform_remote_state.ecr.outputs.repository_urls[each.key]}:latest"
  sqs_queue_arn  = each.value.sqs_queue_arn
  s3_bucket_arn  = each.value.s3_bucket_arn
  s3_bucket_path = each.value.s3_bucket_path
  timeout        = each.value.timeout
  memory_size    = each.value.memory_size
  batch_size     = each.value.batch_size

  ephemeral_storage_size     = each.value.ephemeral_storage_size
  report_batch_item_failures = each.value.report_batch_item_failures
  event_source_enabled       = each.value.event_source_enabled

  environment_variables = merge(
    {
      UPLOADS_BUCKET_NAME = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      ENVIRONMENT         = var.environment
    },
    local.app_api_base_url == null || lookup(local.trusted_service_hmac_secret_ids_by_client, each.value.trusted_service_hmac_client_name, null) == null ? {} : {
      APP_API_BASE_URL                               = local.app_api_base_url
      APP_API_TRUSTED_CLIENT_NAME                    = each.value.trusted_service_hmac_client_name
      APP_API_TRUSTED_CLIENT_HMAC_SECRET_ID          = local.trusted_service_hmac_secret_ids_by_client[each.value.trusted_service_hmac_client_name]
      APP_API_UPLOAD_PROCESSING_STATUS_PATH_TEMPLATE = var.callbacks.paths.processing_status_template
    },
    each.value.environment_variables,
  )

  additional_iam_policies = !contains(keys(local.trusted_service_hmac_secret_arns_by_client), each.value.trusted_service_hmac_client_name) ? {} : {
    TrustedServiceHmacSecretRead = data.aws_iam_policy_document.trusted_service_hmac_secret[each.value.trusted_service_hmac_client_name].json
  }
}
