output "api_id" {
  description = "HTTP API ID."
  value       = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  description = "Default HTTP API endpoint."
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "api_execution_arn" {
  description = "HTTP API execution ARN."
  value       = aws_apigatewayv2_api.this.execution_arn
}

output "stage_name" {
  description = "HTTP API stage name."
  value       = aws_apigatewayv2_stage.this.name
}

output "jwt_authorizer_id" {
  description = "JWT authorizer ID, when configured."
  value       = var.jwt_authorizer == null ? null : aws_apigatewayv2_authorizer.jwt[0].id
}

output "domain_name" {
  description = "Custom domain name, when configured."
  value       = local.create_domain ? aws_apigatewayv2_domain_name.this[0].domain_name : null
}

output "domain_target_name" {
  description = "Regional API Gateway custom-domain target name."
  value       = local.create_domain ? aws_apigatewayv2_domain_name.this[0].domain_name_configuration[0].target_domain_name : null
}

output "certificate_arn" {
  description = "Certificate ARN used by the custom domain."
  value       = local.create_domain ? local.certificate_arn : null
}
