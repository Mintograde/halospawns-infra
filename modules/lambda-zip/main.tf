data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = coalesce(var.output_path, "${path.module}/${var.function_name}.zip")
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

resource "aws_iam_role" "lambda_exec_role" {
  name               = "${var.function_name}-exec-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "custom_inline" {
  for_each = { for idx, doc in var.policies_json : tostring(idx) => doc }
  name     = "inline-${each.key}"
  role     = aws_iam_role.lambda_exec_role.id
  policy   = each.value
}

resource "aws_iam_role_policy_attachment" "extra_attachments" {
  for_each   = toset(var.role_policy_arns)
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = each.value
}

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  role             = aws_iam_role.lambda_exec_role.arn
  runtime          = var.runtime
  handler          = var.handler
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = var.timeout
  memory_size      = var.memory_size

  environment {
    variables = var.environment_variables
  }
}