variable "replay_clips_enabled" {
  type    = bool
  default = false
}

locals {
  replay_clips_enabled = var.enabled && var.replay_clips_enabled
  replay_clips_name    = "${var.project}-${var.environment}-replay-clips"
}

module "replay_clips" {
  count                          = local.replay_clips_enabled ? 1 : 0
  source                         = "../../../modules/lambda-s3-managed"
  function_name                  = local.replay_clips_name
  runtime                        = "nodejs24.x"
  handler                        = "index.handler"
  source_dir                     = "../../../lambda/replay_clips/bootstrap"
  alias_name                     = "live"
  timeout                        = 240
  memory_size                    = 3008
  reserved_concurrent_executions = 8
  environment_variables = {
    API_ALIAS      = module.app_lambda[0].alias_arn
    UPLOADS_BUCKET = local.uploads_bucket_name
    VIEWER_PREFIX  = local.replay_viewer_artifact_prefix
  }
  policies_json = [jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "lambda:InvokeFunction", Resource = module.app_lambda[0].alias_arn },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion"], Resource = local.replay_viewer_artifact_get_object_resource_arns },
      { Effect = "Allow", Action = "s3:PutObject", Resource = "${local.uploads_bucket_arn}/${local.replay_viewer_artifact_prefix}/clips/v1/*.hsrv" }
    ]
  })]
  tags = var.tags
}

resource "aws_iam_role_policy" "queue_replay_clip" {
  count = local.replay_clips_enabled ? 1 : 0
  name  = "extract-replay-clip"
  role  = module.app_lambda[0].role_name
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = module.replay_clips[0].alias_arn }]
  })
}

resource "aws_cloudwatch_event_rule" "replay_clips" {
  count               = local.replay_clips_enabled ? 1 : 0
  name                = local.replay_clips_name
  schedule_expression = "rate(1 minute)"
}

resource "aws_lambda_permission" "replay_clips" {
  count         = local.replay_clips_enabled ? 1 : 0
  statement_id  = "AllowClipSchedule"
  action        = "lambda:InvokeFunction"
  function_name = module.replay_clips[0].function_name
  qualifier     = module.replay_clips[0].alias_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.replay_clips[0].arn
}

resource "aws_cloudwatch_event_target" "replay_clips" {
  count      = local.replay_clips_enabled ? 1 : 0
  rule       = aws_cloudwatch_event_rule.replay_clips[0].name
  arn        = module.replay_clips[0].alias_arn
  depends_on = [aws_lambda_permission.replay_clips]
}
