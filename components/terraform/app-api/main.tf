locals {
  normalized_artifact_release_prefix = trimsuffix(var.release.artifact_prefix, "/") == "" ? "" : "${trimsuffix(var.release.artifact_prefix, "/")}/"
  map_upload_prefix                  = trim(var.uploads.maps.upload_prefix, "/")
  replay_upload_prefix               = trim(var.uploads.replays.upload_prefix, "/")
  map_asset_read_prefix              = trim(var.uploads.maps.asset_read_prefix, "/")
  replay_asset_read_prefix           = trim(var.uploads.replays.asset_read_prefix, "/")
  replay_spatial_artifact_prefix     = trim(var.uploads.replays.spatial_artifact_prefix, "/")
  heatmap_rollup_artifact_prefix     = trim(var.uploads.replays.heatmap_rollup_artifact_prefix, "/")
  region_stat_rollup_artifact_prefix = trim(var.uploads.replays.region_stat_rollup_artifact_prefix, "/")
  map_support_resource_prefix        = trim(var.uploads.maps.support_resource_prefix, "/")

  frontend_hosted_zone_id      = try(data.terraform_remote_state.frontend_site[0].outputs.delegated_hosted_zone_id, null)
  api_hosted_zone_id           = var.domain.hosted_zone_id != null ? var.domain.hosted_zone_id : local.frontend_hosted_zone_id
  api_domain_name              = var.domain.name == null ? null : trimspace(var.domain.name)
  app_api_base_url             = var.domain.base_url != null && trimspace(var.domain.base_url) != "" ? trimsuffix(trimspace(var.domain.base_url), "/") : (local.api_domain_name == null || local.api_domain_name == "" ? null : "https://${local.api_domain_name}")
  uploads_bucket_name          = try(data.terraform_remote_state.uploads_ingest[0].outputs.uploads_bucket_name, null)
  uploads_bucket_arn           = try(data.terraform_remote_state.uploads_ingest[0].outputs.uploads_bucket_arn, null)
  map_rendering_queue_name     = var.dependencies.queues.map_rendering == null || trimspace(var.dependencies.queues.map_rendering) == "" ? null : trimspace(var.dependencies.queues.map_rendering)
  map_rendering_queue_url      = try(data.aws_sqs_queue.map_rendering[0].url, null)
  map_rendering_queue_arn      = try(data.aws_sqs_queue.map_rendering[0].arn, null)
  replay_processing_queue_name = var.dependencies.queues.replay_processing == null || trimspace(var.dependencies.queues.replay_processing) == "" ? null : trimspace(var.dependencies.queues.replay_processing)
  replay_processing_queue_url  = try(data.aws_sqs_queue.replay_processing[0].url, null)
  replay_processing_queue_arn  = try(data.aws_sqs_queue.replay_processing[0].arn, null)

  github_environment_subject = var.release.github.environment == null || trimspace(var.release.github.environment) == "" ? null : "repo:${var.release.github.repository}:environment:${var.release.github.environment}"
  github_branch_subject      = "repo:${var.release.github.repository}:ref:refs/heads/${var.release.github.branch}"
  github_subject             = var.release.github.subject == null || trimspace(var.release.github.subject) == "" ? (local.github_environment_subject != null ? local.github_environment_subject : local.github_branch_subject) : var.release.github.subject
  github_oidc_provider_arn   = var.release.github.oidc.create_provider ? try(aws_iam_openid_connect_provider.github[0].arn, null) : (var.release.github.oidc.provider_arn != null && trimspace(var.release.github.oidc.provider_arn) != "" ? var.release.github.oidc.provider_arn : try(data.aws_iam_openid_connect_provider.github[0].arn, null))

  trusted_service_hmac_secret_ids = {
    for client, secret in aws_secretsmanager_secret.trusted_service_hmac :
    client => secret.name
  }

  trusted_service_hmac_secret_arns = [
    for secret in aws_secretsmanager_secret.trusted_service_hmac :
    secret.arn
  ]

  app_secret_arns = concat(
    compact([
      try(aws_secretsmanager_secret.supabase_database_url[0].arn, null),
      try(aws_secretsmanager_secret.supabase_service_role[0].arn, null),
    ]),
    local.trusted_service_hmac_secret_arns,
  )

  upload_put_object_resource_arns = local.uploads_bucket_arn == null ? [] : [
    "${local.uploads_bucket_arn}/${local.map_upload_prefix}/*",
    "${local.uploads_bucket_arn}/${local.replay_upload_prefix}/*",
  ]

  map_asset_get_object_resource_arns = local.uploads_bucket_arn == null ? [] : [
    "${local.uploads_bucket_arn}/${local.map_asset_read_prefix}/*",
  ]

  replay_asset_get_object_resource_arns = local.uploads_bucket_arn == null ? [] : [
    "${local.uploads_bucket_arn}/${local.replay_asset_read_prefix}/*",
  ]

  replay_spatial_artifact_get_object_resource_arns = local.uploads_bucket_arn == null ? [] : [
    "${local.uploads_bucket_arn}/${local.replay_spatial_artifact_prefix}/*",
  ]

  heatmap_rollup_artifact_get_object_resource_arns = local.uploads_bucket_arn == null ? [] : [
    "${local.uploads_bucket_arn}/${local.heatmap_rollup_artifact_prefix}/*",
  ]

  region_stat_rollup_artifact_get_object_resource_arns = local.uploads_bucket_arn == null ? [] : [
    "${local.uploads_bucket_arn}/${local.region_stat_rollup_artifact_prefix}/*",
  ]

  map_support_resource_delete_object_resource_arns = local.uploads_bucket_arn == null ? [] : [
    "${local.uploads_bucket_arn}/${local.map_support_resource_prefix}/*",
  ]

  app_lambda_environment = var.enabled ? merge(
    {
      ENVIRONMENT                               = var.environment
      SUPABASE_DATABASE_URL_SECRET_ARN          = aws_secretsmanager_secret.supabase_database_url[0].arn
      SUPABASE_PROJECT_REF                      = var.supabase.project_ref == null ? "" : var.supabase.project_ref
      SUPABASE_URL                              = var.supabase.url == null ? "" : var.supabase.url
      UPLOADS_BUCKET                            = coalesce(local.uploads_bucket_name, "")
      MAP_UPLOAD_PREFIX                         = local.map_upload_prefix
      REPLAY_UPLOAD_PREFIX                      = local.replay_upload_prefix
      UPLOAD_URL_TTL_SECONDS                    = tostring(var.uploads.url_ttl_seconds)
      MAP_SUPPORT_RESOURCE_AUTO_APPROVE_UPLOADS = tostring(var.uploads.maps.support_resource_auto_approve)
    },
    var.supabase.secrets.create_service_role_secret ? {
      SUPABASE_SERVICE_ROLE_SECRET_ARN = aws_secretsmanager_secret.supabase_service_role[0].arn
    } : {},
    length(local.trusted_service_hmac_secret_ids) > 0 ? {
      TRUSTED_SERVICE_HMAC_SECRET_IDS = jsonencode(local.trusted_service_hmac_secret_ids)
    } : {},
    length(local.trusted_service_hmac_secret_ids) > 0 && var.trusted_services.timestamp_tolerance_seconds != null ? {
      TRUSTED_SERVICE_HMAC_TIMESTAMP_TOLERANCE_SECONDS = tostring(var.trusted_services.timestamp_tolerance_seconds)
    } : {},
    local.app_api_base_url == null ? {} : {
      APP_API_BASE_URL = local.app_api_base_url
    },
    local.map_rendering_queue_url == null ? {} : {
      MAP_RENDERING_QUEUE_URL            = local.map_rendering_queue_url
      MAP_RENDER_OUTPUT_PREFIX_TEMPLATE  = var.rendering.output_prefix_template
      APP_API_MAP_SCREENSHOT_INGEST_PATH = var.rendering.screenshot_ingest_path
      RENDER_SET_NAME                    = var.rendering.render_set.name
      RENDER_SET_VERSION                 = tostring(var.rendering.render_set.version)
    },
    local.replay_processing_queue_url == null ? {} : {
      REPLAY_PROCESSING_QUEUE_URL = local.replay_processing_queue_url
    }
  ) : {}

  jwt_authorizer = var.supabase.jwt.create_authorizer ? {
    name     = "${var.project}-${var.environment}-app-api-supabase"
    issuer   = var.supabase.jwt.issuer == null ? "" : var.supabase.jwt.issuer
    audience = [var.supabase.jwt.audience]
  } : null

  app_api_public_routes = [
    {
      route_key          = "GET /health"
      authorization_type = "NONE"
    },
    {
      route_key          = "OPTIONS /{proxy+}"
      authorization_type = "NONE"
    },
    {
      route_key          = "PATCH /v1/uploads/{upload_id}/processing-status"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/live-channels/status"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/live-channels/{channel_key}/offline"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/replay-uploads"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/replay-uploads/presign"
      authorization_type = "NONE"
    },
    {
      route_key          = "PATCH /v1/ingest/replay-reprocess-attempts/{attempt_id}/status"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/map-uploads"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/map-screenshots"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/map-support-resources"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/map-support-resources/resolve"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/heatmap-rollups/claim"
      authorization_type = "NONE"
    },
    {
      route_key          = "GET /v1/ingest/heatmap-rollups/{scope_id}/inputs"
      authorization_type = "NONE"
    },
    {
      route_key          = "POST /v1/ingest/heatmap-rollups/{scope_id}/complete"
      authorization_type = "NONE"
    },
    {
      route_key          = "PATCH /v1/ingest/heatmap-rollups/{scope_id}/failed"
      authorization_type = "NONE"
    },
  ]

  app_api_dev_public_routes = var.environment == "dev" ? [
    {
      route_key          = "GET /swagger"
      authorization_type = "NONE"
    },
  ] : []

  app_api_routes = concat(
    local.app_api_public_routes,
    local.app_api_dev_public_routes,
    [
      {
        route_key          = "$default"
        authorization_type = var.supabase.jwt.create_authorizer ? "JWT" : "NONE"
      },
    ],
  )
}

