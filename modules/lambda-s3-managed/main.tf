data "archive_file" "bootstrap" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = coalesce(var.output_path, "${path.module}/${var.function_name}-bootstrap.zip")
}

data "aws_partition" "current" {}

data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.function_name}-exec-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "custom_inline" {
  for_each = { for idx, doc in var.policies_json : tostring(idx) => doc }

  name   = "inline-${each.key}"
  role   = aws_iam_role.lambda_exec.id
  policy = each.value
}

resource "aws_iam_role_policy_attachment" "extra_attachments" {
  for_each = toset(var.role_policy_arns)

  role       = aws_iam_role.lambda_exec.name
  policy_arn = each.value
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_lambda_function" "this" {
  function_name                  = var.function_name
  role                           = aws_iam_role.lambda_exec.arn
  runtime                        = var.runtime
  handler                        = var.handler
  filename                       = data.archive_file.bootstrap.output_path
  source_code_hash               = data.archive_file.bootstrap.output_base64sha256
  publish                        = true
  timeout                        = var.timeout
  memory_size                    = var.memory_size
  layers                         = var.layers
  reserved_concurrent_executions = var.reserved_concurrent_executions
  tags                           = var.tags

  dynamic "ephemeral_storage" {
    for_each = var.ephemeral_storage_size == null ? [] : [var.ephemeral_storage_size]

    content {
      size = ephemeral_storage.value
    }
  }

  environment {
    variables = var.environment_variables
  }

  tracing_config {
    mode = var.tracing_mode
  }

  lifecycle {
    ignore_changes = [
      filename,
      source_code_hash,
    ]
  }

  depends_on = [
    aws_cloudwatch_log_group.this,
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy.custom_inline,
    aws_iam_role_policy_attachment.extra_attachments,
  ]
}

resource "aws_lambda_alias" "live" {
  name             = var.alias_name
  description      = "Externally deployed live version for ${var.function_name}."
  function_name    = aws_lambda_function.this.function_name
  function_version = aws_lambda_function.this.version

  lifecycle {
    ignore_changes = [
      description,
      function_version,
    ]
  }
}
