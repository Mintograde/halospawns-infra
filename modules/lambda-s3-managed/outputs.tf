output "function_name" {
  description = "Name of the Lambda function."
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "ARN of the Lambda function."
  value       = aws_lambda_function.this.arn
}

output "function_invoke_arn" {
  description = "Invoke ARN of the Lambda function."
  value       = aws_lambda_function.this.invoke_arn
}

output "function_version" {
  description = "Initial published function version managed by Terraform."
  value       = aws_lambda_function.this.version
}

output "role_name" {
  description = "Name of the Lambda execution role."
  value       = aws_iam_role.lambda_exec.name
}

output "role_arn" {
  description = "ARN of the Lambda execution role."
  value       = aws_iam_role.lambda_exec.arn
}

output "alias_name" {
  description = "Name of the Lambda alias."
  value       = aws_lambda_alias.live.name
}

output "alias_arn" {
  description = "ARN of the Lambda alias."
  value       = aws_lambda_alias.live.arn
}

output "alias_invoke_arn" {
  description = "Invoke ARN of the Lambda alias."
  value       = aws_lambda_alias.live.invoke_arn
}
