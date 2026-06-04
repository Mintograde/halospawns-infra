output "function_arns" {
  description = "Map-processing Lambda function ARNs by workload name."
  value = merge(
    {
      for name, consumer in module.sqs_lambda_consumers :
      name => consumer.function_arn
    },
    {
      "halospawns-maps-processor" = module.native_maps_processor.function_arn
    },
  )
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
  value       = var.native_maps_processor_event_source_enabled
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
  value       = aws_lambda_function.maps_code_updater.function_name
}

output "app_api_callback_base_url" {
  description = "App API base URL configured for processor callbacks."
  value       = local.app_api_base_url
}

output "app_api_trusted_service_hmac_client_name" {
  description = "Trusted HMAC client name configured for processor callbacks."
  value       = var.trusted_service_hmac_client_name
}

output "app_api_trusted_service_hmac_secret_id" {
  description = "Secrets Manager secret identifier configured for processor callback signing."
  value       = local.trusted_service_hmac_secret_id
}

output "app_api_trusted_service_hmac_secret_ids" {
  description = "Secrets Manager secret identifiers available to processor callback signers, keyed by trusted client name."
  value       = local.trusted_service_hmac_secret_ids_by_client
}
