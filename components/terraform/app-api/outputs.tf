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

output "supabase_database_url_secret_arn" {
  description = "ARN of the Supabase database URL secret metadata."
  value       = var.enabled ? aws_secretsmanager_secret.supabase_database_url[0].arn : null
}

output "supabase_service_role_secret_arn" {
  description = "ARN of the optional Supabase service role key secret metadata."
  value       = var.enabled && var.create_supabase_service_role_secret ? aws_secretsmanager_secret.supabase_service_role[0].arn : null
}

output "code_updater_lambda_function_name" {
  description = "Code updater Lambda function name."
  value       = var.enabled ? aws_lambda_function.code_updater[0].function_name : null
}
