variable "project" {
  description = "Project name."
  type        = string
  default     = "halospawns"
}

variable "environment" {
  description = "Environment name."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deploy role, in owner/name form."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be in owner/name form."
  }
}

variable "github_environment" {
  description = "Optional GitHub Environment name used in the OIDC subject."
  type        = string
  default     = null
  nullable    = true
}

variable "github_branch" {
  description = "GitHub branch allowed when github_environment is not set."
  type        = string
  default     = "main"
}

variable "github_subject" {
  description = "Optional explicit GitHub OIDC subject. Overrides github_environment/github_branch."
  type        = string
  default     = null
  nullable    = true
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

variable "github_oidc_thumbprint_list" {
  description = "Thumbprint list for the GitHub Actions OIDC provider."
  type        = list(string)
  default     = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

variable "role_name" {
  description = "Optional IAM role name. Defaults to project-environment-frontend-deploy."
  type        = string
  default     = null
  nullable    = true
}

variable "site_bucket_name" {
  description = "Static site bucket name."
  type        = string
}

variable "site_bucket_arn" {
  description = "Static site bucket ARN."
  type        = string
}

variable "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN to invalidate."
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources."
  type        = map(string)
  default     = {}
}
