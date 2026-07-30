output "enabled" {
  description = "Whether app API resources are enabled."
  value       = var.enabled
}

output "api_endpoint" {
  description = "Default HTTP API endpoint."
  value       = var.enabled ? module.api[0].api_endpoint : null
}

output "api_domain_name" {
  description = "Custom API domain name."
  value       = var.enabled ? module.api[0].domain_name : null
}

output "api_gateway_id" {
  description = "HTTP API Gateway ID."
  value       = var.enabled ? module.api[0].api_id : null
}

output "api_stage_name" {
  description = "HTTP API stage name."
  value       = var.enabled ? module.api[0].stage_name : null
}

output "api_access_log_group_name" {
  description = "CloudWatch Logs group receiving app API Gateway access logs."
  value       = var.enabled ? module.api[0].access_log_group_name : null
}

output "app_lambda_function_name" {
  description = "App Lambda function name."
  value       = var.enabled ? module.app_lambda[0].function_name : null
}

output "app_lambda_alias_name" {
  description = "App Lambda live alias name."
  value       = var.enabled ? module.app_lambda[0].alias_name : null
}

output "app_lambda_alias_arn" {
  description = "App Lambda live alias ARN."
  value       = var.enabled ? module.app_lambda[0].alias_arn : null
}

output "app_api_dashboard_name" {
  description = "CloudWatch dashboard name for the app API observability bundle."
  value       = local.app_api_observability_enabled ? aws_cloudwatch_dashboard.app_api[0].dashboard_name : null
}

output "app_api_alert_topic_arn" {
  description = "SNS topic ARN receiving app API alarm and OK notifications."
  value       = local.app_api_observability_enabled ? aws_sns_topic.app_api_alerts[0].arn : null
}

output "app_api_alarm_names" {
  description = "CloudWatch alarm names for the app API observability bundle."
  value       = local.app_api_observability_enabled ? local.app_api_alarm_names : {}
}

output "app_api_query_definition_names" {
  description = "Saved CloudWatch Logs Insights query names for the app API."
  value       = sort([for query in aws_cloudwatch_query_definition.app_api : query.name])
}

output "artifact_bucket_name" {
  description = "S3 bucket used for API release artifacts."
  value       = var.enabled ? aws_s3_bucket.artifacts[0].id : null
}

output "artifact_release_prefix" {
  description = "S3 prefix used for API release artifacts."
  value       = local.normalized_artifact_release_prefix
}

output "github_deploy_role_arn" {
  description = "ARN of the GitHub Actions role allowed to upload API release artifacts."
  value       = var.enabled ? aws_iam_role.github_deploy[0].arn : null
}

output "github_oidc_subject" {
  description = "GitHub OIDC subject allowed to assume the app API deploy role."
  value       = var.enabled ? local.github_subject : null
}

output "supabase_database_url_parameter_name" {
  description = "Name of the externally managed SSM SecureString containing the Supabase database URL."
  value       = var.enabled ? local.supabase_database_url_parameter_name : null
}

output "supabase_database_url_parameter_arn" {
  description = "ARN of the externally managed SSM SecureString containing the Supabase database URL."
  value       = var.enabled ? "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.supabase_database_url_parameter_name}" : null
}

output "supabase_service_role_parameter_name" {
  description = "Name of the optional externally managed SSM SecureString containing the Supabase service role key."
  value       = var.enabled && var.supabase.parameters.create_service_role_parameter ? local.supabase_service_role_parameter_name : null
}

output "supabase_service_role_parameter_arn" {
  description = "ARN of the optional externally managed SSM SecureString containing the Supabase service role key."
  value       = var.enabled && var.supabase.parameters.create_service_role_parameter ? "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.supabase_service_role_parameter_name}" : null
}

output "api_contract" {
  description = "Stable public and trusted callback paths exposed by the app API."
  value = {
    base_url                        = local.app_api_base_url
    upload_processing_status        = "/v1/uploads/{upload_id}/processing-status"
    replay_finalization             = "/v1/ingest/replay-uploads"
    replay_reprocess_attempt_status = "/v1/ingest/replay-reprocess-attempts/{attempt_id}/status"
    map_finalization                = "/v1/ingest/map-uploads"
    map_support_resource_ingest     = "/v1/ingest/map-support-resources"
    map_support_resource_resolve    = "/v1/ingest/map-support-resources/resolve"
    map_screenshot_ingest           = var.rendering.screenshot_ingest_path
    heatmap_rollup_claim            = "/v1/ingest/heatmap-rollups/claim"
    heatmap_rollup_inputs           = "/v1/ingest/heatmap-rollups/{scope_id}/inputs"
    heatmap_rollup_complete         = "/v1/ingest/heatmap-rollups/{scope_id}/complete"
    heatmap_rollup_failed           = "/v1/ingest/heatmap-rollups/{scope_id}/failed"
  }
}

output "trusted_service_hmac_parameter_names" {
  description = "Externally managed SSM SecureString names used by trusted HMAC clients, keyed by trusted client name."
  value       = local.trusted_service_hmac_parameter_names
}

output "trusted_service_hmac_parameter_arns" {
  description = "Externally managed SSM SecureString ARNs used by trusted HMAC clients, keyed by trusted client name."
  value       = local.trusted_service_hmac_parameter_arns
}

output "code_updater_lambda_function_name" {
  description = "Code updater Lambda function name."
  value       = var.enabled ? module.code_updater[0].function_name : null
}
