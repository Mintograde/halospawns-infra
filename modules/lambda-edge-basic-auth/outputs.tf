output "lambda_function_name" {
  description = "Name of the Lambda@Edge function."
  value       = aws_lambda_function.edge.function_name
}

output "lambda_function_arn" {
  description = "Unqualified ARN of the Lambda@Edge function."
  value       = aws_lambda_function.edge.arn
}

output "lambda_function_qualified_arn" {
  description = "Published Lambda@Edge version ARN for CloudFront association."
  value       = aws_lambda_function.edge.qualified_arn
}

output "ssm_parameter_name" {
  description = "Name of the Basic Auth credential SSM parameter."
  value       = var.ssm_parameter_name
}

output "ssm_parameter_arn" {
  description = "ARN of the Basic Auth credential SSM parameter."
  value       = local.ssm_parameter_arn
}

output "credential_cache_ttl_seconds" {
  description = "Credential cache TTL configured in the Lambda@Edge function."
  value       = var.credential_cache_ttl_seconds
}
