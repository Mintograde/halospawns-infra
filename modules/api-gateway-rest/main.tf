data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  routes_map               = { for r in var.routes : "${trim(r.path, "/")}_${lower(r.method)}" => r }
  create_api_key_effective = var.create_api_key == null ? (var.usage_plan != null && try(var.usage_plan.enabled, false)) : var.create_api_key
}

resource "aws_api_gateway_rest_api" "this" {
  name = var.api_name
}

resource "aws_api_gateway_resource" "route" {
  for_each    = local.routes_map
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = trim(each.value.path, "/")
}

resource "aws_api_gateway_method" "this" {
  for_each         = local.routes_map
  rest_api_id      = aws_api_gateway_rest_api.this.id
  resource_id      = aws_api_gateway_resource.route[each.key].id
  http_method      = upper(each.value.method)
  authorization    = "NONE"
  api_key_required = try(each.value.api_key_required, false)
}

resource "aws_api_gateway_integration" "proxy" {
  for_each                = local.routes_map
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.route[each.key].id
  http_method             = aws_api_gateway_method.this[each.key].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = "arn:aws:apigateway:${data.aws_region.current.region}:lambda:path/2015-03-31/functions/${each.value.lambda_arn}/invocations"
}

resource "aws_lambda_permission" "apigw_invoke" {
  for_each      = local.routes_map
  statement_id  = "AllowAPIGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.lambda_arn
  principal     = "apigateway.amazonaws.com"
  source_arn    = "arn:aws:execute-api:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:${aws_api_gateway_rest_api.this.id}/*/${upper(each.value.method)}${each.value.path}"
}

resource "aws_api_gateway_deployment" "this" {
  depends_on  = [aws_api_gateway_integration.proxy]
  rest_api_id = aws_api_gateway_rest_api.this.id
  triggers = {
    redeployment = sha1(jsonencode(var.routes))
  }
}

resource "aws_api_gateway_stage" "this" {
  stage_name    = var.stage_name
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  tags          = var.tags
}

resource "aws_api_gateway_usage_plan" "this" {
  count = var.usage_plan != null && try(var.usage_plan.enabled, false) ? 1 : 0

  name = coalesce(try(var.usage_plan.name, null), "${var.api_name}-${var.stage_name}")

  dynamic "api_stages" {
    for_each = [1]
    content {
      api_id = aws_api_gateway_rest_api.this.id
      stage  = aws_api_gateway_stage.this.stage_name
    }
  }

  dynamic "throttle_settings" {
    for_each = try(var.usage_plan.throttle_burst, null) != null || try(var.usage_plan.throttle_rate, null) != null ? [1] : []
    content {
      burst_limit = try(var.usage_plan.throttle_burst, null)
      rate_limit  = try(var.usage_plan.throttle_rate, null)
    }
  }

  dynamic "quota_settings" {
    for_each = try(var.usage_plan.quota_limit, null) != null ? [1] : []
    content {
      limit  = var.usage_plan.quota_limit
      period = coalesce(try(var.usage_plan.quota_period, null), "MONTH")
    }
  }
}

resource "aws_api_gateway_api_key" "this" {
  count   = local.create_api_key_effective ? 1 : 0
  name    = "${var.api_name}-${var.stage_name}-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan_key" "this" {
  count         = (var.usage_plan != null && try(var.usage_plan.enabled, false) && local.create_api_key_effective) ? 1 : 0
  key_id        = aws_api_gateway_api_key.this[0].id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.this[0].id
}
