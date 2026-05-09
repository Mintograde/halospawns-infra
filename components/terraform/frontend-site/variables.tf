variable "region" {
  description = "Region to deploy resources."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name."
  type        = string
}

variable "project" {
  description = "Project name."
  type        = string
  default     = "halospawns"
}

variable "profile" {
  description = "AWS profile name."
  type        = string
  default     = null
}

variable "domain_name" {
  description = "Primary custom domain name for the frontend site. Leave null to use the CloudFront default domain."
  type        = string
  default     = null
  nullable    = true
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for custom domain records and ACM validation."
  type        = string
  default     = null
  nullable    = true
}

variable "create_delegated_hosted_zone" {
  description = "Whether this component should create an environment public hosted zone for delegation from the parent zone."
  type        = bool
  default     = false
}

variable "delegated_zone_name" {
  description = "Environment hosted zone name, such as dev.halospawns.com."
  type        = string
  default     = null
  nullable    = true
}

variable "acm_certificate_arn" {
  description = "Existing us-east-1 ACM certificate ARN for the frontend CloudFront distribution."
  type        = string
  default     = null
  nullable    = true
}

variable "create_certificate" {
  description = "Whether to create and validate an ACM certificate for the frontend domain."
  type        = bool
  default     = false
}

variable "access_control_mode" {
  description = "Frontend access control mode."
  type        = string
  default     = "basic_auth"

  validation {
    condition     = contains(["public", "basic_auth"], var.access_control_mode)
    error_message = "access_control_mode must be either public or basic_auth."
  }
}

variable "viewer_request_lambda_qualified_arn" {
  description = "External published Lambda@Edge version ARN for Basic Auth. Leave null to let this component create one."
  type        = string
  default     = null
  nullable    = true
}

variable "create_basic_auth_edge_lambda" {
  description = "Whether to create the Basic Auth Lambda@Edge function."
  type        = bool
  default     = true
}

variable "basic_auth_ssm_parameter_name" {
  description = "SSM SecureString parameter name that stores the Base64 username:password value."
  type        = string
  default     = "/halospawns/dev/frontend-site/basic-auth/credentials-base64"
}

variable "create_basic_auth_ssm_parameter" {
  description = "Whether Terraform should create the Basic Auth SSM SecureString placeholder parameter."
  type        = bool
  default     = true
}

variable "basic_auth_ssm_placeholder_value" {
  description = "Non-working sentinel value for the Basic Auth SSM parameter."
  type        = string
  default     = "REPLACE_ME_DO_NOT_USE"
}

variable "basic_auth_ssm_kms_key_id" {
  description = "Optional customer-managed KMS key ARN or ID for the Basic Auth SSM SecureString parameter."
  type        = string
  default     = null
  nullable    = true
}

variable "basic_auth_realm" {
  description = "HTTP Basic Auth realm shown by browsers."
  type        = string
  default     = "Halospawns dev"
}

variable "basic_auth_cache_ttl_seconds" {
  description = "How long each Lambda@Edge execution environment caches the Basic Auth credential."
  type        = number
  default     = 300
}

variable "github_repository" {
  description = "GitHub frontend repository allowed to deploy, in owner/name form."
  type        = string
}

variable "github_environment" {
  description = "GitHub Environment used by the deploy workflow."
  type        = string
  default     = "dev"
}

variable "github_branch" {
  description = "GitHub branch used when github_environment is not set."
  type        = string
  default     = "main"
}

variable "create_github_oidc_provider" {
  description = "Whether to create the account-level GitHub Actions OIDC provider."
  type        = bool
  default     = true
}

variable "github_oidc_provider_arn" {
  description = "Existing GitHub Actions OIDC provider ARN when create_github_oidc_provider is false."
  type        = string
  default     = null
  nullable    = true
}

variable "price_class" {
  description = "CloudFront price class for the frontend distribution."
  type        = string
  default     = "PriceClass_100"
}

variable "tags" {
  description = "Additional tags to apply to resources."
  type        = map(string)
  default     = {}
}
