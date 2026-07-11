output "function_name" {
  description = "Code updater Lambda function name."
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "Code updater Lambda function ARN."
  value       = aws_lambda_function.this.arn
}

output "permission_id" {
  description = "Artifact bucket Lambda permission ID."
  value       = aws_lambda_permission.artifact_bucket.id
}
