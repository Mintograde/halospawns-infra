locals {
  normalized_artifact_release_prefix = trimsuffix(var.artifact_release_prefix, "/") == "" ? "" : "${trimsuffix(var.artifact_release_prefix, "/")}/"

  frontend_hosted_zone_id = try(data.terraform_remote_state.frontend_site[0].outputs.delegated_hosted_zone_id, null)
  api_hosted_zone_id      = var.hosted_zone_id != null ? var.hosted_zone_id : local.frontend_hosted_zone_id
  api_domain_name         = var.api_domain_name == null ? null : trimspace(var.api_domain_name)

  github_environment_subject = var.github_environment == null || trimspace(var.github_environment) == "" ? null : "repo:${var.github_repository}:environment:${var.github_environment}"
  github_branch_subject      = "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"
  github_subject             = var.github_subject == null || trimspace(var.github_subject) == "" ? (local.github_environment_subject != null ? local.github_environment_subject : local.github_branch_subject) : var.github_subject
  github_oidc_provider_arn   = var.create_github_oidc_provider ? try(aws_iam_openid_connect_provider.github[0].arn, null) : (var.github_oidc_provider_arn != null && trimspace(var.github_oidc_provider_arn) != "" ? var.github_oidc_provider_arn : try(data.aws_iam_openid_connect_provider.github[0].arn, null))

  app_secret_arns = compact([
    try(aws_secretsmanager_secret.supabase_database_url[0].arn, null),
    try(aws_secretsmanager_secret.supabase_service_role[0].arn, null),
  ])

  app_lambda_environment = var.enabled ? merge(
    {
      SUPABASE_DATABASE_URL_SECRET_ARN = aws_secretsmanager_secret.supabase_database_url[0].arn
      SUPABASE_PROJECT_REF             = var.supabase_project_ref == null ? "" : var.supabase_project_ref
      SUPABASE_URL                     = var.supabase_url == null ? "" : var.supabase_url
    },
    var.create_supabase_service_role_secret ? {
      SUPABASE_SERVICE_ROLE_SECRET_ARN = aws_secretsmanager_secret.supabase_service_role[0].arn
    } : {}
  ) : {}

  jwt_authorizer = var.create_jwt_authorizer ? {
    name     = "${var.project}-${var.environment}-app-api-supabase"
    issuer   = var.supabase_jwt_issuer == null ? "" : var.supabase_jwt_issuer
    audience = [var.supabase_jwt_audience]
  } : null
}

resource "terraform_data" "required_inputs" {
  count = var.enabled ? 1 : 0

  input = {
    supabase_project_ref     = var.supabase_project_ref
    supabase_url             = var.supabase_url
    supabase_jwt_issuer      = var.supabase_jwt_issuer
    supabase_jwt_audience    = var.supabase_jwt_audience
    github_oidc_provider_arn = local.github_oidc_provider_arn
    api_domain_name          = local.api_domain_name
    api_hosted_zone_id       = local.api_hosted_zone_id
    create_api_dns_records   = var.create_api_dns_records
    create_api_certificate   = var.create_api_domain_certificate
    create_jwt_authorizer    = var.create_jwt_authorizer
  }

  lifecycle {
    precondition {
      condition = (
        var.supabase_project_ref != null &&
        trimspace(var.supabase_project_ref) != "" &&
        var.supabase_url != null &&
        trimspace(var.supabase_url) != "" &&
        (
          !var.create_jwt_authorizer ||
          (
            var.supabase_jwt_issuer != null &&
            trimspace(var.supabase_jwt_issuer) != "" &&
            var.supabase_jwt_audience != null &&
            trimspace(var.supabase_jwt_audience) != ""
          )
        )
      )
      error_message = "Set Supabase project ref, URL, JWT issuer, and JWT audience before enabling app-api."
    }

    precondition {
      condition     = !((local.api_domain_name != null && local.api_domain_name != "") && (var.create_api_dns_records || var.create_api_domain_certificate)) || local.api_hosted_zone_id != null
      error_message = "api_domain_name with DNS/certificate automation requires hosted_zone_id or frontend_site_state_key remote state with delegated_hosted_zone_id."
    }

    precondition {
      condition     = local.github_oidc_provider_arn != null
      error_message = "GitHub OIDC provider ARN is required. Pass github_oidc_provider_arn, set create_github_oidc_provider = true, or ensure the provider exists in the account."
    }
  }
}

