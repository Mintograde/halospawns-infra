module "uploads_bucket" {
  source                  = "../../../modules/s3-bucket"
  bucket_prefix           = var.storage.bucket_prefix
  environment             = var.environment
  allowed_cors_origins    = var.storage.allowed_cors_origins
  source_policy_documents = [data.aws_iam_policy_document.cloudfront_to_s3_policy.json]
}

resource "aws_s3_bucket_lifecycle_configuration" "replay_spatial_artifacts" {
  bucket = module.uploads_bucket.s3_bucket_id

  rule {
    id     = "replay-spatial-artifact-versions"
    status = "Enabled"

    filter {
      prefix = local.replay_spatial_artifact_prefix
    }

    noncurrent_version_expiration {
      noncurrent_days = var.storage.replay_spatial_artifacts.noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = var.storage.replay_spatial_artifacts.abort_incomplete_multipart_days
    }
  }

  rule {
    id     = "heatmap-rollup-artifact-versions"
    status = "Enabled"

    filter {
      prefix = local.heatmap_rollup_artifact_prefix
    }

    noncurrent_version_expiration {
      noncurrent_days = var.storage.heatmap_rollup_artifacts.noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = var.storage.heatmap_rollup_artifacts.abort_incomplete_multipart_days
    }
  }

  rule {
    id     = "heatmap-rollup-superseded-generations"
    status = "Enabled"

    filter {
      and {
        prefix                   = local.heatmap_rollup_artifact_prefix
        object_size_greater_than = 0
        object_size_less_than    = 5368709120
        tags = {
          halospawns-rollup-state = "superseded"
        }
      }
    }

    expiration {
      days = var.storage.heatmap_rollup_artifacts.superseded_expiration_days
    }
  }

  depends_on = [module.uploads_bucket]
}

data "aws_iam_policy_document" "s3_to_sns_policy" {
  for_each = local.pipelines

  statement {
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.file_uploaded[each.key].arn]

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [module.uploads_bucket.s3_bucket_arn]
    }
  }
}

resource "aws_sns_topic_policy" "s3_publish_permission" {
  for_each = local.pipelines
  arn      = aws_sns_topic.file_uploaded[each.key].arn
  policy   = data.aws_iam_policy_document.s3_to_sns_policy[each.key].json
}

resource "aws_s3_bucket_notification" "uploads_notification" {
  bucket = module.uploads_bucket.s3_bucket_id

  dynamic "topic" {
    for_each = local.pipelines
    content {
      topic_arn     = aws_sns_topic.file_uploaded[topic.key].arn
      events        = ["s3:ObjectCreated:*"]
      filter_prefix = topic.value.unprocessed_prefix
    }
  }

  depends_on = [aws_sns_topic_policy.s3_publish_permission]
}

resource "aws_sns_topic" "file_uploaded" {
  for_each = local.pipelines
  name     = "${each.key}-uploaded-topic"
}

resource "aws_sqs_queue" "file_processing" {
  for_each                   = local.pipelines
  name                       = "${each.key}-processing-queue"
  visibility_timeout_seconds = each.value.visibility_timeout_seconds
  message_retention_seconds  = each.value.message_retention_seconds
  receive_wait_time_seconds  = each.value.receive_wait_time_seconds
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.file_dlq[each.key].arn
    maxReceiveCount     = each.value.max_receive_count
  })
}

resource "aws_sqs_queue" "file_dlq" {
  for_each = local.pipelines
  name     = "${each.key}-processing-dlq"
}

resource "aws_sqs_queue_redrive_allow_policy" "example" {
  for_each  = local.pipelines
  queue_url = aws_sqs_queue.file_dlq[each.key].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue",
    sourceQueueArns   = [aws_sqs_queue.file_processing[each.key].arn]
  })
}

resource "aws_sns_topic_subscription" "file_subscription" {
  for_each   = local.pipelines
  topic_arn  = aws_sns_topic.file_uploaded[each.key].arn
  protocol   = "sqs"
  endpoint   = aws_sqs_queue.file_processing[each.key].arn
  depends_on = [aws_sqs_queue_policy.file_policy]
}

data "aws_iam_policy_document" "file_sqs_policy" {
  for_each = local.pipelines

  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.file_processing[each.key].arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.file_uploaded[each.key].arn]
    }
  }
}

resource "aws_sqs_queue_policy" "file_policy" {
  for_each = local.pipelines

  queue_url = aws_sqs_queue.file_processing[each.key].id
  policy    = data.aws_iam_policy_document.file_sqs_policy[each.key].json
}

resource "aws_cloudfront_origin_access_control" "uploads_oac" {
  name                              = "OAC for ${module.uploads_bucket.s3_bucket_id}"
  description                       = "Origin Access Control for S3 uploads"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "cloudfront_to_s3_policy" {
  statement {
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${module.uploads_bucket.s3_bucket_arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.s3_distribution.arn]
    }
  }
}

resource "aws_secretsmanager_secret" "upload_signing_private_key" {
  name                    = local.upload_signing_private_key_secret_name
  description             = "Private key for signing CloudFront upload URLs for ${local.full_domain_name}"
  recovery_window_in_days = 30
}

resource "aws_ssm_parameter" "upload_signing_public_key" {
  name        = local.upload_signing_public_key_parameter_name
  description = "Public key for signing CloudFront upload URLs for ${local.full_domain_name}"
  type        = "String"
  value       = "PENDING_PUBLIC_KEY_SEED"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_cloudfront_public_key" "main" {
  comment     = "Public key for signing upload URLs"
  encoded_key = nonsensitive(aws_ssm_parameter.upload_signing_public_key.value)
  name        = var.cdn.public_key_name

  lifecycle {
    precondition {
      condition = (
        startswith(trimspace(nonsensitive(aws_ssm_parameter.upload_signing_public_key.value)), "-----BEGIN PUBLIC KEY-----") &&
        endswith(trimspace(nonsensitive(aws_ssm_parameter.upload_signing_public_key.value)), "-----END PUBLIC KEY-----")
      )
      error_message = "Seed ${local.upload_signing_public_key_parameter_name} with a PEM public key before applying CloudFront resources."
    }
  }
}

resource "aws_cloudfront_key_group" "main" {
  comment = "Key group for signing upload URLs"
  items   = [aws_cloudfront_public_key.main.id]
  name    = var.cdn.key_group_name
}

resource "aws_acm_certificate" "cert" {
  domain_name       = local.full_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudfront_distribution" "s3_distribution" {
  origin {
    domain_name              = module.uploads_bucket.bucket_regional_domain_name
    origin_id                = "S3-${module.uploads_bucket.s3_bucket_id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.uploads_oac.id
  }

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "CDN for ${local.full_domain_name}"
  default_root_object = "index.html"

  aliases = [local.full_domain_name]

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${module.uploads_bucket.s3_bucket_id}"

    trusted_key_groups = [aws_cloudfront_key_group.main.id]

    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.cert.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  price_class = var.cdn.price_class
}
