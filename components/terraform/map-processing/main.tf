module "sqs_lambda_consumers" {
  for_each = local.lambda_configurations
  source   = "../../../modules/lambda-container"

  function_name  = "${each.key}-${var.environment}"
  image_uri      = "${data.terraform_remote_state.ecr.outputs.repository_urls[each.key]}:latest"
  sqs_queue_arn  = each.value.sqs_queue_arn
  s3_bucket_arn  = each.value.s3_bucket_arn
  s3_bucket_path = each.value.s3_bucket_path

  environment_variables = {
    UPLOADS_BUCKET_NAME = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
    ENVIRONMENT         = var.environment
  }
}
