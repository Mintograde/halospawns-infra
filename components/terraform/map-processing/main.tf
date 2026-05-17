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
