output "cloudfront_key_id" {
  description = "ID of the public key to be used for signed URLs"
  value       = aws_cloudfront_public_key.main.id
}

output "cloudfront_distribution_name" {
  description = "Domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.s3_distribution.domain_name
}

output "upload_domain_name" {
  description = "Domain name to use for uploads to the bucket"
  value       = local.full_domain_name
}
