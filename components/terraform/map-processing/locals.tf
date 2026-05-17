locals {
  lambda_configurations = {
    "halospawns-tools" = {
      description                      = "Processes halo map files from SQS"
      sqs_queue_arn                    = data.terraform_remote_state.uploads_ingest.outputs.file_processing_queue_arns["maps"]
      s3_bucket_arn                    = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn
      s3_bucket_path                   = "/maps"
      batch_size                       = 10
      timeout                          = 300
      memory_size                      = 512
      ephemeral_storage_size           = null
      report_batch_item_failures       = false
      trusted_service_hmac_client_name = var.trusted_service_hmac_client_name
      environment_variables            = {}
    }
    "halospawns-replay-parser" = {
      description                      = "Parses replay files from SQS"
      sqs_queue_arn                    = data.terraform_remote_state.uploads_ingest.outputs.file_processing_queue_arns["replays"]
      s3_bucket_arn                    = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn
      s3_bucket_path                   = "/replays"
      batch_size                       = 1
      timeout                          = 300
      memory_size                      = 2048
      ephemeral_storage_size           = 10240
      report_batch_item_failures       = true
      trusted_service_hmac_client_name = "replay-processing"
      environment_variables = {
        APP_API_REPLAY_FINALIZATION_PATH = var.app_api_replay_finalization_path
        REPLAY_UNPROCESSED_PREFIX        = "replays/unprocessed/"
        REPLAY_PROCESSED_PREFIX          = "replays/processed/"
        REPLAY_FAILED_PREFIX             = "replays/failed/"
      }
    }
  }

  app_api_remote_domain_name = try(data.terraform_remote_state.app_api[0].outputs.api_domain_name, null)
  app_api_remote_endpoint    = try(data.terraform_remote_state.app_api[0].outputs.api_endpoint, null)
  app_api_remote_base_url    = local.app_api_remote_domain_name != null && local.app_api_remote_domain_name != "" ? "https://${local.app_api_remote_domain_name}" : local.app_api_remote_endpoint
  app_api_base_url           = var.app_api_base_url != null && trimspace(var.app_api_base_url) != "" ? trimsuffix(trimspace(var.app_api_base_url), "/") : (local.app_api_remote_base_url == null ? null : trimsuffix(trimspace(local.app_api_remote_base_url), "/"))

  trusted_service_hmac_secret_ids_by_client = try(data.terraform_remote_state.app_api[0].outputs.trusted_service_hmac_secret_names, {})
  trusted_service_hmac_secret_arns_by_client = try(
    data.terraform_remote_state.app_api[0].outputs.trusted_service_hmac_secret_arns,
    {},
  )

  trusted_service_hmac_secret_id = try(local.trusted_service_hmac_secret_ids_by_client[var.trusted_service_hmac_client_name], null)
}
