module "backend" {
  source        = "./modules/backend"
  bucket_prefix = "${var.project}-tfstate"
  tags          = { "Description" = "Stores Terraform remote state" }
  environment   = var.environment
}

module "uploads_bucket" {
  source                  = "./modules/s3-bucket"
  bucket_prefix           = "uploads"
  environment             = var.environment
  allowed_cors_origins    = ["halospawns.com", "halospawns.benzeis.com", "localhost:8080"]
  source_policy_documents = [data.aws_iam_policy_document.cloudfront_to_s3_policy.json]
}

data "aws_iam_policy_document" "s3_to_sns_policy" {
  for_each = toset(local.file_upload_types)

  statement {
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.file_uploaded[each.key].arn]

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [module.uploads_bucket.s3_bucket_arn]
    }
  }
}

resource "aws_sns_topic_policy" "s3_publish_permission" {
  for_each = toset(local.file_upload_types)
  arn      = aws_sns_topic.file_uploaded[each.key].arn
  policy   = data.aws_iam_policy_document.s3_to_sns_policy[each.key].json
}

resource "aws_s3_bucket_notification" "uploads_notification" {
  bucket = module.uploads_bucket.s3_bucket_id

  dynamic "topic" {
    for_each = toset(local.file_upload_types)
    content {
      topic_arn     = aws_sns_topic.file_uploaded[topic.key].arn
      events        = ["s3:ObjectCreated:*"]
      filter_prefix = "${topic.key}/unprocessed/"
    }
  }

  depends_on = [aws_sns_topic_policy.s3_publish_permission]
}

resource "aws_sns_topic" "file_uploaded" {
  for_each = toset(local.file_upload_types)
  name     = "${each.key}-uploaded-topic"
}

resource "aws_sqs_queue" "file_processing" {
  for_each                   = toset(local.file_upload_types)
  name                       = "${each.key}-processing-queue"
  visibility_timeout_seconds = 300    # 5 minutes
  message_retention_seconds  = 604800 # 7 days
  receive_wait_time_seconds  = 20
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.file_dlq[each.key].arn
    maxReceiveCount     = 4
  })
}

resource "aws_sqs_queue" "file_dlq" {
  for_each = toset(local.file_upload_types)
  name     = "${each.key}-processing-dlq"
}

resource "aws_sqs_queue_redrive_allow_policy" "example" {
  for_each  = toset(local.file_upload_types)
  queue_url = aws_sqs_queue.file_dlq[each.key].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue",
    sourceQueueArns   = [aws_sqs_queue.file_processing[each.key].arn]
  })
}

resource "aws_sns_topic_subscription" "file_subscription" {
  for_each   = toset(local.file_upload_types)
  topic_arn  = aws_sns_topic.file_uploaded[each.key].arn
  protocol   = "sqs"
  endpoint   = aws_sqs_queue.file_processing[each.key].arn
  depends_on = [aws_sqs_queue_policy.file_policy]
}

data "aws_iam_policy_document" "file_sqs_policy" {
  for_each = toset(local.file_upload_types)

  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.file_processing[each.key].arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.file_uploaded[each.key].arn]
    }
  }
}

resource "aws_sqs_queue_policy" "file_policy" {
  for_each = toset(local.file_upload_types)

  queue_url = aws_sqs_queue.file_processing[each.key].id
  policy    = data.aws_iam_policy_document.file_sqs_policy[each.key].json
}

resource "aws_cloudfront_origin_access_control" "uploads_oac" {
  name                              = "OAC for ${module.uploads_bucket.s3_bucket_id}"
  description                       = "Origin Access Control for S3 uploads"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "cloudfront_to_s3_policy" {
  statement {
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${module.uploads_bucket.s3_bucket_arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.s3_distribution.arn]
    }
  }
}

resource "aws_cloudfront_public_key" "main" {
  comment     = "Public key for signing upload URLs"
  encoded_key = file("./configuration/${var.environment}/public_key.pem") # FIXME: seed this in param store
  name        = "s3-upload-key"
}

