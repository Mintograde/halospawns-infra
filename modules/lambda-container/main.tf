resource "aws_iam_role" "lambda_exec_role" {
  name = "${var.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

data "aws_iam_policy_document" "s3_policy" {
  statement {
    sid    = "AllowReadWriteMapsData"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject"
    ]
    resources = [
      "${var.s3_bucket_arn}${var.s3_bucket_path}/*",
    ]
  }
}

resource "aws_iam_role_policy_attachment" "lambda_sqs_policy" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole"
}

resource "aws_iam_policy" "policies" {
  for_each = merge(
    var.additional_iam_policies,
    {
      "S3AccessPolicy" = data.aws_iam_policy_document.s3_policy.json
    }
  )
  name   = "${var.function_name}-${each.key}"
  policy = each.value
}

resource "aws_iam_role_policy_attachment" "policies" {
  for_each   = aws_iam_policy.policies
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = each.value.arn
}

resource "aws_lambda_function" "container_lambda" {
  function_name = var.function_name
  role          = aws_iam_role.lambda_exec_role.arn
  package_type  = "Image"
  image_uri     = var.image_uri
  timeout       = var.timeout
  memory_size   = var.memory_size

  environment {
    variables = var.environment_variables
  }

  tags = var.tags
}

resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn = var.sqs_queue_arn
  function_name    = aws_lambda_function.container_lambda.arn
  batch_size       = var.batch_size
  enabled          = true
}