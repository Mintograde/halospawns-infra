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

output "region_stat_rollup_artifact_prefix" {
  description = "Stable S3 prefix for immutable region-stat rollup generations."
  value       = local.region_stat_rollup_artifact_prefix
}

output "replay_viewer_artifact_prefix" {
  description = "Stable S3 prefix for immutable content-addressed replay viewer generations."
  value       = local.replay_viewer_artifact_prefix
}

output "pipelines" {
  description = "Upload processing contracts keyed by upload type."
  value = {
    for name, queue in aws_sqs_queue.file_processing : name => {
      queue_name = queue.name
      queue_arn  = queue.arn
      queue_url  = queue.url
      queue_age_threshold_seconds = lookup(
        var.observability.queue_age_threshold_seconds,
        name,
        local.pipelines[name].visibility_timeout_seconds,
      )
      dlq_name           = aws_sqs_queue.file_dlq[name].name
      dlq_arn            = aws_sqs_queue.file_dlq[name].arn
      dlq_url            = aws_sqs_queue.file_dlq[name].url
      unprocessed_prefix = local.pipelines[name].unprocessed_prefix
      processed_prefix   = local.pipelines[name].processed_prefix
      failed_prefix      = local.pipelines[name].failed_prefix
    }
  }
}

output "cloudfront_distribution_domain_name" {
  description = "Domain name of the CloudFront distribution."
  value       = var.cdn.enabled ? aws_cloudfront_distribution.s3_distribution[0].domain_name : null
}

output "cloudfront_distribution_id" {
  description = "ID of the uploads CloudFront distribution."
  value       = var.cdn.enabled ? aws_cloudfront_distribution.s3_distribution[0].id : null
}

output "processing_queue_alarm_names" {
  description = "CloudWatch queue-age and dead-letter queue alarm names by upload type."
  value       = var.observability.enabled ? local.processing_queue_alarm_names : {}
}

output "cloudfront_key_id" {
  description = "ID of the CloudFront public key used for signed URLs."
  value       = var.cdn.enabled ? aws_cloudfront_public_key.main[0].id : null
}

output "upload_domain_name" {
  description = "Domain name to use for uploads."
  value       = var.cdn.enabled ? local.full_domain_name : null
}

output "upload_signing_private_key_parameter_name" {
  description = "Name of the externally managed SSM SecureString that stores the CloudFront private signing key value."
  value       = var.cdn.enabled ? local.upload_signing_private_key_parameter_name : null
}

output "upload_signing_private_key_parameter_arn" {
  description = "ARN of the externally managed SSM SecureString that stores the CloudFront private signing key value."
  value       = var.cdn.enabled ? local.upload_signing_private_key_parameter_arn : null
}

output "upload_signing_public_key_parameter_name" {
  description = "Name of the SSM parameter that stores the CloudFront public signing key value."
  value       = aws_ssm_parameter.upload_signing_public_key.name
}
