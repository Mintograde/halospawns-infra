locals {
  native_maps_processor_function_name       = var.native_maps_processor_function_name == null || trimspace(var.native_maps_processor_function_name) == "" ? "${var.project}-maps-processor-${var.environment}" : trimspace(var.native_maps_processor_function_name)
  normalized_maps_artifact_release_prefix   = trimsuffix(var.maps_artifact_release_prefix, "/") == "" ? "" : "${trimsuffix(var.maps_artifact_release_prefix, "/")}/"
  map_renderer_function_name                = var.map_renderer_function_name == null || trimspace(var.map_renderer_function_name) == "" ? "${var.project}-map-renderer-${var.environment}" : trimspace(var.map_renderer_function_name)
  normalized_map_renderer_release_prefix    = trimsuffix(var.map_renderer_artifact_release_prefix, "/") == "" ? "" : "${trimsuffix(var.map_renderer_artifact_release_prefix, "/")}/"
  map_unprocessed_prefix                    = trim(var.map_unprocessed_prefix, "/")
  map_processed_prefix                      = trim(var.map_processed_prefix, "/")
  map_failed_prefix                         = trim(var.map_failed_prefix, "/")
  map_support_resource_prefix               = trim(var.map_support_resource_prefix, "/")
  maps_github_environment_subject           = var.maps_github_environment == null || trimspace(var.maps_github_environment) == "" ? null : "repo:${var.maps_github_repository}:environment:${var.maps_github_environment}"
  maps_github_branch_subject                = "repo:${var.maps_github_repository}:ref:refs/heads/${var.maps_github_branch}"
  maps_github_subject                       = var.maps_github_subject == null || trimspace(var.maps_github_subject) == "" ? (local.maps_github_environment_subject != null ? local.maps_github_environment_subject : local.maps_github_branch_subject) : var.maps_github_subject
  maps_github_oidc_provider_arn             = var.maps_github_create_oidc_provider ? try(aws_iam_openid_connect_provider.maps_github[0].arn, null) : (var.maps_github_oidc_provider_arn != null && trimspace(var.maps_github_oidc_provider_arn) != "" ? var.maps_github_oidc_provider_arn : try(data.aws_iam_openid_connect_provider.github[0].arn, null))
  native_maps_processor_trusted_hmac_client = var.trusted_service_hmac_client_name
  map_renderer_trusted_hmac_client          = var.map_renderer_trusted_service_hmac_client_name
  map_renderer_github_environment_subject   = var.map_renderer_github_environment == null || trimspace(var.map_renderer_github_environment) == "" ? null : "repo:${var.map_renderer_github_repository}:environment:${var.map_renderer_github_environment}"
  map_renderer_github_branch_subject        = "repo:${var.map_renderer_github_repository}:ref:refs/heads/${var.map_renderer_github_branch}"
  map_renderer_github_subject               = var.map_renderer_github_subject == null || trimspace(var.map_renderer_github_subject) == "" ? (local.map_renderer_github_environment_subject != null ? local.map_renderer_github_environment_subject : local.map_renderer_github_branch_subject) : var.map_renderer_github_subject

  lambda_configurations = {
    "halospawns-tools" = {
      description                      = "Processes halo map files from SQS"
      sqs_queue_arn                    = data.terraform_remote_state.uploads_ingest.outputs.file_processing_queue_arns["maps"]
      s3_bucket_arn                    = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn
      s3_bucket_path                   = "/maps"
      batch_size                       = 1
      timeout                          = 300
      memory_size                      = 512
      ephemeral_storage_size           = null
      report_batch_item_failures       = true
      event_source_enabled             = var.legacy_maps_processor_event_source_enabled
      trusted_service_hmac_client_name = var.trusted_service_hmac_client_name
      environment_variables = {
        APP_API_MAP_FINALIZATION_PATH = var.app_api_map_finalization_path
        MAP_UNPROCESSED_PREFIX        = "maps/unprocessed/"
        MAP_PROCESSED_PREFIX          = "maps/processed/"
        MAP_FAILED_PREFIX             = "maps/failed/"
        REPORT_BATCH_ITEM_FAILURES    = "true"
      }
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
      event_source_enabled             = true
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

  map_renderer_trusted_service_hmac_secret_id  = try(local.trusted_service_hmac_secret_ids_by_client[local.map_renderer_trusted_hmac_client], null)
  map_renderer_trusted_service_hmac_secret_arn = try(local.trusted_service_hmac_secret_arns_by_client[local.map_renderer_trusted_hmac_client], null)
}
