variable "h1_film" {
  description = "Dedicated H1 runtime. Intake wiring and consumer activation are separate gates."
  type = object({
    enabled              = optional(bool, false)
    repository_name      = optional(string, "halospawns-h1-film")
    image_tag            = optional(string, "")
    memory_mb            = optional(number, 4096)
    timeout_seconds      = optional(number, 900)
    ephemeral_storage_mb = optional(number, 8192)
    intake_configured    = optional(bool, false)
    event_source_enabled = optional(bool, false)
    reserved_concurrency = optional(number, 0)
    max_size_bytes       = optional(number, 536870912)
    max_source_ticks     = optional(number, 432000)
    max_players          = optional(number, 4)
  })
  default = {}

  validation {
    condition = (
      var.h1_film.reserved_concurrency >= 0 && var.h1_film.reserved_concurrency <= 2 &&
      floor(var.h1_film.reserved_concurrency) == var.h1_film.reserved_concurrency &&
      (var.h1_film.intake_configured || (!var.h1_film.event_source_enabled && var.h1_film.reserved_concurrency == 0)) &&
      (!var.h1_film.event_source_enabled || var.h1_film.reserved_concurrency > 0)
    )
    error_message = "Consumer activation requires a configured intake and reserved concurrency of 1-2; the foundation stays at zero."
  }

  validation {
    condition = (
      var.h1_film.max_size_bytes > 0 && var.h1_film.max_size_bytes <= 536870912 &&
      var.h1_film.max_source_ticks > 0 && var.h1_film.max_source_ticks <= 432000 &&
      var.h1_film.max_players > 0 && var.h1_film.max_players <= 4 &&
      floor(var.h1_film.max_size_bytes) == var.h1_film.max_size_bytes &&
      floor(var.h1_film.max_source_ticks) == var.h1_film.max_source_ticks &&
      floor(var.h1_film.max_players) == var.h1_film.max_players
    )
    error_message = "Worker bounds cannot exceed the supported converter ceilings."
  }

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
  h1_film_intake        = var.h1_film.enabled && var.h1_film.intake_configured
  h1_film_pipeline      = try(local.upload_pipelines.films, null)
  h1_film_bucket_arn    = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_arn
  h1_film_parameter     = try(local.trusted_service_hmac_parameter_names_by_client["h1-film"], null)
  h1_film_parameter_arn = try(local.trusted_service_hmac_parameter_arns_by_client["h1-film"], null)
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

resource "aws_iam_role_policy" "h1_film_intake" {
  count = local.h1_film_intake ? 1 : 0
  name  = "h1-film-intake"
  role  = aws_iam_role.h1_film[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = [local.h1_film_parameter_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = [local.h1_film_pipeline.queue_arn]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObjectVersion"]
        Resource = [
          "${local.h1_film_bucket_arn}/films/unprocessed/*",
          "${local.h1_film_bucket_arn}/${local.map_unprocessed_prefix}/*",
          "${local.h1_film_bucket_arn}/${local.map_processed_prefix}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject"]
        Resource = [
          "${local.h1_film_bucket_arn}/films/derived/*",
          "${local.h1_film_bucket_arn}/${local.replay_viewer_artifact_prefix}/*",
          "${local.h1_film_bucket_arn}/${local.replay_spatial_artifact_prefix}/*",
        ]
      },
      {
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = [local.h1_film_bucket_arn]
        Condition = { StringLike = { "s3:prefix" = ["${local.replay_viewer_artifact_prefix}/*"] } }
      },
    ]
  })
}