resource "terraform_data" "required_inputs" {
  count = var.enabled ? 1 : 0

  input = {
    supabase_project_ref     = var.supabase.project_ref
    supabase_url             = var.supabase.url
    supabase_jwt_issuer      = var.supabase.jwt.issuer
    supabase_jwt_audience    = var.supabase.jwt.audience
    github_oidc_provider_arn = local.github_oidc_provider_arn
    api_domain_name          = local.api_domain_name
    api_hosted_zone_id       = local.api_hosted_zone_id
    uploads_ingest_state_key = var.dependencies.state_keys.uploads_ingest
    uploads_bucket_name      = local.uploads_bucket_name
    create_api_dns_records   = var.domain.create_dns_records
    create_api_certificate   = var.domain.create_certificate
    create_jwt_authorizer    = var.supabase.jwt.create_authorizer
    map_upload_prefix        = local.map_upload_prefix
    replay_upload_prefix     = local.replay_upload_prefix
    upload_url_ttl_seconds   = var.uploads.url_ttl_seconds
  }

  lifecycle {
    precondition {
      condition = (
        var.supabase.project_ref != null &&
        trimspace(var.supabase.project_ref) != "" &&
        var.supabase.url != null &&
        trimspace(var.supabase.url) != "" &&
        (
          !var.supabase.jwt.create_authorizer ||
          (
            var.supabase.jwt.issuer != null &&
            trimspace(var.supabase.jwt.issuer) != "" &&
            var.supabase.jwt.audience != null &&
            trimspace(var.supabase.jwt.audience) != ""
          )
        )
      )
      error_message = "Set Supabase project ref, URL, JWT issuer, and JWT audience before enabling app-api."
    }

    precondition {
      condition     = !((local.api_domain_name != null && local.api_domain_name != "") && (var.domain.create_dns_records || var.domain.create_certificate)) || local.api_hosted_zone_id != null
      error_message = "api_domain_name with DNS/certificate automation requires hosted_zone_id or frontend_site_state_key remote state with delegated_hosted_zone_id."
    }

    precondition {
      condition     = local.github_oidc_provider_arn != null
      error_message = "GitHub OIDC provider ARN is required. Pass github_oidc_provider_arn, set create_github_oidc_provider = true, or ensure the provider exists in the account."
    }

    precondition {
      condition = (
        var.dependencies.state_bucket != null &&
        var.dependencies.state_keys.uploads_ingest != null &&
        local.uploads_bucket_name != null &&
        local.uploads_bucket_arn != null
      )
      error_message = "app-api upload presigning requires tfstate_bucket and uploads_ingest_state_key so it can read the uploads-ingest bucket outputs."
    }

    precondition {
      condition     = local.map_upload_prefix != "" && local.replay_upload_prefix != "" && local.map_asset_read_prefix != "" && local.replay_asset_read_prefix != "" && local.replay_spatial_artifact_prefix != "" && local.heatmap_rollup_artifact_prefix != "" && local.region_stat_rollup_artifact_prefix != "" && local.map_support_resource_prefix != ""
      error_message = "Upload, asset-read, spatial-artifact, heatmap-rollup, region-stat-rollup, and support-resource prefixes must be non-empty stable root prefixes."
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

  name                    = var.supabase.secrets.database_url_name
  description             = "Supabase transaction pooler database URL for ${var.project}-${var.environment} app API."
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_secretsmanager_secret" "supabase_service_role" {
  count = var.enabled && var.supabase.secrets.create_service_role_secret ? 1 : 0

  name                    = var.supabase.secrets.service_role_name
  description             = "Optional Supabase service role key for ${var.project}-${var.environment} app API."
  recovery_window_in_days = 30
  tags                    = var.tags
}

resource "aws_secretsmanager_secret" "trusted_service_hmac" {
  for_each = var.enabled ? var.trusted_services.secret_names : {}

  name                    = each.value
  description             = "HMAC signing secret for the ${each.key} trusted client calling the ${var.project}-${var.environment} app API."
  recovery_window_in_days = 30
  tags                    = merge(var.tags, { TrustedClient = each.key })
}

module "app_lambda" {
  count = var.enabled ? 1 : 0

  source = "../../../modules/lambda-s3-managed"

  function_name = "${var.project}-${var.environment}-app-api"
  runtime       = var.release.lambda.runtime
  handler       = var.release.lambda.handler
  source_dir    = "../../../lambda/app_api_placeholder"
  alias_name    = var.release.lambda.alias_name
  timeout       = var.release.lambda.timeout_seconds
  memory_size   = var.release.lambda.memory_mb

  environment_variables = local.app_lambda_environment
  policies_json         = [data.aws_iam_policy_document.app_runtime[0].json]
  tags                  = var.tags

  depends_on = [terraform_data.required_inputs]
}

module "code_updater" {
  count = var.enabled ? 1 : 0

  source = "../../../modules/lambda-code-updater"

  function_name           = "${var.project}-${var.environment}-app-api-code-updater"
  role_name               = "${var.project}-${var.environment}-app-api-code-updater-exec-role"
  policy_name             = "app-api-code-updater"
  permission_statement_id = "AllowAppApiArtifactBucket"
  source_dir              = "${path.root}/../../../lambda/app_api_code_updater"
  output_path             = "${path.root}/app-api-code-updater.zip"

  artifact_bucket_arn       = aws_s3_bucket.artifacts[0].arn
  artifact_release_prefix   = local.normalized_artifact_release_prefix
  target_function_name      = module.app_lambda[0].function_name
  target_function_arn       = module.app_lambda[0].function_arn
  target_alias_name         = module.app_lambda[0].alias_name
  target_alias_arn          = module.app_lambda[0].alias_arn
  update_code_statement_sid = "UpdateAppLambdaCode"

  reserved_concurrent_executions = var.release.updater_reserved_concurrent_executions
  tags                           = var.tags
}

resource "aws_s3_bucket_notification" "release_artifacts" {
  count = var.enabled ? 1 : 0

  bucket = aws_s3_bucket.artifacts[0].id

  lambda_function {
    lambda_function_arn = module.code_updater[0].function_arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = local.normalized_artifact_release_prefix
    filter_suffix       = ".zip"
  }

  depends_on = [module.code_updater]
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

  routes = local.app_api_routes

  jwt_authorizer       = local.jwt_authorizer
  cors_allowed_origins = var.cors.allowed_origins

  domain_name        = local.api_domain_name
  hosted_zone_id     = local.api_hosted_zone_id
  certificate_arn    = var.domain.certificate_arn
  create_certificate = var.domain.create_certificate
  create_dns_records = var.domain.create_dns_records
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
