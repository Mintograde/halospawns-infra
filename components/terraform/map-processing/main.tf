module "sqs_lambda_consumers" {
  for_each = local.lambda_configurations
  source   = "../../../modules/lambda-container"

  function_name  = "${each.key}-${var.environment}"
  image_uri      = "${data.terraform_remote_state.ecr.outputs.repository_urls[each.key]}:latest"
  sqs_queue_arn  = each.value.sqs_queue_arn
  s3_bucket_arn  = each.value.s3_bucket_arn
  s3_bucket_path = each.value.s3_bucket_path

  environment_variables = merge(
    {
      UPLOADS_BUCKET_NAME = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      ENVIRONMENT         = var.environment
    },
    local.app_api_callback_environment,
  )

  additional_iam_policies = local.trusted_service_hmac_secret_arn == null ? {} : {
    TrustedServiceHmacSecretRead = data.aws_iam_policy_document.trusted_service_hmac_secret[0].json
  }
}