# The source is retained version-pinned. No worker may delete it or write to an
# input prefix, and nothing enables consumers merely by deploying this image.
resource "aws_lambda_function" "h1_film" {
  count = var.h1_film.enabled ? 1 : 0

  function_name = local.h1_film_function_name
  description   = local.h1_film_intake ? "H1 film conversion with separately gated SQS intake." : "Dormant H1 film runtime; upload intake is not enabled."
  role          = aws_iam_role.h1_film[0].arn
  package_type  = "Image"
  architectures = ["x86_64"]
  image_uri     = "${data.terraform_remote_state.ecr.outputs.repository_urls[var.h1_film.repository_name]}@${data.aws_ecr_image.h1_film[0].image_digest}"
  memory_size   = var.h1_film.memory_mb
  timeout       = var.h1_film.timeout_seconds

  reserved_concurrent_executions = var.h1_film.reserved_concurrency

  ephemeral_storage {
    size = var.h1_film.ephemeral_storage_mb
  }

  environment {
    variables = merge({
      ENVIRONMENT    = var.environment
      H1_WORKER_MODE = local.h1_film_intake ? "intake" : "foundation"
      H1_ENGINE_ROOT = "/var/task/engines"
      }, local.h1_film_intake ? {
      H1_QUEUE_ARN                               = local.h1_film_pipeline.queue_arn
      H1_TOPIC_ARN                               = data.terraform_remote_state.uploads_ingest.outputs.file_uploaded_topic_arns["films"]
      H1_UPLOADS_BUCKET                          = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      H1_MAX_SIZE_BYTES                          = tostring(var.h1_film.max_size_bytes)
      H1_MAX_SOURCE_TICKS                        = tostring(var.h1_film.max_source_ticks)
      H1_MAX_PLAYERS                             = tostring(var.h1_film.max_players)
      APP_API_BASE_URL                           = local.app_api_base_url
      APP_API_TRUSTED_CLIENT_NAME                = "h1-film"
      APP_API_TRUSTED_CLIENT_HMAC_PARAMETER_NAME = local.h1_film_parameter
      VIEWER_ARTIFACT_PREFIX                     = "${local.replay_viewer_artifact_prefix}/"
      SPATIAL_ARTIFACT_PREFIX                    = "${local.replay_spatial_artifact_prefix}/"
      REPLAY_EXTRACTOR_MODE                      = "native"
    } : {})
  }

  lifecycle {
    precondition {
      condition = !local.h1_film_intake || (
        var.h1_film.memory_mb >= 3008 && var.h1_film.timeout_seconds == 900 &&
        var.h1_film.ephemeral_storage_mb >= 8192
      )
      error_message = "The bounded intake currently requires at least 3008 MiB memory, 8192 MiB temp and a 900-second timeout."
    }
    precondition {
      condition     = var.environment == "dev" && data.aws_caller_identity.current.account_id == "283279960672"
      error_message = "Only dev H1 adoption is authorized; prod needs a separate rollout."
    }
    precondition {
      condition = !local.h1_film_intake || try(
        local.h1_film_parameter != null && local.app_api_base_url != null &&
        local.h1_film_pipeline.unprocessed_prefix == "films/unprocessed/",
        false,
      )
      error_message = "Apply the dedicated films pipeline and API/HMAC contracts before wiring the worker."
    }
  }

  depends_on = [aws_iam_role_policy.h1_film_logs, aws_iam_role_policy.h1_film_intake]
}

resource "aws_lambda_event_source_mapping" "h1_film" {
  count = local.h1_film_intake ? 1 : 0

  event_source_arn        = local.h1_film_pipeline.queue_arn
  function_name           = aws_lambda_function.h1_film[0].arn
  enabled                 = var.h1_film.event_source_enabled
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}

output "h1_film_foundation" {
  description = "Runtime inventory with explicit intake and consumer gates."
  value = var.h1_film.enabled ? {
    function_name                  = aws_lambda_function.h1_film[0].function_name
    function_arn                   = aws_lambda_function.h1_film[0].arn
    image_uri                      = aws_lambda_function.h1_film[0].image_uri
    image_tag                      = var.h1_film.image_tag
    mode                           = local.h1_film_intake ? "intake" : "foundation"
    reserved_concurrent_executions = var.h1_film.reserved_concurrency
    intake_enabled                 = var.h1_film.event_source_enabled
  } : null
}
