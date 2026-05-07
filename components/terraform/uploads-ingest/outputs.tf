output "uploads_bucket_name" {
  description = "Name of the uploads S3 bucket."
  value       = module.uploads_bucket.s3_bucket_id
}

output "uploads_bucket_arn" {
  description = "ARN of the uploads S3 bucket."
  value       = module.uploads_bucket.s3_bucket_arn
}

output "uploads_bucket_regional_domain_name" {
  description = "Regional domain name of the uploads S3 bucket."
  value       = module.uploads_bucket.bucket_regional_domain_name
}

output "file_processing_queue_arns" {
  description = "Processing SQS queue ARNs by upload type."
  value = {
    for upload_type, queue in aws_sqs_queue.file_processing :
    upload_type => queue.arn
  }
}

output "cloudfront_distribution_domain_name" {
  description = "Domain name of the CloudFront distribution."
  value       = aws_cloudfront_distribution.s3_distribution.domain_name
}

output "cloudfront_key_id" {
  description = "ID of the CloudFront public key used for signed URLs."
  value       = aws_cloudfront_public_key.main.id
}

output "upload_domain_name" {
  description = "Domain name to use for uploads."
  value       = local.full_domain_name
}

output "upload_signing_private_key_secret_arn" {
  description = "ARN of the Secrets Manager secret that stores the CloudFront private signing key value."
  value       = aws_secretsmanager_secret.upload_signing_private_key.arn
}

output "upload_signing_private_key_secret_name" {
  description = "Name of the Secrets Manager secret that stores the CloudFront private signing key value."
  value       = aws_secretsmanager_secret.upload_signing_private_key.name
}

output "upload_signing_public_key_parameter_name" {
  description = "Name of the SSM parameter that stores the CloudFront public signing key value."
  value       = aws_ssm_parameter.upload_signing_public_key.name
}
