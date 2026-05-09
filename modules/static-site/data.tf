data "aws_caller_identity" "current" {}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

locals {
  domain_name = var.domain_name == null ? null : trimspace(var.domain_name)
  aliases     = distinct(compact(concat(var.aliases, local.domain_name == null ? [] : [local.domain_name])))

  origin_id                      = "s3-${aws_s3_bucket.this.id}"
  create_managed_certificate     = var.create_certificate && local.domain_name != null && local.domain_name != ""
  use_custom_certificate         = length(local.aliases) > 0
  viewer_request_lambda_provided = var.viewer_request_lambda_qualified_arn != null && trimspace(var.viewer_request_lambda_qualified_arn) != ""
  certificate_arn                = local.create_managed_certificate ? aws_acm_certificate_validation.this[0].certificate_arn : var.acm_certificate_arn
}

data "aws_iam_policy_document" "bucket_policy" {
  statement {
    sid     = "AllowCloudFrontRead"
    effect  = "Allow"
    actions = ["s3:GetObject"]

    resources = ["${aws_s3_bucket.this.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }

  statement {
    sid    = "DenyInsecureConnections"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.this.arn,
      "${aws_s3_bucket.this.arn}/*"
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}
