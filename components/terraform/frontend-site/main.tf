locals {
  basic_auth_enabled = var.access_control_mode == "basic_auth"

  created_basic_auth_lambda_qualified_arn = var.create_basic_auth_edge_lambda ? module.basic_auth_edge[0].lambda_function_qualified_arn : null
  basic_auth_lambda_qualified_arn         = local.created_basic_auth_lambda_qualified_arn != null ? local.created_basic_auth_lambda_qualified_arn : var.viewer_request_lambda_qualified_arn
  delegated_zone_name                     = var.delegated_zone_name != null ? var.delegated_zone_name : "${var.environment}.halospawns.com"
  managed_hosted_zone_id                  = var.create_delegated_hosted_zone ? module.delegated_zone[0].zone_id : null
  site_hosted_zone_id                     = var.hosted_zone_id != null ? var.hosted_zone_id : local.managed_hosted_zone_id
  create_site_dns_records                 = var.domain_name != null && (var.hosted_zone_id != null || var.create_delegated_hosted_zone)
}

module "delegated_zone" {
  count = var.create_delegated_hosted_zone ? 1 : 0

  source = "../../../modules/delegated-hosted-zone"

  zone_name = local.delegated_zone_name
  comment   = "Delegated public hosted zone for ${local.delegated_zone_name} in ${var.environment}"
  tags      = var.tags
}

module "basic_auth_edge" {
  count = var.create_basic_auth_edge_lambda ? 1 : 0

  source = "../../../modules/lambda-edge-basic-auth"

  providers = {
    aws = aws.us_east_1
  }

  project       = var.project
  environment   = var.environment
  function_name = "${var.project}-${var.environment}-frontend-basic-auth"

  ssm_parameter_name           = var.basic_auth_ssm_parameter_name
  create_ssm_parameter         = var.create_basic_auth_ssm_parameter
  ssm_placeholder_value        = var.basic_auth_ssm_placeholder_value
  ssm_kms_key_id               = var.basic_auth_ssm_kms_key_id
  ssm_region                   = "us-east-1"
  basic_auth_realm             = var.basic_auth_realm
  credential_cache_ttl_seconds = var.basic_auth_cache_ttl_seconds
  tags                         = var.tags
}

module "site" {
  source = "../../../modules/static-site"

  project       = var.project
  environment   = var.environment
  bucket_prefix = "${var.project}-frontend"

  domain_name          = var.domain_name
  aliases              = var.domain_name == null ? [] : [var.domain_name]
  acm_certificate_arn  = var.acm_certificate_arn
  create_certificate   = var.create_certificate
  hosted_zone_id       = local.site_hosted_zone_id
  create_dns_records   = local.create_site_dns_records
  default_root_object  = "index.html"
  spa_fallback_enabled = true
  access_control_mode  = var.access_control_mode
  price_class          = var.price_class
  tags                 = var.tags

  viewer_request_lambda_qualified_arn = local.basic_auth_enabled ? local.basic_auth_lambda_qualified_arn : null
}

module "github_deploy_role" {
  source = "../../../modules/github-actions-deploy-role"

  project     = var.project
  environment = var.environment

  github_repository  = var.github_repository
  github_environment = var.github_environment
  github_branch      = var.github_branch

  create_github_oidc_provider = var.create_github_oidc_provider
  github_oidc_provider_arn    = var.github_oidc_provider_arn

  site_bucket_name            = module.site.bucket_name
  site_bucket_arn             = module.site.bucket_arn
  cloudfront_distribution_arn = module.site.cloudfront_distribution_arn
  tags                        = var.tags
}