resource "aws_cloudfront_key_group" "main" {
  comment = "Key group for signing upload URLs"
  items   = [aws_cloudfront_public_key.main.id]
  name    = "s3-upload-key-group"
}

resource "aws_acm_certificate" "cert" {
  domain_name       = local.full_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudfront_distribution" "s3_distribution" {
  origin {
    domain_name              = module.uploads_bucket.bucket_regional_domain_name
    origin_id                = "S3-${module.uploads_bucket.s3_bucket_id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.uploads_oac.id
  }

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "CDN for ${local.full_domain_name}"
  default_root_object = "index.html"

  aliases = [local.full_domain_name]

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${module.uploads_bucket.s3_bucket_id}"

    trusted_key_groups = [aws_cloudfront_key_group.main.id]

    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.cert.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

resource "aws_ecr_repository" "lambda_container" {
  for_each             = toset(local.lambda_containers)
  name                 = each.key
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "lambda_container" {
  for_each   = toset(local.lambda_containers)
  repository = aws_ecr_repository.lambda_container[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire images older than 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

module "sqs_lambda_consumers" {
  for_each = local.lambda_configurations
  source   = "./modules/lambda-container"

  function_name  = "${each.key}-${var.environment}"
  image_uri      = "${aws_ecr_repository.lambda_container[each.key].repository_url}:latest"
  sqs_queue_arn  = each.value.sqs_queue_arn
  s3_bucket_arn  = each.value.s3_bucket_arn
  s3_bucket_path = each.value.s3_bucket_path

  environment_variables = {
    UPLOADS_BUCKET_NAME = module.uploads_bucket.s3_bucket_id
    ENVIRONMENT         = var.environment
  }
}

module "current_games_ddb" {
  source       = "./modules/ddb"
  table_name   = "current-games-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "game_id"
  attributes = [
    { name = "game_id", type = "S" }
  ]
  ttl_enabled        = true
  ttl_attribute_name = "ttl"
}

data "aws_iam_policy_document" "current_games_update_access" {
  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [module.current_games_ddb.table_arn]
  }
}

data "aws_iam_policy_document" "current_games_list_access" {
  statement {
    actions   = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:Scan"]
    resources = [module.current_games_ddb.table_arn]
  }
}

module "update_status_lambda" {
  source        = "./modules/lambda-zip"
  function_name = "update-status-${var.environment}"
  runtime       = "python3.12"
  handler       = "handler.handler"
  source_dir    = "./lambda/update_status"
  timeout       = 10
  memory_size   = 128
  environment_variables = {
    TABLE_NAME            = module.current_games_ddb.table_name
    RECENT_WINDOW_SECONDS = "600"
  }
  policies_json = [
    data.aws_iam_policy_document.current_games_update_access.json
  ]
}

module "list_games_lambda" {
  source        = "./modules/lambda-zip"
  function_name = "list-games-${var.environment}"
  runtime       = "python3.12"
  handler       = "handler.handler"
  source_dir    = "./lambda/list_games"
  timeout       = 10
  memory_size   = 128
  environment_variables = {
    TABLE_NAME            = module.current_games_ddb.table_name
    RECENT_WINDOW_SECONDS = "600"
  }
  policies_json = [
    data.aws_iam_policy_document.current_games_list_access.json
  ]
}

module "current_games_api" {
  source     = "./modules/api-gateway-rest"
  api_name   = "current-games"
  stage_name = var.environment

  routes = [
    {
      path             = "/game-status"
      method           = "POST"
      lambda_arn       = module.update_status_lambda.function_arn
      api_key_required = true
    },
    {
      path       = "/games"
      method     = "GET"
      lambda_arn = module.list_games_lambda.function_arn
    }
  ]

  usage_plan = {
    enabled        = true
    name           = "current-games-${var.environment}"
    throttle_burst = 50
    throttle_rate  = 100
    quota_limit    = 50000
    quota_period   = "MONTH"
  }
}
