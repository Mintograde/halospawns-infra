output "function_arns" {
  description = "Map-processing Lambda function ARNs by workload name."
  value = {
    for name, consumer in module.sqs_lambda_consumers :
    name => consumer.function_arn
  }
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
