output "site_bucket_name" {
  description = "Name of the frontend static site bucket."
  value       = module.site.bucket_name
}

output "cloudfront_distribution_id" {
  description = "ID of the frontend CloudFront distribution."
  value       = module.site.cloudfront_distribution_id
}

output "cloudfront_distribution_domain_name" {
  description = "Default CloudFront domain name for the frontend site."
  value       = module.site.cloudfront_domain_name
}

output "cloudfront_distribution_arn" {
  description = "ARN of the frontend CloudFront distribution."
  value       = module.site.cloudfront_distribution_arn
}

output "site_url" {
  description = "URL for the frontend site."
  value       = module.site.site_url
}

output "delegated_hosted_zone_id" {
  description = "ID of the delegated environment hosted zone, when created."
  value       = var.create_delegated_hosted_zone ? module.delegated_zone[0].zone_id : null
}

output "delegated_hosted_zone_name" {
  description = "Name of the delegated environment hosted zone, when created."
  value       = var.create_delegated_hosted_zone ? module.delegated_zone[0].zone_name : null
}

output "delegated_hosted_zone_name_servers" {
  description = "Name servers to delegate from the parent hosted zone, when a delegated hosted zone is created."
  value       = var.create_delegated_hosted_zone ? module.delegated_zone[0].name_servers : []
}

output "access_control_mode" {
  description = "Configured frontend access control mode."
  value       = module.site.access_control_mode
}

output "basic_auth_ssm_parameter_name" {
  description = "Name of the Basic Auth SSM parameter."
  value       = var.create_basic_auth_edge_lambda ? module.basic_auth_edge[0].ssm_parameter_name : var.basic_auth_ssm_parameter_name
}

output "basic_auth_lambda_qualified_arn" {
  description = "Published Lambda@Edge version ARN used for Basic Auth."
  value       = local.basic_auth_lambda_qualified_arn
}

output "deploy_role_arn" {
  description = "ARN of the GitHub Actions deploy role."
  value       = module.github_deploy_role.role_arn
}

output "github_oidc_subject" {
  description = "GitHub OIDC subject allowed to assume the deploy role."
  value       = module.github_deploy_role.github_subject
}
