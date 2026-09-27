resource "aws_cloudfront_cache_policy" "assets" {
  for_each = var.cdn.enabled ? local.asset_cache_ttls : {}

  name        = "${var.project}-${var.environment}-assets-${each.key}"
  min_ttl     = 0
  default_ttl = each.value.default
  max_ttl     = each.value.max

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings {
        items = ["versionId", "response-content-type", "v"]
      }
    }
  }
}

resource "aws_cloudfront_origin_request_policy" "asset_cors" {
  count = var.cdn.enabled ? 1 : 0

  name = "${var.project}-${var.environment}-asset-cors"
  cookies_config {
    cookie_behavior = "none"
  }
  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"]
    }
  }
  query_strings_config {
    query_string_behavior = "none"
  }
}

resource "aws_cloudfront_response_headers_policy" "asset_cors" {
  count = var.cdn.enabled && length(var.storage.allowed_cors_origins) > 0 ? 1 : 0

  name = "${var.project}-${var.environment}-asset-cors"
  cors_config {
    access_control_allow_credentials = false
    access_control_max_age_sec       = 300
    origin_override                  = true
    access_control_allow_origins {
      items = sort(tolist(var.storage.allowed_cors_origins))
    }
    access_control_allow_headers {
      items = ["*"]
    }
    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }
    access_control_expose_headers {
      items = local.asset_cors_expose_headers
    }
  }
}