resource "aws_s3_bucket" "artifacts" {
  count = var.enabled ? 1 : 0

  bucket = "${var.project}-api-artifacts-${var.environment}-${data.aws_caller_identity.current.account_id}"
  tags   = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  count = var.enabled ? 1 : 0

  bucket = aws_s3_bucket.artifacts[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  count = var.enabled ? 1 : 0

  bucket = aws_s3_bucket.artifacts[0].id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  count = var.enabled ? 1 : 0

  bucket                  = aws_s3_bucket.artifacts[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "artifacts" {
  count = var.enabled ? 1 : 0

  bucket     = aws_s3_bucket.artifacts[0].id
  policy     = data.aws_iam_policy_document.artifact_bucket[0].json
  depends_on = [aws_s3_bucket_public_access_block.artifacts]
}

resource "aws_secretsmanager_secret" "supabase_database_url" {
  count = var.enabled ? 1 : 0

  name                    = var.supabase_database_url_secret_name
  description             = "Supabase transaction pooler database URL for ${var.project}-${var.environment} app API."
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_secretsmanager_secret" "supabase_service_role" {
  count = var.enabled && var.create_supabase_service_role_secret ? 1 : 0

  name                    = var.supabase_service_role_secret_name
  description             = "Optional Supabase service role key for ${var.project}-${var.environment} app API."
  recovery_window_in_days = 30
  tags                    = var.tags
}

module "app_lambda" {
  count = var.enabled ? 1 : 0

  source = "../../../modules/lambda-s3-managed"

  function_name = "${var.project}-${var.environment}-app-api"
  runtime       = var.app_lambda_runtime
  handler       = var.app_lambda_handler
  source_dir    = "../../../lambda/app_api_placeholder"
  alias_name    = var.app_lambda_alias_name
  timeout       = var.app_lambda_timeout
  memory_size   = var.app_lambda_memory_size

  environment_variables = local.app_lambda_environment
  policies_json         = [data.aws_iam_policy_document.app_runtime[0].json]
  tags                  = var.tags

  depends_on = [terraform_data.required_inputs]
}

resource "aws_cloudwatch_log_group" "code_updater" {
  count = var.enabled ? 1 : 0

  name              = "/aws/lambda/${var.project}-${var.environment}-app-api-code-updater"
  retention_in_days = 30
  tags              = var.tags
}

resource "aws_iam_role" "code_updater" {
  count = var.enabled ? 1 : 0

  name               = "${var.project}-${var.environment}-app-api-code-updater-exec-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "code_updater_basic_execution" {
  count = var.enabled ? 1 : 0

  role       = aws_iam_role.code_updater[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "code_updater" {
  count = var.enabled ? 1 : 0

  name   = "app-api-code-updater"
  role   = aws_iam_role.code_updater[0].id
  policy = data.aws_iam_policy_document.code_updater[0].json
}

resource "aws_lambda_function" "code_updater" {
  count = var.enabled ? 1 : 0

  function_name                  = "${var.project}-${var.environment}-app-api-code-updater"
  role                           = aws_iam_role.code_updater[0].arn
  runtime                        = "python3.12"
  handler                        = "handler.handler"
  filename                       = data.archive_file.code_updater[0].output_path
  source_code_hash               = data.archive_file.code_updater[0].output_base64sha256
  timeout                        = 300
  memory_size                    = 128
  reserved_concurrent_executions = var.code_updater_reserved_concurrent_executions
  tags                           = var.tags

  environment {
    variables = {
      TARGET_FUNCTION_NAME    = module.app_lambda[0].function_name
      TARGET_ALIAS_NAME       = module.app_lambda[0].alias_name
      ARTIFACT_RELEASE_PREFIX = local.normalized_artifact_release_prefix
      ARTIFACT_SUFFIX         = ".zip"
      WAIT_TIMEOUT_SECONDS    = "300"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.code_updater,
    aws_iam_role_policy_attachment.code_updater_basic_execution,
    aws_iam_role_policy.code_updater,
  ]
}

resource "aws_lambda_permission" "allow_artifact_bucket" {
  count = var.enabled ? 1 : 0

  statement_id   = "AllowAppApiArtifactBucket"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.code_updater[0].function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.artifacts[0].arn
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_s3_bucket_notification" "release_artifacts" {
  count = var.enabled ? 1 : 0

  bucket = aws_s3_bucket.artifacts[0].id

  lambda_function {
    lambda_function_arn = aws_lambda_function.code_updater[0].arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = local.normalized_artifact_release_prefix
    filter_suffix       = ".zip"
  }

  depends_on = [aws_lambda_permission.allow_artifact_bucket]
}

module "api" {
  count = var.enabled ? 1 : 0

  source = "../../../modules/api-gateway-http"

  name                 = "${var.project}-${var.environment}-app-api"
  description          = "App API for ${var.project} ${var.environment}."
  stage_name           = "$default"
  lambda_invoke_arn    = module.app_lambda[0].alias_invoke_arn
  lambda_function_name = module.app_lambda[0].function_name
  lambda_alias_name    = module.app_lambda[0].alias_name

  routes = [
    {
      route_key          = "GET /health"
      authorization_type = "NONE"
    },
    {
      route_key          = "$default"
      authorization_type = var.create_jwt_authorizer ? "JWT" : "NONE"
    },
  ]

  jwt_authorizer       = local.jwt_authorizer
  cors_allowed_origins = var.frontend_allowed_origins

  domain_name        = local.api_domain_name
  hosted_zone_id     = local.api_hosted_zone_id
  certificate_arn    = var.api_certificate_arn
  create_certificate = var.create_api_domain_certificate
  create_dns_records = var.create_api_dns_records
  tags               = var.tags
}

resource "aws_iam_role" "github_deploy" {
  count = var.enabled ? 1 : 0

  name                 = "${var.project}-${var.environment}-app-api-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_assume_role[0].json
  max_session_duration = 3600
  tags                 = var.tags
}

resource "aws_iam_role_policy" "github_deploy" {
  count = var.enabled ? 1 : 0

  name   = "app-api-release-artifacts"
  role   = aws_iam_role.github_deploy[0].id
  policy = data.aws_iam_policy_document.github_deploy[0].json
}
