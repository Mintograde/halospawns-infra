variable "homepage_snapshot_enabled" {
  description = "Publish the public homepage data to the frontend site distribution."
  type        = bool
  default     = false
}

locals {
  publish_homepage = var.enabled && var.homepage_snapshot_enabled
}

resource "aws_iam_role_policy" "homepage_snapshot" {
  count = local.publish_homepage ? 1 : 0
  name  = "homepage-snapshot"
  role  = module.app_lambda[0].role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:${data.aws_partition.current.partition}:s3:::${data.terraform_remote_state.frontend_site[0].outputs.site_bucket_name}/data/home/v1.json"
      },
      {
        Effect   = "Allow"
        Action   = "cloudfront:CreateInvalidation"
        Resource = data.terraform_remote_state.frontend_site[0].outputs.cloudfront_distribution_arn
      }
    ]
  })
}

resource "aws_cloudwatch_event_rule" "homepage_snapshot" {
  count               = local.publish_homepage ? 1 : 0
  name                = "${var.project}-${var.environment}-homepage-snapshot"
  schedule_expression = "rate(1 minute)"
}

resource "aws_lambda_permission" "homepage_snapshot" {
  count         = local.publish_homepage ? 1 : 0
  statement_id  = "AllowHomepageSchedule"
  action        = "lambda:InvokeFunction"
  function_name = module.app_lambda[0].function_name
  qualifier     = module.app_lambda[0].alias_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.homepage_snapshot[0].arn
}

resource "aws_cloudwatch_event_target" "homepage_snapshot" {
  count = local.publish_homepage ? 1 : 0
  rule  = aws_cloudwatch_event_rule.homepage_snapshot[0].name
  arn   = module.app_lambda[0].alias_arn
  input = jsonencode({
    schema          = "halospawns.homepagePublication.v1"
    bucket          = data.terraform_remote_state.frontend_site[0].outputs.site_bucket_name
    distribution_id = data.terraform_remote_state.frontend_site[0].outputs.cloudfront_distribution_id
  })
  retry_policy {
    maximum_event_age_in_seconds = 60
    maximum_retry_attempts       = 1
  }
  depends_on = [aws_iam_role_policy.homepage_snapshot, aws_lambda_permission.homepage_snapshot]
}
