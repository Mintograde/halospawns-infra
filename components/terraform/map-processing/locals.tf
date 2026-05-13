locals {
  lambda_containers = [
    "halospawns-tools"
  ]

  lambda_configurations = {
    "halospawns-tools" = {
      description    = "Processes halo map files from SQS"
      sqs_queue_arn  = data.terraform_remote_state.uploads_ingest.outputs.file_processing_queue_arns["maps"]
      s3_bucket_arn  = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn
      s3_bucket_path = "/maps"
    }
  }

  app_api_remote_domain_name = try(data.terraform_remote_state.app_api[0].outputs.api_domain_name, null)
  app_api_remote_endpoint    = try(data.terraform_remote_state.app_api[0].outputs.api_endpoint, null)
  app_api_remote_base_url    = local.app_api_remote_domain_name != null && local.app_api_remote_domain_name != "" ? "https://${local.app_api_remote_domain_name}" : local.app_api_remote_endpoint
  app_api_base_url           = var.app_api_base_url != null && trimspace(var.app_api_base_url) != "" ? trimsuffix(trimspace(var.app_api_base_url), "/") : (local.app_api_remote_base_url == null ? null : trimsuffix(trimspace(local.app_api_remote_base_url), "/"))

  trusted_service_hmac_secret_id  = try(data.terraform_remote_state.app_api[0].outputs.trusted_service_hmac_secret_names[var.trusted_service_hmac_client_name], null)
  trusted_service_hmac_secret_arn = try(data.terraform_remote_state.app_api[0].outputs.trusted_service_hmac_secret_arns[var.trusted_service_hmac_client_name], null)

  app_api_callback_environment = local.app_api_base_url == null || local.trusted_service_hmac_secret_id == null ? {} : {
    APP_API_BASE_URL                               = local.app_api_base_url
    APP_API_TRUSTED_CLIENT_NAME                    = var.trusted_service_hmac_client_name
    APP_API_TRUSTED_CLIENT_HMAC_SECRET_ID          = local.trusted_service_hmac_secret_id
    APP_API_UPLOAD_PROCESSING_STATUS_PATH_TEMPLATE = var.app_api_processing_status_path_template
  }
}
