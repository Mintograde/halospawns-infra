resource "aws_s3_bucket" "this" {
  bucket = "${var.bucket_prefix}-${var.environment}-${data.aws_caller_identity.current.account_id}"
  tags   = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = "OAC for ${aws_s3_bucket.this.id}"
  description                       = "Origin access control for ${aws_s3_bucket.this.id}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_acm_certificate" "this" {
  count = local.create_managed_certificate ? 1 : 0

  domain_name               = local.domain_name
  subject_alternative_names = [for alias in local.aliases : alias if alias != local.domain_name]
  validation_method         = "DNS"
  tags                      = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "certificate_validation" {
  for_each = local.create_managed_certificate && var.create_dns_records ? {
    for option in aws_acm_certificate.this[0].domain_validation_options :
    option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.hosted_zone_id
}

resource "aws_acm_certificate_validation" "this" {
  count = local.create_managed_certificate ? 1 : 0

  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]

  lifecycle {
    precondition {
      condition     = var.create_dns_records
      error_message = "create_certificate requires create_dns_records = true so Terraform can create DNS validation records."
    }
  }
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project}-${var.environment} frontend site"
  default_root_object = var.default_root_object
  price_class         = var.price_class
  aliases             = local.aliases

  origin {
    domain_name              = aws_s3_bucket.this.bucket_regional_domain_name
    origin_id                = local.origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.origin_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id

    dynamic "lambda_function_association" {
      for_each = var.access_control_mode == "basic_auth" ? [var.viewer_request_lambda_qualified_arn] : []

      content {
        event_type   = "viewer-request"
        lambda_arn   = lambda_function_association.value
        include_body = false
      }
    }
  }

  dynamic "custom_error_response" {
    for_each = var.spa_fallback_enabled ? toset([403, 404]) : toset([])

    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/${var.default_root_object}"
      error_caching_min_ttl = 0
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.use_custom_certificate ? false : true
    acm_certificate_arn            = local.use_custom_certificate ? local.certificate_arn : null
    ssl_support_method             = local.use_custom_certificate ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_certificate ? "TLSv1.2_2021" : "TLSv1"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  lifecycle {
    precondition {
      condition     = var.access_control_mode != "basic_auth" || local.viewer_request_lambda_provided
      error_message = "viewer_request_lambda_qualified_arn is required when access_control_mode is basic_auth."
    }

    precondition {
      condition     = !local.use_custom_certificate || local.certificate_arn != null
      error_message = "A CloudFront alias requires either acm_certificate_arn or create_certificate = true."
    }

    precondition {
      condition     = !var.create_certificate || (local.create_managed_certificate && var.hosted_zone_id != null)
      error_message = "create_certificate requires domain_name and hosted_zone_id so Terraform can create DNS validation records."
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket     = aws_s3_bucket.this.id
  policy     = data.aws_iam_policy_document.bucket_policy.json
  depends_on = [aws_s3_bucket_public_access_block.this]
}

resource "aws_route53_record" "site_a" {
  for_each = var.create_dns_records ? toset(local.aliases) : toset([])

  name    = each.value
  type    = "A"
  zone_id = var.hosted_zone_id

  alias {
    evaluate_target_health = false
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
  }
}

resource "aws_route53_record" "site_aaaa" {
  for_each = var.create_dns_records ? toset(local.aliases) : toset([])

  name    = each.value
  type    = "AAAA"
  zone_id = var.hosted_zone_id

  alias {
    evaluate_target_health = false
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
  }
}
