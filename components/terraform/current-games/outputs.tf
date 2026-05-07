output "current_games_table_name" {
  description = "Name of the current-games DynamoDB table."
  value       = module.current_games_ddb.table_name
}

output "current_games_api_invoke_url" {
  description = "Invoke URL for the current-games API."
  value       = module.current_games_api.stage_invoke_url
}

output "update_status_lambda_arn" {
  description = "ARN of the update-status Lambda function."
  value       = module.update_status_lambda.function_arn
}

output "list_games_lambda_arn" {
  description = "ARN of the list-games Lambda function."
  value       = module.list_games_lambda.function_arn
}
