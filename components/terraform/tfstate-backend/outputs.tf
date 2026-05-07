output "bucket_name" {
  description = "Name of the Terraform state S3 bucket."
  value       = module.backend.s3_bucket_id
}

output "bucket_arn" {
  description = "ARN of the Terraform state S3 bucket."
  value       = module.backend.s3_bucket_arn
}
