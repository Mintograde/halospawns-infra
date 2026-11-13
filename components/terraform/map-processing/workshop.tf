variable "workshop_maps" {
  type = object({
    enabled                     = optional(bool, false)
    image_tag                   = optional(string, "")
    schedule_enabled            = optional(bool, false)
    steam_credentials_parameter = optional(string, "")
  })
  default = {}
  validation {
    condition = !var.workshop_maps.enabled || (
      can(regex("^git-[0-9a-f]{40}$", var.workshop_maps.image_tag))
    )
    error_message = "Workshop worker requires an immutable CI commit image tag."
  }
}
locals {
  workshop_name = "${var.project}-workshop-maps-${var.environment}"
  workshop_hmac = try(local.trusted_service_hmac_parameter_names_by_client["workshop-maps"], "")
}
data "aws_ecr_image" "workshop" {
  count           = var.workshop_maps.enabled ? 1 : 0
  repository_name = "halospawns-workshop-maps"
  image_tag       = var.workshop_maps.image_tag
}
resource "aws_cloudwatch_log_group" "workshop" {
  count             = var.workshop_maps.enabled ? 1 : 0
  name              = "/aws/lambda/${local.workshop_name}"
  retention_in_days = 14
}
resource "aws_iam_role" "workshop" {
  count = var.workshop_maps.enabled ? 1 : 0
  name  = "${local.workshop_name}-role"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" }
  }] })
}
resource "aws_iam_role_policy" "workshop" {
  count = var.workshop_maps.enabled ? 1 : 0
  role  = aws_iam_role.workshop[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"],
    Resource = "${aws_cloudwatch_log_group.workshop[0].arn}:*" },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"],
    Resource = "${local.h1_film_bucket_arn}/workshop/maps/*" },
    { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = [
      for name in compact([local.workshop_hmac, var.workshop_maps.steam_credentials_parameter]) :
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${name}"
    ] }
  ] })
}
resource "aws_lambda_function" "workshop" {
  count                          = var.workshop_maps.enabled ? 1 : 0
  function_name                  = local.workshop_name
  role                           = aws_iam_role.workshop[0].arn
  package_type                   = "Image"
  architectures                  = ["x86_64"]
  image_uri                      = "${data.terraform_remote_state.ecr.outputs.repository_urls["halospawns-workshop-maps"]}@${data.aws_ecr_image.workshop[0].image_digest}"
  memory_size                    = 2048
  timeout                        = 900
  reserved_concurrent_executions = 1
  ephemeral_storage { size = 8192 }
  environment {
    variables = {
      APP_API_BASE_URL                     = local.app_api_base_url
      WORKSHOP_HMAC_PARAMETER              = local.workshop_hmac
      WORKSHOP_BUCKET                      = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      WORKSHOP_STEAM_CREDENTIALS_PARAMETER = var.workshop_maps.steam_credentials_parameter
    }
  }
  lifecycle {
    precondition {
      condition     = var.environment == "dev" && data.aws_caller_identity.current.account_id == "283279960672" && local.workshop_hmac != ""
      error_message = "Workshop requires dev and a configured HMAC parameter."
    }
  }
  depends_on = [aws_iam_role_policy.workshop]
}
resource "aws_cloudwatch_event_rule" "workshop" {
  count               = var.workshop_maps.enabled ? 1 : 0
  name                = "${local.workshop_name}-poll"
  schedule_expression = "rate(15 minutes)"
  state               = var.workshop_maps.schedule_enabled ? "ENABLED" : "DISABLED"
}
resource "aws_cloudwatch_event_target" "workshop" {
  count = var.workshop_maps.enabled ? 1 : 0
  rule  = aws_cloudwatch_event_rule.workshop[0].name
  arn   = aws_lambda_function.workshop[0].arn
  input = jsonencode({ action = "poll" })
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 2
  }
}
resource "aws_lambda_permission" "workshop" {
  count         = var.workshop_maps.enabled ? 1 : 0
  statement_id  = "WorkshopSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.workshop[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.workshop[0].arn
}
resource "aws_cloudwatch_metric_alarm" "workshop_errors" {
  count               = var.workshop_maps.enabled ? 1 : 0
  alarm_name          = "${local.workshop_name}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.workshop[0].function_name }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
