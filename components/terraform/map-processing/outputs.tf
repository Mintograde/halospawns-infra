output "function_arns" {
  description = "Map-processing Lambda function ARNs by workload name."
  value = merge(
    {
      for name, consumer in module.sqs_lambda_consumers :
      name => consumer.function_arn
    },
    {
      "halospawns-maps-processor" = module.native_maps_processor.function_arn
      "halospawns-map-renderer"   = module.map_renderer.function_arn
    },
    var.heatmap_rollup_worker.enabled ? {
      "halospawns-heatmap-rollup-worker" = module.heatmap_rollup_worker[0].function_arn
    } : {},
  )
}

output "heatmap_rollup_worker_function_name" {
  description = "Scheduled heatmap rollup worker Lambda function name."
  value       = var.heatmap_rollup_worker.enabled ? module.heatmap_rollup_worker[0].function_name : null
}

output "heatmap_rollup_worker_alias_arn" {
  description = "Scheduled heatmap rollup worker live alias ARN."
  value       = var.heatmap_rollup_worker.enabled ? module.heatmap_rollup_worker[0].alias_arn : null
}

output "heatmap_rollup_schedule_dlq_arn" {
  description = "DLQ ARN for failed scheduled heatmap rollup invocations."
  value       = var.heatmap_rollup_worker.enabled ? aws_sqs_queue.heatmap_rollup_schedule_dlq[0].arn : null
}

output "native_maps_processor_function_name" {
  description = "Native maps processor Lambda function name."
  value       = module.native_maps_processor.function_name
}

output "native_maps_processor_function_arn" {
  description = "Native maps processor Lambda function ARN."
  value       = module.native_maps_processor.function_arn
}

output "native_maps_processor_alias_name" {
  description = "Native maps processor live alias name."
  value       = module.native_maps_processor.alias_name
}

output "native_maps_processor_alias_arn" {
  description = "Native maps processor live alias ARN."
  value       = module.native_maps_processor.alias_arn
}

output "native_maps_processor_event_source_enabled" {
  description = "Whether the native maps processor SQS event source mapping is enabled."
  value       = var.native_maps.event_source.enabled
}

output "maps_processor_artifact_bucket_name" {
  description = "S3 bucket used for native maps processor release artifacts."
  value       = aws_s3_bucket.maps_artifacts.id
}

output "maps_processor_artifact_release_prefix" {
  description = "S3 prefix used for native maps processor release artifacts."
  value       = local.normalized_maps_artifact_release_prefix
}

output "maps_processor_github_deploy_role_arn" {
  description = "ARN of the GitHub Actions role allowed to upload native maps processor release artifacts."
  value       = aws_iam_role.maps_github_deploy.arn
}

output "maps_processor_github_oidc_subject" {
  description = "GitHub OIDC subject allowed to assume the native maps processor deploy role."
  value       = local.maps_github_subject
}

output "maps_code_updater_lambda_function_name" {
  description = "Maps code updater Lambda function name."
  value       = module.maps_code_updater.function_name
}

output "map_renderer_function_name" {
  description = "Map renderer Lambda function name."
  value       = module.map_renderer.function_name
}

output "map_renderer_function_arn" {
  description = "Map renderer Lambda function ARN."
  value       = module.map_renderer.function_arn
}

output "map_renderer_alias_name" {
  description = "Map renderer live alias name."
  value       = module.map_renderer.alias_name
}

output "map_renderer_alias_arn" {
  description = "Map renderer live alias ARN."
  value       = module.map_renderer.alias_arn
}

output "map_renderer_event_source_enabled" {
  description = "Whether the map renderer SQS event source mapping is enabled."
  value       = var.renderer.event_source.enabled
}

output "map_rendering_queue_arn" {
  description = "ARN of the map rendering SQS queue."
  value       = aws_sqs_queue.map_rendering.arn
}

output "map_rendering_queue_name" {
  description = "Name of the map rendering SQS queue."
  value       = aws_sqs_queue.map_rendering.name
}

output "map_rendering_queue_url" {
  description = "URL of the map rendering SQS queue."
  value       = aws_sqs_queue.map_rendering.url
}

output "map_rendering_dlq_arn" {
  description = "ARN of the map rendering DLQ."
  value       = aws_sqs_queue.map_rendering_dlq.arn
}

output "map_rendering_dlq_name" {
  description = "Name of the map rendering dead-letter queue."
  value       = aws_sqs_queue.map_rendering_dlq.name
}

output "map_rendering_alarm_names" {
  description = "CloudWatch queue-age and dead-letter queue alarm names for map rendering."
  value       = var.renderer.alarms.enabled ? local.map_rendering_alarm_names : {}
}

output "map_renderer_artifact_bucket_name" {
  description = "S3 bucket used for map renderer release artifacts."
  value       = aws_s3_bucket.maps_artifacts.id
}

output "map_renderer_artifact_release_prefix" {
  description = "S3 prefix used for map renderer Lambda ZIP release artifacts."
  value       = local.normalized_map_renderer_release_prefix
}

output "map_renderer_github_deploy_role_arn" {
  description = "ARN of the GitHub Actions role allowed to upload map renderer release artifacts."
  value       = aws_iam_role.map_renderer_github_deploy.arn
}

output "map_renderer_github_oidc_subject" {
  description = "GitHub OIDC subject allowed to assume the map renderer deploy role."
  value       = local.map_renderer_github_subject
}

output "map_renderer_code_updater_lambda_function_name" {
  description = "Map renderer code updater Lambda function name."
  value       = module.map_renderer_code_updater.function_name
}

output "app_api_callback_base_url" {
  description = "App API base URL configured for processor callbacks."
  value       = local.app_api_base_url
}

output "app_api_trusted_service_hmac_client_name" {
  description = "Trusted HMAC client name configured for processor callbacks."
  value       = local.native_maps_processor_trusted_hmac_client
}

output "app_api_trusted_service_hmac_secret_id" {
  description = "Secrets Manager secret identifier configured for processor callback signing."
  value       = local.trusted_service_hmac_secret_id
}

output "app_api_trusted_service_hmac_secret_ids" {
  description = "Secrets Manager secret identifiers available to processor callback signers, keyed by trusted client name."
  value       = local.trusted_service_hmac_secret_ids_by_client
}
