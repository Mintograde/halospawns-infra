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
