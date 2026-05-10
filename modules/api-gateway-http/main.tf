locals {
  domain_name                = var.domain_name == null ? null : trimspace(var.domain_name)
  create_domain              = local.domain_name != null && local.domain_name != ""
  create_managed_certificate = local.create_domain && var.create_certificate
  certificate_arn            = local.create_managed_certificate ? aws_acm_certificate_validation.this[0].certificate_arn : var.certificate_arn
  route_map                  = { for route in var.routes : route.route_key => route }
}

resource "aws_apigatewayv2_api" "this" {
  name          = var.name
  description   = var.description
  protocol_type = "HTTP"
  tags          = var.tags

  dynamic "cors_configuration" {
    for_each = length(var.cors_allowed_origins) > 0 ? [1] : []

    content {
      allow_headers = var.cors_allowed_headers
      allow_methods = var.cors_allowed_methods
      allow_origins = var.cors_allowed_origins
      max_age       = var.cors_max_age_seconds
    }
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = var.lambda_invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  count = var.jwt_authorizer == null ? 0 : 1

  api_id           = aws_apigatewayv2_api.this.id
  authorizer_type  = "JWT"
  identity_sources = var.jwt_authorizer.identity_sources
  name             = coalesce(var.jwt_authorizer.name, "${var.name}-jwt")

  jwt_configuration {
    audience = var.jwt_authorizer.audience
    issuer   = var.jwt_authorizer.issuer
  }
}

resource "aws_apigatewayv2_route" "this" {
  for_each = local.route_map

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = each.value.route_key
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = each.value.authorization_type
  authorizer_id      = each.value.authorization_type == "JWT" ? aws_apigatewayv2_authorizer.jwt[0].id : null

  lifecycle {
    precondition {
      condition     = each.value.authorization_type != "JWT" || var.jwt_authorizer != null
      error_message = "JWT routes require jwt_authorizer to be configured."
    }
  }
}

resource "aws_apigatewayv2_stage" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = var.stage_name
  auto_deploy = true
  tags        = var.tags
}

resource "aws_lambda_permission" "allow_api_gateway" {
  statement_id  = "AllowExecutionFrom-${replace(var.name, "-", "")}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  qualifier     = var.lambda_alias_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

resource "aws_acm_certificate" "this" {
  count = local.create_managed_certificate ? 1 : 0

  domain_name       = local.domain_name
  validation_method = "DNS"
  tags              = var.tags

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
      condition     = var.create_dns_records && var.hosted_zone_id != null
      error_message = "create_certificate requires create_dns_records = true and hosted_zone_id so Terraform can create DNS validation records."
    }
  }
}

resource "aws_apigatewayv2_domain_name" "this" {
  count = local.create_domain ? 1 : 0

  domain_name = local.domain_name
  tags        = var.tags

  domain_name_configuration {
    certificate_arn = local.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  lifecycle {
    precondition {
      condition     = local.certificate_arn != null
      error_message = "A custom domain requires either certificate_arn or create_certificate = true."
    }
  }
}

resource "aws_apigatewayv2_api_mapping" "this" {
  count = local.create_domain ? 1 : 0

  api_id      = aws_apigatewayv2_api.this.id
  domain_name = aws_apigatewayv2_domain_name.this[0].id
  stage       = aws_apigatewayv2_stage.this.id
}

resource "aws_route53_record" "api_a" {
  count = local.create_domain && var.create_dns_records ? 1 : 0

  name    = local.domain_name
  type    = "A"
  zone_id = var.hosted_zone_id

  alias {
    evaluate_target_health = false
    name                   = aws_apigatewayv2_domain_name.this[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.this[0].domain_name_configuration[0].hosted_zone_id
  }
}

resource "aws_route53_record" "api_aaaa" {
  count = local.create_domain && var.create_dns_records && var.create_aaaa_record ? 1 : 0

  name    = local.domain_name
  type    = "AAAA"
  zone_id = var.hosted_zone_id

  alias {
    evaluate_target_health = false
    name                   = aws_apigatewayv2_domain_name.this[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.this[0].domain_name_configuration[0].hosted_zone_id
  }
}
