output "function_arns" {
  description = "Map-processing Lambda function ARNs by workload name."
  value = {
    for name, consumer in module.sqs_lambda_consumers :
    name => consumer.function_arn
  }
}
