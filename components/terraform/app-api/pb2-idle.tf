variable "pb2_idle_enabled" {
  description = "Audit saved PB2 gameplay inputs and living time for statistical eligibility."
  type        = bool
  default     = false
}

locals {
  audit_pb2_idle = var.enabled && var.pb2_idle_enabled
}

module "pb2_idle" {
  count                          = local.audit_pb2_idle ? 1 : 0
  source                         = "../../../modules/lambda-s3-managed"
  function_name                  = "${var.project}-${var.environment}-pb2-idle"
  runtime                        = "nodejs24.x"
  handler                        = "index.handler"
  source_dir                     = "../../../lambda/pb2_idle_worker/bootstrap"
  alias_name                     = "live"
  timeout                        = 300
  memory_size                    = 3008
  reserved_concurrent_executions = 4
  environment_variables = {
    API_ALIAS      = module.app_lambda[0].alias_arn
    UPLOADS_BUCKET = local.uploads_bucket_name
  }
  policies_json = [jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "lambda:InvokeFunction", Resource = module.app_lambda[0].alias_arn },
      { Effect = "Allow", Action = "s3:GetObjectVersion", Resource = concat(
        ["${local.uploads_bucket_arn}/films/unprocessed/*"],
        local.replay_viewer_artifact_get_object_resource_arns
      ) }
    ]
  })]
  tags = var.tags
}

resource "aws_cloudwatch_event_rule" "pb2_idle" {
  count               = local.audit_pb2_idle ? 1 : 0
  name                = "${var.project}-${var.environment}-pb2-idle"
  schedule_expression = "rate(2 minutes)"
}

resource "aws_lambda_permission" "pb2_idle" {
  count         = local.audit_pb2_idle ? 1 : 0
  statement_id  = "AllowPb2IdleSchedule"
  action        = "lambda:InvokeFunction"
  function_name = module.pb2_idle[0].function_name
  qualifier     = module.pb2_idle[0].alias_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.pb2_idle[0].arn
}

resource "aws_cloudwatch_event_target" "pb2_idle" {
  count      = local.audit_pb2_idle ? 1 : 0
  rule       = aws_cloudwatch_event_rule.pb2_idle[0].name
  arn        = module.pb2_idle[0].alias_arn
  depends_on = [aws_lambda_permission.pb2_idle]
}
