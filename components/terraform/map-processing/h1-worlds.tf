locals {
  h1_world_pool = local.h1_film_intake && var.h1_film.world_pool_capacity > 0
  h1_world_name = "${var.project}-h1-world-${var.environment}"
}

# Fragments are private intermediates. Only the parent can publish a replay or
# callback. Versioned scratch has its own retention, independent of film history.
resource "aws_s3_bucket" "h1_world" {
  count         = local.h1_world_pool ? 1 : 0
  bucket_prefix = "${local.h1_world_name}-"
}

resource "aws_s3_bucket_public_access_block" "h1_world" {
  count                   = local.h1_world_pool ? 1 : 0
  bucket                  = aws_s3_bucket.h1_world[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "h1_world" {
  count  = local.h1_world_pool ? 1 : 0
  bucket = aws_s3_bucket.h1_world[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "h1_world" {
  count  = local.h1_world_pool ? 1 : 0
  bucket = aws_s3_bucket_versioning.h1_world[0].bucket
  rule {
    id     = "expire-world-fragments"
    status = "Enabled"
    filter {}
    expiration {
      days = 1
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
  rule {
    id     = "expire-markers"
    status = "Enabled"
    filter {}
    expiration {
      expired_object_delete_marker = true
    }
  }
}

resource "aws_cloudwatch_log_group" "h1_world" {
  count             = local.h1_world_pool ? 1 : 0
  name              = "/aws/lambda/${local.h1_world_name}"
  retention_in_days = 14
}

resource "aws_iam_role" "h1_world" {
  count              = local.h1_world_pool ? 1 : 0
  name               = "${local.h1_world_name}-role"
  assume_role_policy = aws_iam_role.h1_film[0].assume_role_policy
}

resource "aws_iam_role_policy" "h1_world" {
  count = local.h1_world_pool ? 1 : 0
  name  = "convert-embedded-world"
  role  = aws_iam_role.h1_world[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.h1_world[0].arn}:*"
      },
      {
        Effect = "Allow"
        Action = "s3:GetObjectVersion"
        Resource = [
          "${local.h1_film_bucket_arn}/films/unprocessed/*",
          "${local.h1_film_bucket_arn}/${local.map_unprocessed_prefix}/*",
          "${local.h1_film_bucket_arn}/${local.map_processed_prefix}/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.h1_world[0].arn}/films/world-work/*"
      }
    ]
  })
}

resource "aws_lambda_function" "h1_world" {
  count                          = local.h1_world_pool ? 1 : 0
  function_name                  = local.h1_world_name
  description                    = "Converts one embedded H1 client world for a version-pinned parent invocation."
  role                           = aws_iam_role.h1_world[0].arn
  package_type                   = "Image"
  architectures                  = ["x86_64"]
  image_uri                      = "${data.terraform_remote_state.ecr.outputs.repository_urls[var.h1_film.repository_name]}@${data.aws_ecr_image.h1_film[0].image_digest}"
  publish                        = true
  memory_size                    = var.h1_film.memory_mb
  timeout                        = var.h1_film.timeout_seconds
  reserved_concurrent_executions = var.h1_film.world_pool_capacity
  ephemeral_storage {
    size = var.h1_film.ephemeral_storage_mb
  }
  image_config {
    command = ["h1_film.world_pool.handler"]
  }
  environment {
    variables = {
      ENVIRONMENT            = var.environment
      H1_WORKER_MODE         = "world"
      H1_WORKER_IMAGE_DIGEST = data.aws_ecr_image.h1_film[0].image_digest
      H1_UPLOADS_BUCKET      = data.terraform_remote_state.uploads_ingest.outputs.uploads_bucket_name
      H1_WORLD_BUCKET        = aws_s3_bucket.h1_world[0].id
      H1_MAX_SIZE_BYTES      = tostring(var.h1_film.max_size_bytes)
      H1_MAX_SOURCE_TICKS    = tostring(var.h1_film.max_source_ticks)
      H1_MAX_PLAYERS         = tostring(var.h1_film.max_players)
    }
  }
  depends_on = [aws_iam_role_policy.h1_world, aws_s3_bucket_versioning.h1_world, aws_s3_bucket_public_access_block.h1_world]
}

resource "aws_iam_role_policy" "h1_film_worlds" {
  count = local.h1_world_pool ? 1 : 0
  name  = "invoke-embedded-world"
  role  = aws_iam_role.h1_film[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.h1_world[0].qualified_arn
      },
      {
        Effect   = "Allow"
        Action   = "s3:GetObjectVersion"
        Resource = "${aws_s3_bucket.h1_world[0].arn}/films/world-work/*"
      }
    ]
  })
}
