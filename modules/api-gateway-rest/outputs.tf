output "rest_api_id" {
  description = "ID of the REST API"
  value       = aws_api_gateway_rest_api.this.id
}

output "stage_invoke_url" {
  description = "Invoke URL for the stage"
  value       = "https://${aws_api_gateway_rest_api.this.id}.execute-api.${data.aws_region.current.region}.amazonaws.com/${aws_api_gateway_stage.this.stage_name}"
}

output "api_key_id" {
  description = "API key ID (if created)"
  value       = try(aws_api_gateway_api_key.this[0].id, null)
}

output "api_key_value" {
  description = "API key value (if created)"
  value       = try(aws_api_gateway_api_key.this[0].value, null)
  sensitive   = true
}