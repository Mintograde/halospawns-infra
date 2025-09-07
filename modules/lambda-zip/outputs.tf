output "function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.this.arn
}

output "function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.this.function_name
}

output "role_arn" {
  description = "ARN of the execution role"
  value       = aws_iam_role.lambda_exec_role.arn
}

output "output_zip_path" {
  description = "Path to the generated zip artifact"
  value       = data.archive_file.lambda.output_path
}