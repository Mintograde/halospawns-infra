variable "movement_flow_enabled" {
  type        = bool
  default     = false
  description = "Generate immutable movement fields for selected replay worlds and heatmap scopes."
}

data "aws_iam_policy_document" "movement_flow" {
  count = var.movement_flow_enabled ? 1 : 0
  statement {
    sid     = "ReadSelectedMovementSources"
    actions = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = [
      "${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${local.replay_viewer_artifact_prefix}/*",
      "${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/${trim(local.upload_pipelines.replays.processed_prefix, "/")}/*",
    ]
  }
  statement {
    sid       = "PublishMovementFields"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn}/heatmaps/precomputed/v1/movement/views/*.json"]
  }
}

module "movement_flow" {
  count                          = var.movement_flow_enabled ? 1 : 0
  source                         = "../../../modules/lambda-s3-managed"
  function_name                  = "${var.project}-movement-flow-${var.environment}"
  runtime                        = "python3.12"
  handler                        = "worker.handler"
  source_dir                     = "../../../lambda/movement_flow_worker/bootstrap"
  alias_name                     = "live"
  timeout                        = 360
  memory_size                    = 3008
  ephemeral_storage_size         = 1024
  reserved_concurrent_executions = 12
  environment_variables = {
    UPLOADS_BUCKET_NAME                        = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
    APP_API_BASE_URL                           = local.app_api_base_url
    APP_API_TRUSTED_CLIENT_HMAC_PARAMETER_NAME = local.heatmap_rollup_worker_trusted_service_hmac_parameter_name
    VIEWER_PREFIX                              = local.replay_viewer_artifact_prefix
    RECORDING_PREFIX                           = local.upload_pipelines.replays.processed_prefix
  }
  policies_json = [
    data.aws_iam_policy_document.movement_flow[0].json,
    data.aws_iam_policy_document.trusted_service_hmac_parameter[local.heatmap_rollup_worker_trusted_hmac_client].json,
  ]
}

resource "aws_cloudwatch_event_rule" "movement_flow" {
  count               = var.movement_flow_enabled ? 1 : 0
  name                = "${var.project}-${var.environment}-movement-flow"
  schedule_expression = "rate(2 minutes)"
}

resource "aws_cloudwatch_event_target" "movement_flow" {
  count = var.movement_flow_enabled ? 1 : 0
  rule  = aws_cloudwatch_event_rule.movement_flow[0].name
  arn   = module.movement_flow[0].alias_arn
}

resource "aws_lambda_permission" "movement_flow" {
  count         = var.movement_flow_enabled ? 1 : 0
  statement_id  = "AllowMovementSchedule"
  action        = "lambda:InvokeFunction"
  function_name = module.movement_flow[0].function_name
  qualifier     = module.movement_flow[0].alias_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.movement_flow[0].arn
}

resource "aws_cloudwatch_metric_alarm" "movement_flow_errors" {
  count               = var.movement_flow_enabled ? 1 : 0
  alarm_name          = "${var.project}-${var.environment}-movement-flow-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  period              = 300
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = module.movement_flow[0].function_name }
}
