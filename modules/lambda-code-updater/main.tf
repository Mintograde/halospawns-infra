data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "archive_file" "this" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = var.output_path
  excludes    = ["**/__pycache__/**", "**/*.pyc"]
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "this" {
  statement {
    sid = "ReadReleaseArtifacts"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = ["${var.artifact_bucket_arn}/${var.artifact_release_prefix}*"]
  }

  statement {
    sid = var.update_code_statement_sid
    actions = [
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:UpdateFunctionCode",
      "lambda:PublishVersion",
    ]
    resources = [var.target_function_arn]
  }

  statement {
    sid = "UpdateLiveAlias"
    actions = [
      "lambda:GetAlias",
      "lambda:UpdateAlias",
    ]
    resources = [
      var.target_function_arn,
      var.target_alias_arn,
    ]
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_iam_role" "this" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "this" {
  name   = var.policy_name
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.this.json
}

resource "aws_lambda_function" "this" {
  function_name                  = var.function_name
  role                           = aws_iam_role.this.arn
  runtime                        = "python3.12"
  handler                        = "handler.handler"
  filename                       = data.archive_file.this.output_path
  source_code_hash               = data.archive_file.this.output_base64sha256
  timeout                        = 300
  memory_size                    = 128
  reserved_concurrent_executions = var.reserved_concurrent_executions
  tags                           = var.tags

  environment {
    variables = {
      TARGET_FUNCTION_NAME    = var.target_function_name
      TARGET_ALIAS_NAME       = var.target_alias_name
      ARTIFACT_RELEASE_PREFIX = var.artifact_release_prefix
      ARTIFACT_SUFFIX         = ".zip"
      WAIT_TIMEOUT_SECONDS    = "300"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.this,
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy.this,
  ]
}

resource "aws_lambda_permission" "artifact_bucket" {
  statement_id   = var.permission_statement_id
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.this.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = var.artifact_bucket_arn
  source_account = data.aws_caller_identity.current.account_id
}
