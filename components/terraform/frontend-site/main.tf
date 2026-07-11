locals {
  basic_auth_enabled = var.access.mode == "basic_auth"

  created_basic_auth_lambda_qualified_arn = var.access.basic_auth.create_edge_lambda ? module.basic_auth_edge[0].lambda_function_qualified_arn : null
  basic_auth_lambda_qualified_arn         = local.created_basic_auth_lambda_qualified_arn != null ? local.created_basic_auth_lambda_qualified_arn : var.access.viewer_request_lambda_qualified_arn
  delegated_zone_name                     = var.dns.hosted_zone.name != null ? var.dns.hosted_zone.name : "${var.environment}.halospawns.com"
  managed_hosted_zone_id                  = var.dns.hosted_zone.create ? module.delegated_zone[0].zone_id : null
  site_hosted_zone_id                     = var.dns.hosted_zone.id != null ? var.dns.hosted_zone.id : local.managed_hosted_zone_id
  create_site_dns_records                 = var.dns.domain_name != null && (var.dns.hosted_zone.id != null || var.dns.hosted_zone.create)
}

module "delegated_zone" {
  count = var.dns.hosted_zone.create ? 1 : 0

  source = "../../../modules/delegated-hosted-zone"

  zone_name = local.delegated_zone_name
  comment   = "Delegated public hosted zone for ${local.delegated_zone_name} in ${var.environment}"
  tags      = var.tags
}

module "basic_auth_edge" {
  count = var.access.basic_auth.create_edge_lambda ? 1 : 0

  source = "../../../modules/lambda-edge-basic-auth"

  providers = {
    aws = aws.us_east_1
  }

  project       = var.project
  environment   = var.environment
  function_name = "${var.project}-${var.environment}-frontend-basic-auth"

  ssm_parameter_name           = var.access.basic_auth.ssm_parameter_name
  create_ssm_parameter         = var.access.basic_auth.create_ssm_parameter
  ssm_placeholder_value        = var.access.basic_auth.ssm_placeholder_value
  ssm_kms_key_id               = var.access.basic_auth.ssm_kms_key_id
  ssm_region                   = "us-east-1"
  basic_auth_realm             = var.access.basic_auth.realm
  credential_cache_ttl_seconds = var.access.basic_auth.credential_cache_seconds
  tags                         = var.tags
}

module "site" {
  source = "../../../modules/static-site"

  project       = var.project
  environment   = var.environment
  bucket_prefix = "${var.project}-frontend"

  domain_name          = var.dns.domain_name
  aliases              = var.dns.domain_name == null ? [] : [var.dns.domain_name]
  acm_certificate_arn  = var.dns.certificate.arn
  create_certificate   = var.dns.certificate.create
  hosted_zone_id       = local.site_hosted_zone_id
  create_dns_records   = local.create_site_dns_records
  default_root_object  = "index.html"
  spa_fallback_enabled = true
  access_control_mode  = var.access.mode
  price_class          = var.cloudfront.price_class
  tags                 = var.tags

  viewer_request_lambda_qualified_arn = local.basic_auth_enabled ? local.basic_auth_lambda_qualified_arn : null
}

module "github_deploy_role" {
  source = "../../../modules/github-actions-deploy-role"

  project     = var.project
  environment = var.environment

  github_repository  = var.deployment.github.repository
  github_environment = var.deployment.github.environment
  github_branch      = var.deployment.github.branch

  create_github_oidc_provider = var.deployment.github.oidc.create_provider
  github_oidc_provider_arn    = var.deployment.github.oidc.provider_arn

  site_bucket_name            = module.site.bucket_name
  site_bucket_arn             = module.site.bucket_arn
  cloudfront_distribution_arn = module.site.cloudfront_distribution_arn
  tags                        = var.tags
}
