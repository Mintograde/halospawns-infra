variable "h1_film" {
  description = "Dormant H1 film runtime foundation. This does not enable upload processing."
  type = object({
    enabled              = optional(bool, false)
    repository_name      = optional(string, "halospawns-h1-film")
    image_tag            = optional(string, "")
    memory_mb            = optional(number, 4096)
    timeout_seconds      = optional(number, 900)
    ephemeral_storage_mb = optional(number, 8192)
  })
  default = {}

  validation {
    condition = !var.h1_film.enabled || (
      can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", var.h1_film.image_tag)) &&
      lower(var.h1_film.image_tag) != "latest"
    )
    error_message = "H1 film requires an explicit immutable release tag."
  }

  validation {
    condition = (
      var.h1_film.memory_mb >= 128 && var.h1_film.memory_mb <= 10240 &&
      var.h1_film.timeout_seconds >= 1 && var.h1_film.timeout_seconds <= 900 &&
      var.h1_film.ephemeral_storage_mb >= 512 && var.h1_film.ephemeral_storage_mb <= 10240
    )
    error_message = "H1 film runtime settings must stay within Lambda limits."
  }
}

locals {
  h1_film_function_name = "${var.project}-h1-film-${var.environment}"
}

data "aws_ecr_image" "h1_film" {
  count = var.h1_film.enabled ? 1 : 0

  repository_name = var.h1_film.repository_name
  image_tag       = var.h1_film.image_tag
}

resource "aws_cloudwatch_log_group" "h1_film" {
  count = var.h1_film.enabled ? 1 : 0

  name              = "/aws/lambda/${local.h1_film_function_name}"
  retention_in_days = 14
}

resource "aws_iam_role" "h1_film" {
  count = var.h1_film.enabled ? 1 : 0

  name = "${local.h1_film_function_name}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "h1_film_logs" {
  count = var.h1_film.enabled ? 1 : 0

  name = "h1-film-foundation-logs"
  role = aws_iam_role.h1_film[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.h1_film[0].arn}:*"
    }]
  })
}

# No queue mapping, URL, notification, invoke permission, or data access yet.
# Activation requires a reviewed intake implementation, not a stack flag flip.
resource "aws_lambda_function" "h1_film" {
  count = var.h1_film.enabled ? 1 : 0

  function_name = local.h1_film_function_name
  description   = "Dormant H1 film runtime; upload intake is not enabled."
  role          = aws_iam_role.h1_film[0].arn
  package_type  = "Image"
  architectures = ["x86_64"]
  image_uri     = "${data.terraform_remote_state.ecr.outputs.repository_urls[var.h1_film.repository_name]}@${data.aws_ecr_image.h1_film[0].image_digest}"
  memory_size   = var.h1_film.memory_mb
  timeout       = var.h1_film.timeout_seconds

  reserved_concurrent_executions = 0

  ephemeral_storage {
    size = var.h1_film.ephemeral_storage_mb
  }

  environment {
    variables = {
      ENVIRONMENT    = var.environment
      H1_WORKER_MODE = "foundation"
      H1_ENGINE_ROOT = "/var/task/engines"
    }
  }

  lifecycle {
    precondition {
      condition     = var.environment == "dev" && data.aws_caller_identity.current.account_id == "283279960672"
      error_message = "Only the dormant dev H1 foundation is authorized; prod needs a separate rollout."
    }
  }

  depends_on = [aws_iam_role_policy.h1_film_logs]
}

output "h1_film_foundation" {
  description = "Dormant runtime inventory, not an upload or queue contract."
  value = var.h1_film.enabled ? {
    function_name                  = aws_lambda_function.h1_film[0].function_name
    function_arn                   = aws_lambda_function.h1_film[0].arn
    image_uri                      = aws_lambda_function.h1_film[0].image_uri
    image_tag                      = var.h1_film.image_tag
    mode                           = "foundation"
    reserved_concurrent_executions = 0
    intake_enabled                 = false
  } : null
}
