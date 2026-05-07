output "function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.container_lambda.arn
}

output "function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.container_lambda.function_name
}

output "role_arn" {
  description = "ARN of the execution role"
  value       = aws_iam_role.lambda_exec_role.arn
}
