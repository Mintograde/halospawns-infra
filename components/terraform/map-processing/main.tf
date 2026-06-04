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

module "native_maps_processor" {
  source = "../../../modules/lambda-s3-managed"

  function_name                  = local.native_maps_processor_function_name
  runtime                        = var.native_maps_processor_runtime
  handler                        = var.native_maps_processor_handler
  source_dir                     = "../../../lambda/maps_processor_placeholder"
  alias_name                     = var.native_maps_processor_alias_name
  timeout                        = var.native_maps_processor_timeout
  memory_size                    = var.native_maps_processor_memory_size
  ephemeral_storage_size         = var.native_maps_processor_ephemeral_storage_size
  reserved_concurrent_executions = var.native_maps_processor_reserved_concurrent_executions

  environment_variables = merge(
    {
      ENVIRONMENT                                    = var.environment
      UPLOADS_BUCKET_NAME                            = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      MAP_UNPROCESSED_PREFIX                         = "${local.map_unprocessed_prefix}/"
      MAP_PROCESSED_PREFIX                           = "${local.map_processed_prefix}/"
      MAP_FAILED_PREFIX                              = "${local.map_failed_prefix}/"
      MAP_SUPPORT_RESOURCE_PREFIX                    = "${local.map_support_resource_prefix}/"
      APP_API_MAP_FINALIZATION_PATH                  = var.app_api_map_finalization_path
      APP_API_MAP_SUPPORT_RESOURCE_INGEST_PATH       = var.app_api_map_support_resource_ingest_path
      APP_API_MAP_SUPPORT_RESOURCE_RESOLVE_PATH      = var.app_api_map_support_resource_resolve_path
      APP_API_UPLOAD_PROCESSING_STATUS_PATH_TEMPLATE = var.app_api_processing_status_path_template
      REPORT_BATCH_ITEM_FAILURES                     = tostring(var.native_maps_processor_report_batch_item_failures)
    },
    local.app_api_base_url == null || lookup(local.trusted_service_hmac_secret_ids_by_client, local.native_maps_processor_trusted_hmac_client, null) == null ? {} : {
      APP_API_BASE_URL                      = local.app_api_base_url
      APP_API_TRUSTED_CLIENT_NAME           = local.native_maps_processor_trusted_hmac_client
      APP_API_TRUSTED_CLIENT_HMAC_SECRET_ID = local.trusted_service_hmac_secret_ids_by_client[local.native_maps_processor_trusted_hmac_client]
    },
    var.native_maps_processor_environment_variables,
  )

  policies_json = concat(
    [data.aws_iam_policy_document.native_maps_processor_s3.json],
    contains(keys(local.trusted_service_hmac_secret_arns_by_client), local.native_maps_processor_trusted_hmac_client) ? [
      data.aws_iam_policy_document.trusted_service_hmac_secret[local.native_maps_processor_trusted_hmac_client].json
    ] : [],
  )

  role_policy_arns = [
    "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole",
  ]

  depends_on = [terraform_data.native_maps_processor_required_inputs]
}

resource "aws_lambda_event_source_mapping" "native_maps_processor_sqs_trigger" {
  event_source_arn        = data.terraform_remote_state.uploads_ingest.outputs.file_processing_queue_arns["maps"]
  function_name           = module.native_maps_processor.alias_arn
  batch_size              = var.native_maps_processor_batch_size
  enabled                 = var.native_maps_processor_event_source_enabled
  function_response_types = var.native_maps_processor_report_batch_item_failures ? ["ReportBatchItemFailures"] : []
}

resource "aws_cloudwatch_log_group" "maps_code_updater" {
  name              = "/aws/lambda/${var.project}-${var.environment}-maps-code-updater"
  retention_in_days = 30
}

resource "aws_iam_role" "maps_code_updater" {
  name               = "${var.project}-${var.environment}-maps-code-updater-exec-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "maps_code_updater_basic_execution" {
  role       = aws_iam_role.maps_code_updater.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "maps_code_updater" {
  name   = "maps-code-updater"
  role   = aws_iam_role.maps_code_updater.id
  policy = data.aws_iam_policy_document.maps_code_updater.json
}

resource "aws_lambda_function" "maps_code_updater" {
  function_name                  = "${var.project}-${var.environment}-maps-code-updater"
  role                           = aws_iam_role.maps_code_updater.arn
  runtime                        = "python3.12"
  handler                        = "handler.handler"
  filename                       = data.archive_file.maps_code_updater.output_path
  source_code_hash               = data.archive_file.maps_code_updater.output_base64sha256
  timeout                        = 300
  memory_size                    = 128
  reserved_concurrent_executions = var.maps_code_updater_reserved_concurrent_executions

  environment {
    variables = {
      TARGET_FUNCTION_NAME    = module.native_maps_processor.function_name
      TARGET_ALIAS_NAME       = module.native_maps_processor.alias_name
      ARTIFACT_RELEASE_PREFIX = local.normalized_maps_artifact_release_prefix
      ARTIFACT_SUFFIX         = ".zip"
      WAIT_TIMEOUT_SECONDS    = "300"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.maps_code_updater,
    aws_iam_role_policy_attachment.maps_code_updater_basic_execution,
    aws_iam_role_policy.maps_code_updater,
  ]
}

resource "aws_lambda_permission" "allow_maps_artifact_bucket" {
  statement_id   = "AllowMapsArtifactBucket"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.maps_code_updater.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.maps_artifacts.arn
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_s3_bucket_notification" "maps_release_artifacts" {
  bucket = aws_s3_bucket.maps_artifacts.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.maps_code_updater.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = local.normalized_maps_artifact_release_prefix
    filter_suffix       = ".zip"
  }

  depends_on = [aws_lambda_permission.allow_maps_artifact_bucket]
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

  environment_variables = merge(
    {
      UPLOADS_BUCKET_NAME = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      ENVIRONMENT         = var.environment
    },
    local.app_api_base_url == null || lookup(local.trusted_service_hmac_secret_ids_by_client, each.value.trusted_service_hmac_client_name, null) == null ? {} : {
      APP_API_BASE_URL                               = local.app_api_base_url
      APP_API_TRUSTED_CLIENT_NAME                    = each.value.trusted_service_hmac_client_name
      APP_API_TRUSTED_CLIENT_HMAC_SECRET_ID          = local.trusted_service_hmac_secret_ids_by_client[each.value.trusted_service_hmac_client_name]
      APP_API_UPLOAD_PROCESSING_STATUS_PATH_TEMPLATE = var.app_api_processing_status_path_template
    },
    each.value.environment_variables,
  )

  additional_iam_policies = !contains(keys(local.trusted_service_hmac_secret_arns_by_client), each.value.trusted_service_hmac_client_name) ? {} : {
    TrustedServiceHmacSecretRead = data.aws_iam_policy_document.trusted_service_hmac_secret[each.value.trusted_service_hmac_client_name].json
  }
}
