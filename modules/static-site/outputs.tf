output "bucket_name" {
  description = "Name of the static site S3 bucket."
  value       = aws_s3_bucket.this.id
}

output "bucket_arn" {
  description = "ARN of the static site S3 bucket."
  value       = aws_s3_bucket.this.arn
}

output "bucket_regional_domain_name" {
  description = "Regional domain name of the static site S3 bucket."
  value       = aws_s3_bucket.this.bucket_regional_domain_name
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution."
  value       = aws_cloudfront_distribution.this.id
}

output "cloudfront_distribution_arn" {
  description = "ARN of the CloudFront distribution."
  value       = aws_cloudfront_distribution.this.arn
}

output "cloudfront_domain_name" {
  description = "Default CloudFront distribution domain name."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "cloudfront_hosted_zone_id" {
  description = "CloudFront hosted zone ID for alias records."
  value       = aws_cloudfront_distribution.this.hosted_zone_id
}

output "site_url" {
  description = "Frontend site URL."
  value       = length(local.aliases) > 0 ? "https://${local.aliases[0]}" : "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "access_control_mode" {
  description = "Configured viewer access control mode."
  value       = var.access_control_mode
}
