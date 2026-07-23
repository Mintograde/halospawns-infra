locals {
  native_maps_processor_function_name = var.native_maps.function_name == null || trimspace(var.native_maps.function_name) == "" ? "${var.project}-maps-processor-${var.environment}" : trimspace(var.native_maps.function_name)
  map_renderer_function_name          = var.renderer.function_name == null || trimspace(var.renderer.function_name) == "" ? "${var.project}-map-renderer-${var.environment}" : trimspace(var.renderer.function_name)

  normalized_maps_artifact_release_prefix = trimsuffix(var.release.maps.artifact_prefix, "/") == "" ? "" : "${trimsuffix(var.release.maps.artifact_prefix, "/")}/"
  normalized_map_renderer_release_prefix  = trimsuffix(var.release.renderer.artifact_prefix, "/") == "" ? "" : "${trimsuffix(var.release.renderer.artifact_prefix, "/")}/"

  upload_pipelines = data.terraform_remote_state.uploads_ingest.outputs.pipelines

  map_unprocessed_prefix             = trim(local.upload_pipelines.maps.unprocessed_prefix, "/")
  map_processed_prefix               = trim(local.upload_pipelines.maps.processed_prefix, "/")
  map_failed_prefix                  = trim(local.upload_pipelines.maps.failed_prefix, "/")
  map_support_resource_prefix        = trim(var.storage.maps.support_resources, "/")
  replay_spatial_artifact_prefix     = trim(var.storage.replays.spatial_artifacts, "/")
  heatmap_rollup_artifact_prefix     = trim(var.storage.replays.heatmap_rollups, "/")
  region_stat_rollup_artifact_prefix = trim(var.storage.replays.region_stat_rollups, "/")

  maps_github_environment_subject = var.release.maps.github.environment == null || trimspace(var.release.maps.github.environment) == "" ? null : "repo:${var.release.maps.github.repository}:environment:${var.release.maps.github.environment}"
  maps_github_branch_subject      = "repo:${var.release.maps.github.repository}:ref:refs/heads/${var.release.maps.github.branch}"
  maps_github_subject             = var.release.maps.github.subject == null || trimspace(var.release.maps.github.subject) == "" ? (local.maps_github_environment_subject != null ? local.maps_github_environment_subject : local.maps_github_branch_subject) : var.release.maps.github.subject
  maps_github_oidc_provider_arn   = var.release.oidc.create_provider ? try(aws_iam_openid_connect_provider.maps_github[0].arn, null) : (var.release.oidc.provider_arn != null && trimspace(var.release.oidc.provider_arn) != "" ? var.release.oidc.provider_arn : try(data.aws_iam_openid_connect_provider.github[0].arn, null))

  map_renderer_github_environment_subject = var.release.renderer.github.environment == null || trimspace(var.release.renderer.github.environment) == "" ? null : "repo:${var.release.renderer.github.repository}:environment:${var.release.renderer.github.environment}"
  map_renderer_github_branch_subject      = "repo:${var.release.renderer.github.repository}:ref:refs/heads/${var.release.renderer.github.branch}"
  map_renderer_github_subject             = var.release.renderer.github.subject == null || trimspace(var.release.renderer.github.subject) == "" ? (local.map_renderer_github_environment_subject != null ? local.map_renderer_github_environment_subject : local.map_renderer_github_branch_subject) : var.release.renderer.github.subject

  native_maps_processor_trusted_hmac_client = var.callbacks.clients.maps
  replay_parser_trusted_hmac_client         = var.callbacks.clients.replays
  map_renderer_trusted_hmac_client          = var.callbacks.clients.renderer
  heatmap_rollup_worker_trusted_hmac_client = var.callbacks.clients.heatmaps

  app_api_contract = data.terraform_remote_state.app_api.outputs.api_contract
  app_api_base_url = local.app_api_contract.base_url == null ? null : trimsuffix(
    trimspace(local.app_api_contract.base_url),
    "/",
  )

  trusted_service_hmac_secret_ids_by_client  = data.terraform_remote_state.app_api.outputs.trusted_service_hmac_secret_names
  trusted_service_hmac_secret_arns_by_client = data.terraform_remote_state.app_api.outputs.trusted_service_hmac_secret_arns

  trusted_service_hmac_secret_id = try(local.trusted_service_hmac_secret_ids_by_client[local.native_maps_processor_trusted_hmac_client], null)

  map_renderer_trusted_service_hmac_secret_id  = try(local.trusted_service_hmac_secret_ids_by_client[local.map_renderer_trusted_hmac_client], null)
  map_renderer_trusted_service_hmac_secret_arn = try(local.trusted_service_hmac_secret_arns_by_client[local.map_renderer_trusted_hmac_client], null)

  heatmap_rollup_worker_function_name                   = var.heatmap_rollup_worker.function_name == null || trimspace(var.heatmap_rollup_worker.function_name) == "" ? "${var.project}-heatmap-rollup-worker-${var.environment}" : trimspace(var.heatmap_rollup_worker.function_name)
  heatmap_rollup_worker_trusted_service_hmac_secret_id  = try(local.trusted_service_hmac_secret_ids_by_client[local.heatmap_rollup_worker_trusted_hmac_client], null)
  heatmap_rollup_worker_trusted_service_hmac_secret_arn = try(local.trusted_service_hmac_secret_arns_by_client[local.heatmap_rollup_worker_trusted_hmac_client], null)

  lambda_configurations = var.replay_parser.enabled ? {
    (var.replay_parser.repository_name) = {
      description                      = "Parses replay files from SQS"
      sqs_queue_arn                    = local.upload_pipelines.replays.queue_arn
      s3_bucket_arn                    = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn
      s3_bucket_path                   = "/replays"
      batch_size                       = var.replay_parser.batch_size
      timeout                          = var.replay_parser.timeout_seconds
      memory_size                      = var.replay_parser.memory_mb
      ephemeral_storage_size           = var.replay_parser.ephemeral_storage_mb
      report_batch_item_failures       = var.replay_parser.report_batch_item_failures
      event_source_enabled             = var.replay_parser.event_source_enabled
      trusted_service_hmac_client_name = local.replay_parser_trusted_hmac_client
      environment_variables = merge({
        APP_API_REPLAY_FINALIZATION_PATH = local.app_api_contract.replay_finalization
        REPLAY_UNPROCESSED_PREFIX        = local.upload_pipelines.replays.unprocessed_prefix
        REPLAY_PROCESSED_PREFIX          = local.upload_pipelines.replays.processed_prefix
        REPLAY_FAILED_PREFIX             = local.upload_pipelines.replays.failed_prefix
        SPATIAL_ARTIFACT_PREFIX          = local.replay_spatial_artifact_prefix
      }, var.replay_parser.environment_variables)
    }
  } : {}
}
